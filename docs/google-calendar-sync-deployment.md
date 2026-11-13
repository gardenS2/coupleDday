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

Supabase CLI는 인증 오류(`AccessTokenRequiredError`)로 적용하지 못했고, Docker/psql도 사용할 수 없어 로그인된 대시보드 SQL Editor로 각 SQL을 트랜잭션 적용했다. 기존 7개 migration SQL은 재실행하지 않았다. 원격 migration 이력을 추후 CLI와 일치시키기 위해 확인된 기존 7개 버전/이름과 GC-01 두 버전을 `statements = NULL`로 기록했다. 이 과정에서 기존 schema 변경이나 사용자 데이터 수정은 하지 않았다. SQL Editor 방식이라 CLI dry-run은 실행하지 못했다.

## 자동 검증 결과

| 검증 | 결과 | 근거 |
|---|---|---|
| GC-01 테이블 | 성공 | 원격 catalog에서 7개 확인 |
| RLS | 성공 | 7개 테이블 모두 `relrowsecurity = true` |
| 제약조건·트리거 | 성공 | GC 테이블 대상 constraint 63개, 사용자 trigger 11개 확인 |
| Migration 이력 | 성공 | 기존 7개 metadata와 GC-01 두 버전 확인 |
| 로컬 migration 대응 | 성공 | 원격 GC-01 두 버전과 로컬 migration 파일이 대응하며, 00100의 DDL은 최종 draft와 동일하고 헤더 주석만 다름 |
| 커플 격리 및 권한 | 성공 | rollback 트랜잭션에서 멤버 연결 표시, 다른 커플 숨김, credentials/mapping/outbox/sync-state 차단, conflict/recovery 민감 snapshot 열 차단, anon 차단 등 7개 assertion 모두 true |
| 전체 DML/트리거 시나리오 | 미검증 | 첫 시도 쿼리가 클라이언트 허용 열이 아닌 conflict `connection_id`를 읽어 42501 오류. 의도된 열 권한 보호이며 트랜잭션을 rollback함. 수정된 RLS 전용 검사는 통과했으나 토큰 전환·중복 제약·삭제 복구 DML assertion은 결과를 별도로 확정하지 못함 |
| 기존 이벤트 CRUD 회귀 | 미실행 | 기존 데이터/권한을 변경하지 않음. 스키마 및 기존 RLS 상태는 읽기 전용 점검 |
| Google API/OAuth, Android/iOS | 미실행 | GC-01 범위 외, Google 연결 없음 |

테스트용 커플/연결 행은 트랜잭션 내에서 만들고 `ROLLBACK`했다. 기존 Auth 사용자나 기존 일정은 삭제·초기화하지 않았다.

## GC-01-CLOSE 추가 점검

- 로컬 파일에는 `20261113000100_google_calendar_sync.sql`과 `20261113000200_google_calendar_revocation_finalize.sql`이 있으며, SQL Editor의 원격 history 조회에서 두 버전/이름을 확인했다. 00100의 실행 DDL은 최종 통합 draft와 같고 상단 설명 주석만 다르다.
- `supabase migration list --linked`는 현재 작업 폴더가 Supabase 프로젝트에 연결되지 않아 `ProjectRefNotLinkedError`로 종료됐다. CLI를 link하거나 migration history를 수정하지 않았으므로, CLI 관점의 전체 이력 중복·불일치 비교는 미실행이다. 적용 대상 history를 위험하게 보정하지 않았다.
- GC-01-CLOSE에서 요청된 소유권·credential 전환, mapping/conflict/outbox 중복, recovery 유지 및 `couple_events` CRUD DML 회귀 검증은 실행을 마치지 못했다. 앞선 테스트 쿼리에서 허용되지 않은 conflict 열을 선택해 권한 오류가 났고, 재작성한 전체 DML 검증은 이번 환경의 브라우저 자동화가 응답하지 않아 실행되지 않았다. 테스트 스크립트는 rollback 용도로 보관했다.

## 이후 안전 조건

- DB 적용만으로 Google 일정 동기화가 활성화되지는 않는다. OAuth, Edge Function/Worker, webhook, Cron, API 호출은 아직 없다.
- 기존 `couple_events` hard delete와 recovery snapshot/Outbox 적재는 같은 트랜잭션으로 연결되지 않았다. 이 원자성을 구현하고 검증하기 전에는 Google 삭제 전파를 활성화하지 않는다.
- 실제 DB 프로젝트는 앱 개발 설정과 ref가 일치하지만 대시보드에 `PRODUCTION`으로 표시된다. 실사용 시작 전 별도의 개발·운영 Supabase 프로젝트와 키를 마련하고 현재 테스트 데이터를 운영 데이터로 오인하지 않도록 전환 절차를 둔다.
- 다음 GC-02 전에는 새 migration 이력과 기존 7개 이력 metadata 복원 방식을 CLI/배포 절차 관점에서 확인하고, 토큰 암호화 키·OAuth 동의 설정·승인자 재인증 절차를 결정한다.
