# Google Calendar 동기화 DB·상태 설계안 (GC-01)

상태: GC-01 최종 채택안. 원격 Supabase 프로젝트 `gllplnwnacjcujeaeuei`에 2026-11-13 적용했다. Google 계정은 연결하지 않았고 실제 동기화는 미구현이다. 적용/검증 상세는 `docs/google-calendar-sync-deployment.md`에 기록했다.

## 1. 기존 구조 재사용

- 앱의 Supabase 사용자 식별자는 `session.user.id`로 유지한다. Google Calendar 동의는 Google 로그인/계정 교체와 분리하고 기존 커플·이벤트 구조를 변경하지 않는다.
- `public.couple_events`의 UUID, `couple_id`, `event_date`, 포함형 `end_date`, `is_yearly`, `version`을 앱 측 원본으로 둔다. 기존 일정 CRUD와 `private.is_member(couple_id)` RLS는 이 초안에서 변경하지 않는다.
- `couple_events`는 현재 삭제가 hard delete다. 안전한 삭제 전파를 위해 후속 단계에서 삭제 전 스냅샷/outbox를 같은 DB 트랜잭션에 기록해야 한다. 이번 SQL은 이벤트 트리거나 기존 테이블 변경을 포함하지 않는다.
- 건강/생리 기록, 사진, 메모 등은 동기화 범위에서 제외한다.

## 2. 제안 테이블

| 테이블 | 목적 및 주요 제약 | 클라이언트 접근 |
|---|---|---|
| `google_calendar_connections` | 커플 연결 이력, 선택 `calendar_id`, 연결 승인자·상태·scope·authorization epoch; 부분 unique index로 커플당 해제 전 활성 파이프라인 1개 | 허용 열의 커플 멤버 SELECT만 |
| `google_calendar_credentials` | 승인 계정의 Google `sub`, 암호문·nonce·키 버전·scope·토큰 상태; connection당 한 credential, 서버가 owner UID와 승인된 connection을 검증 | 전면 차단, Edge Function 전용 |
| `google_calendar_event_mappings` | 영속 `event_key`, nullable `event_id`, Google ID·ETag·마지막 동기화 version/hash/base snapshot; `(connection_id,event_key)` 및 `(calendar_id,google_event_id)` unique | 전면 차단 |
| `google_calendar_sync_state` | connection당 syncToken, watch channel/resource/만료, 재시도·일시정지·worker lease, 최초 가져오기 미리보기 상태 | 전면 차단 |
| `google_calendar_outbox` | 이벤트 스냅샷을 가진 upsert/delete 큐; operation UUID와 `(connection,event_key,source_version,operation)` unique, lease/retry/dead-letter | 전면 차단 |
| `google_calendar_conflicts` | base/app/Google 양쪽 스냅샷, 앱 version·Google ETag, 해결 상태 | 멤버는 비민감 열만 SELECT, 서버만 기록 |
| `google_calendar_recovery_records` | 원본 및 Google ID, 삭제 원천, 이벤트 스냅샷, 30일 만료·복구 상태 | 멤버는 비민감 열만 SELECT, 서버만 기록 |

모든 자식 행은 `(connection_id,couple_id)` FK(매핑은 calendar_id 포함)로 다른 커플 pipeline과의 혼합을 방지한다. recovery는 연결 hard delete 후에도 남도록 connection FK를 의도적으로 두지 않으며 생성 시 connection을 잠그고 커플을 검증한다. 적용 전 원격 `couples.id` 및 `couple_events.id`가 UUID임을 확인했다. 두 migration은 7개 테이블, FK/unique/check, RLS/grant 및 트리거를 추가했다. 기존 테이블과 건강 데이터는 변경하지 않았다.

## 3. RLS·비밀정보

