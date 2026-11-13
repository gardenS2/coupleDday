# GC-01 원격 개발 DB 적용 기록

적용일: 2026-11-13 (Asia/Seoul)

## 대상과 사전 상태

- 앱 설정 `apps/mobile/config/env/.env.dev`의 Supabase project ref와 대시보드 프로젝트 ref가 `gllplnwnacjcujeaeuei`로 일치했다.
- 대시보드 표시는 `CoupleDday / main PRODUCTION`이었다. 사용자는 실사용자 오픈 전 테스트 데이터뿐이라고 확인했지만, 화면 표기는 운영 라벨이므로 개발/운영 분리 전까지 배포 대상 혼동 위험이 있다.
- 원격 PostgreSQL은 17.11. `couples.id`, `couple_events.id`, `couple_events.couple_id`의 기존 UUID 구조와 이벤트 컬럼을 확인했다. 신규 GC 테이블은 사전 조회 시 없었다.
- 기존 7개 migration의 효과는 기존 테이블·정책·함수 등 카탈로그와 대조했다. 원격 `supabase_migrations.schema_migrations` 이력 테이블은 없었다.
- 적용 전 복구 기준으로 프로젝트 ref, PostgreSQL 버전, 기존 migration 파일 목록, 기존 이벤트/커플 구조, GC 테이블 부재를 이 문서에 기록했다. 전체 DB dump나 개인정보를 포함한 스냅샷은 만들지 않았다.

## 적용한 migration

1. `spikes/auth-couple-poc/supabase/migrations/20261113000100_google_calendar_sync.sql` — 최종 검토 SQL의 신규 7개 테이블, 인덱스, FK/Unique/Check, 트리거/함수, RLS/grant를 추가했다.
2. `spikes/auth-couple-poc/supabase/migrations/20261113000200_google_calendar_revocation_finalize.sql` — 승인자가 변경/제거된 뒤 서버가 이전 credential을 `revocation_pending`에서 `revoked`로 안전하게 마무리하는 trigger 분기를 보완했다.

GC-01 migration은 앞서 SQL Editor로 적용했으며 기존 7개 migration SQL은 재실행하지 않았다. 이후 CLI 브라우저 인증을 다시 완료해 **Supabase CLI 2.122.0**에서 원격 DML 검증을 수행했다. 원격 migration 이력은 CLI로 읽어 로컬 9개 migration과 원격 9개 migration이 모두 일치함을 확인했다. CLI 3.1.0은 이 실행 환경의 로그인 프로필을 읽지 못했으므로, 인증이 정상 동작한 기존 CLI 버전과 `--workdir spikes/auth-couple-poc`를 사용했다.

## 자동 검증 결과

| 검증 | 결과 | 근거 |
|---|---|---|
| GC-01 테이블 | 성공 | 원격 catalog에서 7개 확인 |
| RLS | 성공 | 7개 테이블 모두 `relrowsecurity = true` |
| 제약조건·트리거 | 성공 | GC 테이블 대상 constraint 63개, 사용자 trigger 11개 확인 |
| Migration 이력 | 성공 | 기존 7개 metadata와 GC-01 두 버전 확인 |
| 로컬 migration 대응 | 성공 | 원격 GC-01 두 버전과 로컬 migration 파일이 대응하며, 00100의 DDL은 최종 draft와 동일하고 헤더 주석만 다름 |
| 커플 격리 및 권한 | 성공 | rollback 트랜잭션에서 멤버 연결 표시, 다른 커플 숨김, credentials/mapping/outbox/sync-state 차단, conflict/recovery 민감 snapshot 열 차단, anon 차단 등 7개 assertion 모두 true |
| DML·트리거 시나리오 | 성공 16/16 | `GC-01-dml-verification.sql`의 합성 데이터 검증: 동일/타 커플 이벤트 소유권, 커플 변경 차단, A→B/NULL 승인자 변경, `revocation_pending`→`revoked`, mapping/conflict/outbox 중복·snapshot 제약, event hard-delete FK와 recovery 보존, connection hard-delete 후 recovery 보존, watch metadata |
| 기존 이벤트 CRUD 회귀 | 성공 | 합성 이벤트 INSERT/UPDATE/DELETE와 version 증가 확인. 기존 이벤트는 수정하지 않음 |
| 테스트 데이터 정리 | 성공 | 스크립트 마지막 `ROLLBACK`; 후속 읽기 전용 조회에서 합성 이벤트·연결·복구 행 각각 0개 확인 |
| Google API/OAuth, Android/iOS | 미실행 | GC-01 범위 외, Google 연결 없음 |

