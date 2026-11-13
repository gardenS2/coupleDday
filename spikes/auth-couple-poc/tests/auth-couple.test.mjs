import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Refuse remote endpoints: this harness must never create real users remotely.
const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
assert.match(config, /project_id = "couple-auth-local"/);
const status = JSON.parse(execFileSync('./node_modules/.bin/supabase', ['status', '-o', 'json'], {encoding:'utf8', stdio:['ignore','pipe','ignore']}));
const base = 'http://127.0.0.1:55431';
assert.equal(new URL(status.API_URL).port, '55431');
assert.ok(['127.0.0.1','localhost'].includes(new URL(status.API_URL).hostname));
const apiKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
assert.ok(apiKey, 'Local publishable key missing');
const users=[];
async function request(path, user=null, method='GET', body) {
  const response = await fetch(base+path, {method, headers:{apikey:apiKey, ...(user ? {Authorization:`Bearer ${user.token}`} : {}), 'Content-Type':'application/json', Prefer:'return=representation'}, body:body===undefined?undefined:JSON.stringify(body), signal:AbortSignal.timeout(15000)});
  const raw=await response.text(); let data; try { data=JSON.parse(raw); } catch {data=raw;}
  return {ok:response.ok, status:response.status, data};
}
function ok(r) { assert.ok(r.ok, `HTTP ${r.status}; code=${r.data?.code ?? 'none'} message=${r.data?.message ?? 'none'}`); return r.data; }
function denied(r) { assert.ok(!r.ok, 'Unauthorized mutation unexpectedly succeeded'); }
const rpc=(name,user,args={})=>request('/rest/v1/rpc/'+name,user,'POST',args);
const rows=(table,user,query='')=>request('/rest/v1/'+table+'?select=*'+query,user);
async function makeUser(label) {
  const email=`poc-${label}-${randomUUID()}@example.test`;
  const password=randomBytes(24).toString('base64url');
  const result=ok(await request('/auth/v1/signup',null,'POST',{email,password}));
  assert.ok(result.access_token, 'Only local confirmation-disabled Auth is supported');
  const user={id:result.user.id,token:result.access_token,refresh:result.refresh_token,email,password};
  users.push(user); return user;
}
function expireInvite(id) {
  assert.match(id,/^[0-9a-f-]{36}$/);
  execFileSync('docker',['exec','-i','supabase_db_couple-auth-local','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{
    input:`update public.couple_invites set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where id='${id}';`,stdio:['pipe','pipe','pipe']});
}