- 연결 상태, 충돌 및 복구 기록은 RLS를 켜고 `private.is_member(couple_id)`를 사용하는 SELECT만 인증 클라이언트에 허용한다. 클라이언트 INSERT/UPDATE/DELETE는 허용하지 않는다.
- 자격증명, ID 매핑, sync state, outbox는 RLS를 켜고 `anon`/`authenticated` 권한을 모두 회수한다. 서버 작업만 `service_role`을 사용한다. Edge Function은 service role 사용 전 JWT의 `auth.uid()`와 커플 멤버십/역할을 검증한다.
- refresh token은 Edge Function에서 AES-256-GCM으로 암호화한 뒤 ciphertext와 12-byte nonce, key version만 DB에 둔다. 암호화 키, OAuth client secret, Supabase service-role key는 Supabase Function secrets에 두며 SQL, 앱, `EXPO_PUBLIC_*`, 로그에는 두지 않는다. 키 교체는 key version별 복호화 후 재암호화 절차로 수행한다.
- access token은 서버 메모리에서 짧게 사용하고 영속화하지 않는다. refresh token이 회전되거나 새 값이 반환되면 암호문을 원자적으로 갱신한다. 연결 해제/철회 시 Google revoke를 시도하고 암호문을 제거하며 상태만 남긴다.
- 이 설계는 DB 암호화 키의 운영·복구 책임을 프로젝트 운영자에게 둔다. 별도 KMS를 도입할지, Edge Function secret 기반 키를 쓸지 GC-02 전에 확정해야 한다.

## 4. OAuth 및 동기화 구조

- 기존 Supabase 계정과 UID를 계속 사용한다. Google Calendar API 동의는 기존 앱 인증 세션과 별개로 하고, 커플당 승인된 Google 계정 하나가 공유 캘린더 작업을 담당한다.
- 서버 측 authorization-code 교환에서 offline access를 요청하고 refresh token은 서버만 받는다. Supabase Auth의 provider 로그인 자체가 Google provider token을 계속 갱신해 준다고 가정하지 않는다.
- 최소 Calendar scope를 요청하고 선택한 `calendar_id`만 서버 allowlist로 취급한다. Scope가 사용자 접근 가능 캘린더 전반에 적용될 수 있으므로 요청 payload의 calendar ID를 신뢰하지 않고 DB의 활성 connection 값과 대조한다.
- Supabase Edge Functions + Cron을 기본안으로 둔다. 이벤트 변경 outbox 처리, syncToken 증분 조회, 만료 전 watch 갱신을 서버에서 수행한다. 공개 HTTPS webhook은 헤더의 channel/resource를 검증하고 변경 알림만 큐에 넣는다. 알림 본문을 변경 데이터로 신뢰하지 않는다.
- 저장소에는 현재 Edge Function/worker 구성이 확인되지 않아, GC-02/GC-04에서 함수·cron·webhook 배포 및 비밀 설정이 추가되어야 한다. Cron/Webhook의 재시도와 단일 worker lease를 함께 사용한다.

## 5. 매핑·재시도·충돌 흐름

1. 앱 변경은 승인 후 DB 트랜잭션에서 outbox에 이벤트 스냅샷, 이벤트 key, `version`, operation UUID를 넣는다. Google-origin 변경은 서버 전용 RPC/트랜잭션에서 원본 이벤트를 반영하되 outbound outbox를 만들지 않아 루프를 끊는다. 기존 `version`은 낙관적 충돌 검사에 사용한다.
2. Worker는 connection 단위 lease로 단일 스트림을 직렬 처리한다. Google 생성 전에 deterministic Google event ID 또는 별도 예약 매핑을 영속화해 timeout 후 재시도에도 같은 이벤트를 갱신한다. 성공 후 Google ID·ETag·base snapshot을 매핑에 기록한다. `iCalUID`는 키로 쓰지 않는다.
3. Google push는 syncToken을 이용해 서버가 다시 조회한다. Google에서 종일 종료일은 배타적이므로 앱의 포함형 `end_date`를 Google `end.date`에 +1일로 변환하고 돌아올 때 -1일 처리한다. 기간 일정은 한 이벤트 한 매핑으로 유지한다.
4. 양쪽이 마지막 base snapshot 이후 바뀌었으면 자동 덮어쓰지 않는다. base/app/Google snapshot과 앱 version·Google ETag를 conflict row에 보존하고 사용자 선택 전 해당 이벤트만 보류한다. Google 수정은 ETag 조건부 요청을 쓰고 412는 충돌로 처리한다.
5. 최초 Google 가져오기는 새/변경/중복/삭제 후보 preview를 만든 후 커플 사용자가 승인해야 반영한다. Google 반복 일정 마스터/예외, unsupported event, 앱의 `is_yearly`/기간 의미 차이는 승인 전 자동 덮어쓰지 않는다.

