import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseEnv } from 'node:util';
const root=fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
if (!readFileSync('supabase/config.toml','utf8').includes('project_id = "couple-auth-local"')) throw Error('Wrong local project');
const context=JSON.parse(execFileSync('docker',['context','inspect'],{encoding:'utf8'}));
const host=process.env.DOCKER_HOST ?? context[0].Endpoints.docker.Host;
if (!host.startsWith('unix://')) throw Error('Only a local Unix Docker socket is allowed');
const dockerConfig=path.join(root,'.local-docker'); mkdirSync(dockerConfig,{recursive:true});
writeFileSync(path.join(dockerConfig,'config.json'),'{}\n',{mode:0o600});
const env={...process.env,DOCKER_HOST:host,DOCKER_CONFIG:dockerConfig};
const command=process.argv[2]; const network='couple-auth-local-net';
const commands={start:['start','--network-id',network],stop:['stop'],migrate:['migration','up','--local'],lint:['db','lint','--local']};
if (command==='start') {
  const result=spawnSync('docker',['network','inspect',network],{env,encoding:'utf8'});
  if (result.status!==0) execFileSync('docker',['network','create','--driver','bridge','--opt','com.docker.network.bridge.host_binding_ipv4=127.0.0.1',network],{env,stdio:'pipe'});
  const info=JSON.parse(execFileSync('docker',['network','inspect',network],{env,encoding:'utf8'}));
  if(info[0].Options['com.docker.network.bridge.host_binding_ipv4']!=='127.0.0.1') throw Error('Network must bind loopback only');
}
if (command==='mobile-env') {
  try {
    const status=JSON.parse(execFileSync('./node_modules/.bin/supabase',['status','-o','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
    const url=new URL(status.API_URL);
    if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='55431'||!status.PUBLISHABLE_KEY?.startsWith('sb_publishable_')) throw Error('Local config unavailable');
    const target=path.resolve(root,'../../apps/mobile/.env.dev');
    let current={};try{current=parseEnv(readFileSync(target,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(Object.values(current).some(value=>value.trim())) {
      console.error('The mobile development file already has values. Clear it deliberately before generating local settings.');process.exit(1);
    }
    writeFileSync(target,`# Local Docker Supabase only. Never commit this file.\nEXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:55431\nEXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY}\n`,{mode:0o600});
    console.log('Local mobile development file created; key values are not logged.');
  } catch {console.error('Could not create local settings. Start local Supabase first and check its publishable key support.');process.exit(1);}
  process.exit(0);
}
if (command!=='test' && !commands[command]) throw Error('Allowed: start, stop, migrate, lint, test, mobile-env');
const result=command==='test'
  ? spawnSync(process.execPath,['--test','--test-concurrency=1','tests/auth-couple.test.mjs'],{env,encoding:'utf8',maxBuffer:20*1024*1024})
  : spawnSync('./node_modules/.bin/supabase',commands[command],{env,encoding:'utf8',maxBuffer:20*1024*1024});
// CLI startup/status may include local signing/admin keys. Do not put those in output logs.
function redact(text='') {
  return text.split('\n').map(line=> /SECRET_KEY|SERVICE_ROLE_KEY|JWT_SECRET|secret key|service_role/i.test(line)?'[Local credentials omitted]':line).join('\n');
}
process.stdout.write(redact(result.stdout ?? ''));
process.stderr.write(redact(result.stderr ?? ''));
if(result.error) console.error(result.error.message);
process.exitCode=result.status ?? 1;