테스트용 커플/연결 행은 트랜잭션 내에서 만들고 `ROLLBACK`했다. 기존 Auth 사용자나 기존 일정은 삭제·초기화하지 않았다.

## GC-01-CLOSE 추가 점검

- `supabase migration list --linked --workdir spikes/auth-couple-poc`에서 로컬·원격 9개 migration 버전이 모두 일치했다. GC-01 두 migration도 중복 없이 한 번씩 기록되어 있다.
- 원격 DML·trigger assertions 16/16 통과: 커플 간 event mapping 격리, linked event의 커플 이동 방지, owner A→B/NULL 전환, 토큰 폐기 마무리, 중복 mapping/open conflict/outbox 차단, 필수·허용 snapshot, event/connection hard-delete 후 recovery 보존, 기존 이벤트 CRUD.
- 검증 파일 `spikes/auth-couple-poc/supabase/drafts/GC-01-dml-verification.sql`은 전체 실행을 트랜잭션 rollback으로 끝낸다. 사후 읽기 전용 조회에서 synthetic event, connection, recovery 레코드가 각각 0개임을 확인했다. 기존 Auth 사용자와 일정 데이터는 수정하지 않았다.
- CLI 인증 복구는 프로젝트에서 쓰는 기존 CLI 2.122.0으로 브라우저 인증을 마치고 `--workdir spikes/auth-couple-poc`를 지정해 완료했다. CLI 3.1.0과 인증 프로필 저장 위치 호환성은 별도 정리 과제로 남긴다.

## 이후 안전 조건

- DB 적용만으로 Google 일정 동기화가 활성화되지는 않는다. OAuth, Edge Function/Worker, webhook, Cron, API 호출은 아직 없다.
- 기존 `couple_events` hard delete와 recovery snapshot/Outbox 적재는 같은 트랜잭션으로 연결되지 않았다. 이 원자성을 구현하고 검증하기 전에는 Google 삭제 전파를 활성화하지 않는다.
- 실제 DB 프로젝트는 앱 개발 설정과 ref가 일치하지만 대시보드에 `PRODUCTION`으로 표시된다. 실사용 시작 전 별도의 개발·운영 Supabase 프로젝트와 키를 마련하고 현재 테스트 데이터를 운영 데이터로 오인하지 않도록 전환 절차를 둔다.
- Calendar OAuth를 실제 활성화하기 전에 Google OAuth 동의 설정, 토큰 암호화 키 보관/회전, 연결 승인자 재인증 절차를 확인한다.

## GC-02 DB 확장 (2026-11-13)

- Supabase CLI 2.122.0으로 linked project `gllplnwnacjcujeaeuei`의 migration 이력을 확인했다. 최초에는 `20261113000500`만 pending이었고, 이미 적용된 migration은 재실행하지 않았다.
- 기존 `20261113000300` 및 `20261113000400`을 보존하고, 이름 충돌을 고치는 forward-only migration `20261113000500_gc02_disconnect_rpc_fix.sql` 하나만 적용했다.
- 최종 확인에서 로컬·원격 migration 12개가 모두 일치한다.
- `GC-02-remote-db-verification.sql`의 rollback DML 검사 9/9 통과: server-only grant/RLS, credential 저장, refresh rotation/CAS, stale epoch 차단, state 단일 소비, reauth 전환, disconnect fencing, callback 및 refresh 재활성화 차단.
- 사후 read-only 검사에서 테스트용 Google credential, OAuth session, 연결이 각각 0개였다. 테스트 fixture는 SQL 트랜잭션 rollback으로 제거했다.
- Google Cloud/Supabase OAuth secrets는 미설정이며 Edge Functions는 미배포다. 실제 Google OAuth 승인, provider token refresh/revoke 호출, Android/iOS 왕복은 미검증이다. Dashboard의 `main PRODUCTION` 표시는 여전히 개발·테스트 용도라는 사용자 설명과 다르므로 실사용 전 프로젝트 분리를 확인해야 한다.