test('local Auth and couple authorization integration', {timeout:120000}, async t=>{
  const [a,b,c,d]=await Promise.all(['a','b','c','d'].map(makeUser));
  t.after(async () => {
    for (const u of users) if (u.token) await rpc('leave_couple',u);
    const ids=users.map(u=>{ assert.match(u.id,/^[0-9a-f-]{36}$/); return "'"+u.id+"'"; });
    execFileSync('docker',['exec','-i','supabase_db_couple-auth-local','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:`delete from auth.users where id in (${ids.join(',')});`,stdio:['pipe','pipe','pipe']});
  });
  let couple, firstInvite, retainedHealth, retainedEvent;
  await t.test('real local Auth login, refresh, wrong password and profile isolation',async()=>{
    const login=ok(await request('/auth/v1/token?grant_type=password',null,'POST',{email:a.email,password:a.password}));
    assert.equal(login.user.id,a.id);
    denied(await request('/auth/v1/token?grant_type=password',null,'POST',{email:a.email,password:'incorrect-test-password'}));
    const refreshed=ok(await request('/auth/v1/token?grant_type=refresh_token',null,'POST',{refresh_token:a.refresh}));
    a.token=refreshed.access_token; a.refresh=refreshed.refresh_token;
    assert.deepEqual(ok(await rows('profiles',a)).map(x=>x.user_id),[a.id]);
    ok(await request(`/rest/v1/profiles?user_id=eq.${a.id}`,a,'PATCH',{private_name:'가상 하늘'}));
    assert.deepEqual(ok(await rows('profiles',b,`&user_id=eq.${a.id}`)),[]);
    assert.deepEqual(ok(await request(`/rest/v1/profiles?user_id=eq.${a.id}`,b,'PATCH',{private_name:'unauthorized'})),[]);
    assert.equal(ok(await rows('profiles',a))[0].private_name,'가상 하늘');
    denied(await request(`/rest/v1/profiles?user_id=eq.${a.id}`,a,'PATCH',{user_id:b.id}));
  });
  await t.test('anonymous and forged JWT cannot access data or privileged RPC',async()=>{
    denied(await rows('couples'));
    denied(await rpc('create_couple',null,{p_relationship_start:'2026-01-01'}));
    const parts=a.token.split('.');
    parts[1]=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(parts[1],'base64url')),sub:b.id})).toString('base64url');
    denied(await rows('profiles',{token:parts.join('.')}));
  });
  await t.test('create, 24-hour invite and acceptance are authenticated transactions',async()=>{
    denied(await rpc('create_couple',a,{p_relationship_start:'2999-01-01'}));
    couple=ok(await rpc('create_couple',a,{p_relationship_start:'2026-01-01'}));
    denied(await rpc('create_couple',a,{p_relationship_start:'2026-01-01'}));
    firstInvite=ok(await rpc('create_couple_invite',a))[0];
    assert.equal(firstInvite.invite_token.length,64);
    denied(await rpc('accept_couple_invite',a,{p_token:firstInvite.invite_token}));
    assert.equal(ok(await rpc('accept_couple_invite',b,{p_token:firstInvite.invite_token})),couple);
    assert.equal(ok(await rpc('accept_couple_invite',b,{p_token:firstInvite.invite_token})),couple,'same-user retry is idempotent');
    assert.equal(ok(await rows('couple_members',a)).length,2);
    denied(await rpc('create_couple_invite',a));
  });
  await t.test('shared health: partner reads, edits and deletes regardless of author',async()=>{
    const daily=ok(await request('/rest/v1/cycle_daily_logs',a,'POST',{couple_id:couple,log_date:'2026-01-02',symptoms:['피곤'],mood:'평온해요',memo:'가상 건강 기록'}))[0];
    assert.equal(daily.created_by,a.id); assert.equal(daily.version,1);
    assert.equal(ok(await rows('cycle_daily_logs',b,`&id=eq.${daily.id}`))[0].memo,'가상 건강 기록');
    const edited=ok(await request(`/rest/v1/cycle_daily_logs?id=eq.${daily.id}&version=eq.1`,b,'PATCH',{memo:'상대가 수정한 가상 기록'}))[0];
    assert.equal(edited.updated_by,b.id); assert.equal(edited.created_by,a.id); assert.equal(edited.version,2);
    assert.deepEqual(ok(await request(`/rest/v1/cycle_daily_logs?id=eq.${daily.id}&version=eq.1`,a,'PATCH',{memo:'stale write'})),[]);
    denied(await request(`/rest/v1/cycle_daily_logs?id=eq.${daily.id}`,b,'PATCH',{created_by:b.id}));
    denied(await request(`/rest/v1/cycle_daily_logs?id=eq.${daily.id}`,b,'PATCH',{memo:'x'.repeat(301)}));
    denied(await request(`/rest/v1/cycle_daily_logs?id=eq.${daily.id}`,b,'PATCH',{symptoms:['invalid']}));
    assert.equal(ok(await request(`/rest/v1/cycle_daily_logs?id=eq.${daily.id}`,b,'DELETE')).length,1);
    const period=ok(await request('/rest/v1/cycle_records',a,'POST',{couple_id:couple,start_date:'2026-01-02',end_date:'2026-01-06'}))[0];
    assert.equal(ok(await rows('cycle_records',b,`&id=eq.${period.id}`)).length,1);
    ok(await request(`/rest/v1/cycle_records?id=eq.${period.id}`,b,'PATCH',{end_date:'2026-01-07'}));
    denied(await request('/rest/v1/cycle_records',b,'POST',{couple_id:couple,start_date:'2026-01-05',end_date:'2026-01-09'}));
    assert.equal(ok(await request(`/rest/v1/cycle_records?id=eq.${period.id}`,b,'DELETE')).length,1);
    retainedHealth=ok(await request('/rest/v1/cycle_daily_logs',a,'POST',{couple_id:couple,log_date:'2026-01-03',memo:'접근 검증용 가상 기록'}))[0];
  });
  await t.test('shared couple events: CRUD, timestamps, version and member isolation',async()=>{
    const created=ok(await request('/rest/v1/couple_events',a,'POST',{couple_id:couple,title:'가상 기념일',event_date:'2026-02-14',event_type:'anniversary',icon_key:'heart',is_yearly:true}))[0];
    assert.equal(created.created_by,a.id); assert.equal(created.version,1);
    assert.equal(created.is_yearly,true);
    assert.ok(created.created_at); assert.ok(created.updated_at);
    assert.equal(ok(await rows('couple_events',b,`&id=eq.${created.id}`))[0].title,'가상 기념일');
    const edited=ok(await request(`/rest/v1/couple_events?id=eq.${created.id}&version=eq.1`,b,'PATCH',{title:'수정한 가상 기념일',event_date:'2026-02-15',event_type:'event',icon_key:'calendar',is_yearly:false}))[0];
    assert.equal(edited.updated_by,b.id); assert.equal(edited.created_by,a.id); assert.equal(edited.version,2);
    assert.equal(edited.is_yearly,false);
    assert.equal(edited.event_date,'2026-02-15');
    assert.deepEqual(ok(await request(`/rest/v1/couple_events?id=eq.${created.id}&version=eq.1`,a,'PATCH',{title:'오래된 수정'})),[]);
    denied(await request('/rest/v1/couple_events',a,'POST',{couple_id:couple,title:'   ',event_date:'2026-02-16',event_type:'event'}));
    assert.equal(ok(await request(`/rest/v1/couple_events?id=eq.${created.id}&version=eq.2`,b,'DELETE')).length,1);
    retainedEvent=ok(await request('/rest/v1/couple_events',a,'POST',{couple_id:couple,title:'접근 격리용 일정',event_date:'2026-02-17',event_type:'event'}))[0];
    const other=ok(await rpc('create_couple',c,{p_relationship_start:'2026-01-01'}));
    assert.deepEqual(ok(await rows('couple_events',c,`&couple_id=eq.${couple}`)),[]);
    assert.deepEqual(ok(await request(`/rest/v1/couple_events?id=eq.${retainedEvent.id}`,c,'PATCH',{title:'권한 밖 수정'})),[]);
    assert.deepEqual(ok(await request(`/rest/v1/couple_events?id=eq.${retainedEvent.id}`,c,'DELETE')),[]);
    denied(await request('/rest/v1/couple_events',a,'POST',{couple_id:other,title:'다른 커플 소유 위조',event_date:'2026-02-18',event_type:'event'}));
    denied(await rows('couple_events'));
    ok(await rpc('leave_couple',c));
  });
  await t.test('another couple and anonymous cannot read/change shared health or move its ownership',async()=>{
    const other=ok(await rpc('create_couple',c,{p_relationship_start:'2026-01-01'}));
    for(const table of ['cycle_daily_logs','cycle_records']) {
      assert.deepEqual(ok(await rows(table,c,`&couple_id=eq.${couple}`)),[]);
      denied(await rows(table));
      assert.deepEqual(ok(await request(`/rest/v1/${table}?couple_id=eq.${couple}`,c,'DELETE')),[]);
    }
    denied(await request('/rest/v1/cycle_daily_logs',c,'POST',{couple_id:couple,log_date:'2026-01-05',memo:'forged'}));
    assert.deepEqual(ok(await request(`/rest/v1/cycle_daily_logs?id=eq.${retainedHealth.id}`,c,'PATCH',{memo:'forged'})),[]);
    denied(await request(`/rest/v1/cycle_daily_logs?id=eq.${retainedHealth.id}`,b,'PATCH',{couple_id:other}));
    ok(await rpc('leave_couple',c));
  });
  await t.test('third party knows couple UUID but cannot read or mutate it',async()=>{
    assert.deepEqual(ok(await rows('couples',c,`&id=eq.${couple}`)),[]);
    assert.deepEqual(ok(await rows('couple_members',c,`&couple_id=eq.${couple}`)),[]);
    assert.deepEqual(ok(await rows('couple_events',c,`&id=eq.${retainedEvent.id}`)),[]);
    assert.deepEqual(ok(await request(`/rest/v1/couple_events?id=eq.${retainedEvent.id}`,c,'PATCH',{title:'탈퇴한 계정 수정'})),[]);
    for(const user of [a,b,c]) {
      denied(await rows('couple_invites',user));
      denied(await request('/rest/v1/couple_members',user,'POST',{couple_id:couple,user_id:c.id,slot:2}));
      denied(await request(`/rest/v1/couple_members?user_id=eq.${a.id}`,user,'DELETE'));
      denied(await request(`/rest/v1/couples?id=eq.${couple}`,user,'PATCH',{relationship_start:'2026-02-01'}));
      denied(await request(`/rest/v1/couples?id=eq.${couple}`,user,'DELETE'));
    }
    denied(await rpc('set_relationship_start',c,{p_relationship_start:'2026-02-01'}));
    ok(await rpc('set_relationship_start',b,{p_relationship_start:'2026-02-01'}));
    assert.equal(ok(await rows('couples',a))[0].relationship_start,'2026-02-01');
    denied(await rpc('accept_couple_invite',c,{p_token:firstInvite.invite_token}));
  });
  await t.test('leave revokes access and old invitation replay',async()=>{
    ok(await rpc('leave_couple',b));
    assert.deepEqual(ok(await rows('couples',b,`&id=eq.${couple}`)),[]);
    denied(await rpc('accept_couple_invite',b,{p_token:firstInvite.invite_token}));
    assert.equal(ok(await rows('couple_members',a)).length,1);
    assert.deepEqual(ok(await rows('cycle_daily_logs',b,`&id=eq.${retainedHealth.id}`)),[]);
    assert.deepEqual(ok(await request(`/rest/v1/cycle_daily_logs?id=eq.${retainedHealth.id}`,b,'PATCH',{memo:'after leave'})),[]);
    assert.deepEqual(ok(await rows('couple_events',b,`&id=eq.${retainedEvent.id}`)),[]);
    assert.deepEqual(ok(await request(`/rest/v1/couple_events?id=eq.${retainedEvent.id}`,b,'PATCH',{title:'탈퇴 후 수정'})),[]);
  });
  await t.test('revoked, expired, malformed invitations are rejected without joining',async()=>{
    const revoked=ok(await rpc('create_couple_invite',a))[0];
    ok(await rpc('revoke_couple_invite',a,{p_invite_id:revoked.invite_id}));
    denied(await rpc('accept_couple_invite',b,{p_token:revoked.invite_token}));
    const expired=ok(await rpc('create_couple_invite',a))[0]; expireInvite(expired.invite_id);
    denied(await rpc('accept_couple_invite',b,{p_token:expired.invite_token}));
    denied(await rpc('accept_couple_invite',b,{p_token:'malformed'}));
    denied(await rpc('accept_couple_invite',b,{p_token:'0'.repeat(64)}));
    assert.deepEqual(ok(await rows('couple_members',b)),[]);
  });
  await t.test('two different users race for final seat: exactly one succeeds',async()=>{
    const invite=ok(await rpc('create_couple_invite',a))[0];
    const results=await Promise.all([b,c].map(u=>rpc('accept_couple_invite',u,{p_token:invite.invite_token})));
    assert.equal(results.filter(r=>r.ok).length,1);
    const members=ok(await rows('couple_members',a));
    assert.equal(members.length,2);
    assert.equal(new Set(members.map(x=>x.slot)).size,2);
    const winner=results[0].ok?b:c; const loser=results[0].ok?c:b;
    assert.deepEqual(ok(await rows('couple_members',loser)),[]);
    ok(await rpc('leave_couple',winner));
  });
  await t.test('one user races two couples: joins exactly one with rollback',async()=>{
    const other=ok(await rpc('create_couple',c,{p_relationship_start:'2026-03-01'}));
    const ia=ok(await rpc('create_couple_invite',a))[0];
    const ic=ok(await rpc('create_couple_invite',c))[0];
    const results=await Promise.all([ia,ic].map(i=>rpc('accept_couple_invite',b,{p_token:i.invite_token})));
    assert.equal(results.filter(r=>r.ok).length,1);
    assert.equal(ok(await rows('couple_members',b,`&user_id=eq.${b.id}`)).length,1);
    const counts=[ok(await rows('couple_members',a)).length,ok(await rows('couple_members',c)).length];
    assert.deepEqual(counts.sort(),[1,2]);
    // d remains unrelated even with both UUIDs.
    assert.deepEqual(ok(await rows('couples',d,`&id=in.(${couple},${other})`)),[]);
    ok(await rpc('leave_couple',b));
  });
  await t.test('invite replacement and issuance rate limit are enforced by server',async()=>{
    ok(await rpc('create_couple',d,{p_relationship_start:'2026-01-01'}));
    const issued=[];
    for(let i=0;i<5;i++) issued.push(ok(await rpc('create_couple_invite',d))[0]);
    denied(await rpc('accept_couple_invite',b,{p_token:issued[0].invite_token}));
    const limited=await rpc('create_couple_invite',d);
    denied(limited); assert.equal(limited.data.message,'invite_rate_limit');
    // Another member cannot revoke an invitation from this couple.
    ok(await rpc('revoke_couple_invite',a,{p_invite_id:issued[4].invite_id}));
    ok(await rpc('accept_couple_invite',b,{p_token:issued[4].invite_token}));
    ok(await rpc('leave_couple',b)); ok(await rpc('leave_couple',d));
  });
  await t.test('last member leaving removes empty couple and stale grants',async()=>{
    ok(await rpc('leave_couple',a)); ok(await rpc('leave_couple',c));
    for(const u of users) {
      assert.deepEqual(ok(await rows('couple_members',u)),[]);
      assert.deepEqual(ok(await rows('couples',u)),[]);
    }
  });
  await t.test('logout invalidates refresh session; local client drops access token',async()=>{
    ok(await request('/auth/v1/logout',d,'POST'));
    denied(await request('/auth/v1/token?grant_type=refresh_token',null,'POST',{refresh_token:d.refresh}));
    d.token=null; d.refresh=null;
    // Existing access JWTs may remain valid until expiry: do not claim instant JWT revocation.
  });
});