## 6. 삭제·대량 삭제·복구·장애

- 삭제는 우선 tombstone과 전체 복구 스냅샷을 저장한 뒤 외부 삭제를 큐에 넣는다. 30일이 지난 항목은 정리할 수 있지만, 법적 완전 삭제/철회 요청이 우선한다.
- 한 번의 증분 동기화에서 삭제가 5건 이상, 또는 전체 추적 일정의 20% 이상이며 2건 이상이면 destructive sync를 멈추고 `full_sync_review`/`held_for_review` 상태로 수동 확인을 요청한다. 비율 분모가 0인 경우에는 자동 삭제하지 않는다.
- 권한 오류(401/403/404), 빈 전체 조회, syncToken 만료(410), Supabase 장애/빈 DB를 삭제로 해석하지 않는다. 410은 토큰만 초기화하고 Google mirror를 다시 수집해 preview/diff 후 승인받는다.
- 앱 hard-delete를 보존하려면 GC-04에서 삭제 BEFORE trigger 또는 RPC가 같은 트랜잭션 안에서 recovery snapshot과 outbox를 먼저 쌓고, mapping.event_id를 null로 처리해야 한다. 스냅샷 기록 실패 시 삭제 트랜잭션 전체를 실패시켜야 한다.
- Supabase가 중단되면 Google에 이미 반영된 일정은 Google에 남는다. 복구 후 syncToken/전체 미리보기로 대조하며, DB가 비었다는 이유로 Google 일정을 삭제하지 않는다. Google 캘린더의 제거/계정 철회도 로컬 snapshot 확인 및 권한 정상화 전 destructive propagation으로 이어지지 않는다.

## 7. GC-02 전 결정 필요

1. 공유 캘린더 승인자는 한 명만 유지할지, 두 사람 중 어느 쪽이 승인하는지, 해당 계정의 연결 해제/커플 탈퇴 때 소유권을 어떻게 넘길지.
2. 두 멤버 모두 Google 캘린더 편집 권한을 갖는지 어떻게 확인할지(ACL scope 추가 또는 상대방 확인 절차). 기본 Calendar events scope만으로 partner ACL을 확정할 수 있는지 별도 검증.
3. OAuth는 시스템 브라우저 authorization code + PKCE로 구현할지, 교환을 Edge Function에서 완료할지; client ID, redirect URI, test/published 상태 및 OAuth verification 준비.
4. refresh token 암호화 키 저장/회전/백업 책임과 장애 시 복구 절차. 장기적으로 Supabase secret만 쓸지 외부 KMS를 둘지.
5. DB가 `spikes/auth-couple-poc`의 실험 migration 이력과 일치하는지, production 적용 전 schema drift 확인·백업·복구 계획.
6. 최초 가져오기 preview의 화면/승인 권한, unsupported Google event·반복 일정·삭제된 반복 인스턴스 정책.
7. 대량 삭제 보호 임계치 적용 단위(한 notification batch vs 한 reconciliation run), percentage 분모/중복 occurrence 계산 및 override 권한.
8. 30일 복원 UI, hard delete 유예 기간, 계정 철회 시 Google OAuth token revoke와 Google 일정 유지/삭제 중 사용자가 선택할 정책.

## 8. 적용 migration 범위 및 한계

최종 migration과 후속 credential revocation migration은 신규 구조만 변경하고 기존 migration 파일, `couple_events`, 커플 및 건강 기록 권한은 변경하지 않는다. 이벤트 outbox를 실제로 발생시키는 trigger/RPC, Edge Function, cron, OAuth 및 Google API 요청은 포함되지 않아 적용 후에도 동기화는 동작하지 않는다. 특히 삭제 시 recovery snapshot/outbox 원자성과 삭제 전파 차단 worker가 구현·검증되기 전 Google 일정 삭제는 금지한다.
