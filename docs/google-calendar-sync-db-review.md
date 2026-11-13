# GC-01 최종 SQL 검토 및 원격 적용 결과

## 판정

최종 SQL은 7개 테이블을 단일 migration으로 정리했다. 적용 파일은 `spikes/auth-couple-poc/supabase/migrations/20261113000100_google_calendar_sync.sql`이며, 승인자 변경 후 이전 토큰 폐기를 마무리하는 추가 migration은 `20261113000200_google_calendar_revocation_finalize.sql`이다. 실제 적용과 검증 결과는 아래에 기록한다.

## 보안·무결성 보완

- **이벤트 커플 소유권:** `gc01_validate_event_couple()`은 신규/수정 매핑, Outbox, conflict, recovery의 `event_id = event_key`와 실제 이벤트의 `couple_id`를 검증한다. 이벤트 행을 `FOR SHARE` 잠금해 매핑 생성과 커플 변경이 동시에 교차하지 않게 한다. 연결된 일정의 커플 재할당은 별도 BEFORE UPDATE guard가 차단한다. PostgreSQL은 해당 행의 `FOR SHARE` 잠금과 UPDATE/DELETE를 서로 대기시킨다. [row lock 규칙](https://www.postgresql.org/docs/17/explicit-locking.html)
- **OAuth 소유자 A→NULL/B:** owner 변경 trigger가 credential을 `revocation_pending`으로 격리하고 connection을 `reauth_required`로 바꾸며 `authorization_epoch`를 올린다. A의 암호문은 오직 전용 철회 worker에서만 사용 가능하다. 성공적으로 Google 철회 후 같은 DB 트랜잭션에서 암호문·nonce 삭제와 revoked 상태 반영이 필요하다. B는 새 동의/credential 생성과 검증 전까지 connection을 active로 만들 수 없다. DB epoch는 후속 요청을 fence하지만 이미 토큰을 읽은 worker의 진행 중인 외부 요청을 취소할 수는 없다.
- **Worker fencing:** sync/outbox가 `running`/`processing`으로 바뀔 때 active connection, active owner credential, lease epoch를 검증한다. Worker는 Google API 호출 직전에도 connection status·credential status·epoch를 재조회해야 한다. 이미 시작된 외부 API 요청은 DB 트랜잭션만으로 취소할 수 없다.
- **복구 기록:** recovery는 `connection_id`를 이력값으로 저장하고 해당 FK를 두지 않는다. 생성 trigger가 연결 행을 `FOR KEY SHARE` 잠금해 연결 삭제와 동시 생성을 직렬화한다. 따라서 connection hard delete 후에도 recovery는 남는다. couple 자체 삭제는 couple FK cascade로 모든 커플 데이터를 지우며, 이는 복구보다 완전 삭제를 우선하는 정책이다. [row lock 규칙](https://www.postgresql.org/docs/17/explicit-locking.html)
- **soft/hard disconnect:** 사용 중단은 `disconnected`/`revoked` 상태 전환이다. connection hard delete는 credential, mapping, sync state, outbox, conflict를 cascade 삭제하고 recovery는 보존한다. 최종 SQL은 hard delete 전에 비활성 상태·credential scrub·미처리 Outbox/유효 worker lease 없음·open conflict 없음 조건을 강제한다. couple 삭제도 이 조건을 만족하지 않으면 연결 FK cascade에서 실패한다. 운영상 retention이 끝나고 정리 대상을 확인하기 전까지 hard delete를 호출하지 않아야 한다.
- **토큰·RLS:** 인증정보는 서버 전용 테이블이며 클라이언트 권한이 없다. connection/conflict/recovery에는 커플 RLS SELECT와 민감 JSON을 제외한 열 단위 SELECT만 부여했다. 다른 커플은 `private.is_member(couple_id)`에서 차단된다. Edge Function은 service_role의 RLS 우회에 의존하기 전 요청 사용자의 JWT/UID, couple membership, 연결 소유자·활성 상태를 확인해야 한다.
- **스냅샷 최소화:** recovery/conflict 스냅샷은 이벤트 제목·날짜를 담으므로 개인정보가 될 수 있다. JSON 제약은 정규화된 이벤트 scalar 필드만 허용해 Google 설명·참석자·회의 URL·임의 중첩 payload를 차단한다. 전체 JSON은 클라이언트 권한에서 제외하고, 앱 UI에는 필요한 요약만 인증 Edge Function으로 전달한다.
- **중복:** Outbox는 고유 `operation_id`와 `(connection,event_key,source_version,operation_type)` unique, conflict는 이벤트당 open row partial unique를 둔다. conflict 중복 key 충돌은 기존 open row를 갱신/재사용해야 한다.

## 기존 이벤트 삭제와 남은 구현

최종 migration은 기존 `couple_events` DELETE에 recovery/Outbox를 생성하는 trigger/RPC를 **포함하지 않는다**. 따라서 적용만으로 삭제 동기화가 안전해지지 않는다. 삭제 기능을 Google과 연결하기 전, BEFORE DELETE trigger 또는 단일 RPC가 이벤트 스냅샷과 tombstone 및 delete Outbox를 같은 트랜잭션에 기록해야 한다. 어느 기록이든 실패하면 이벤트 삭제도 rollback하고, 정상 snapshot 기록을 확인하기 전 destructive worker를 비활성 상태로 둔다. 현재 앱의 hard delete 경로를 이 원자적 경로에 연결하고 회귀 검증하기 전에는 Google 일정 삭제 동기화를 켜면 안 된다.

410 syncToken, 401/403/404, 빈 전체 조회는 삭제로 간주하지 않는다. 410에서는 cursor만 초기화하고 전체 결과 미리보기/차이 검토로 전환한다. 5건 이상 또는 추적 일정 대비 20% 이상이면서 2건 이상 삭제 후보인 경우 `full_sync_review`/deletion hold 상태에 멈춰야 한다. 최종 스키마는 해당 batch의 후보 수와 분모를 기록하지만, 판단과 hold 동작은 worker 구현이 수행한다.

## 검증 상태 및 적용 결과 (2026-11-13)

- **정적 검토:** 7개 테이블, PK/FK/unique/check, RLS/grant, owner/event/recovery/worker trigger 흐름을 검토했다. PostgreSQL trigger 문법의 `INSERT OR UPDATE OF` 및 행 잠금 동작은 공식 문서와 대조했다. [CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html)
- **기존 타입:** 프로젝트 migration source와 적용 대상 원격 catalog 모두에서 `couples.id`, `couple_events.id`, `couple_events.couple_id`가 UUID임을 확인했다. 기존 이벤트 테이블의 형식과 GC-01 FK가 호환된다.
- **원격 적용:** 앱 `.env.dev` project ref와 대시보드 ref가 `gllplnwnacjcujeaeuei`로 일치했다. SQL Editor로 두 GC-01 migration을 적용했다. 대시보드 project badge는 `main PRODUCTION`으로 표시되어 있어, 사용자가 밝힌 테스트 전용 상태와 표기가 다르다는 환경 위험을 남긴다.
- **migration 이력:** 원격에 기존 migration history가 없어, 기존 7개 migration의 버전/이름 메타데이터만 등록하고 SQL은 재실행하지 않았다. GC-01 버전 두 개도 기록됐다. 이 이력 복원 방식과 대상 버전은 별도 deployment log에 적었다.
- **성공:** 원격 카탈로그에서 GC-01 테이블 7개, RLS 활성 테이블 7개, 제약조건 63개, 사용자 트리거 11개 및 두 GC-01 migration history를 확인했다. rollback 트랜잭션의 RLS 권한 검사는 커플 멤버 connection 허용, 타 커플 차단, credentials/mapping/outbox/sync-state 클라이언트 차단, conflict/recovery 스냅샷 열 차단, anon 차단 7개 모두 `true`였다.
- **실패/재검증:** 첫 넓은 DML 검증 쿼리는 제한된 conflict 열(`connection_id`)을 조회해 `42501 permission denied`로 끝났다. 이는 의도된 열 권한 경계를 반영한 테스트 쿼리 오류다. 그 트랜잭션은 rollback 후, 수정된 RLS 검사 7/7을 통과했다.
- **미검증:** owner A→B/NULL 토큰 폐기, mapping/outbox/conflict 중복 제약, event 커플 이동 차단, 이벤트 hard delete FK/recovery 보존 등 DML·trigger 동작별 assert 결과는 확정하지 못했다. Supabase CLI dry-run 및 migration runner 적용도 CLI 인증이 되지 않아 사용하지 않았다. RLS 재검증 SQL은 `spikes/auth-couple-poc/supabase/drafts/GC-01-remote-rls-verification.sql`에 보관했다.
- **기존 DB 회귀:** 기존 `couple_events` 데이터와 RLS를 읽기 전용으로 확인했으나, 별도 CRUD 쓰기 회귀는 수행하지 않았다. 테스트 쿼리의 DML 흐름은 최종 결과를 반환하지 못해 성공으로 집계하지 않는다.
- **적용 판단:** schema migration은 적용 완료다. 그러나 이 결과만으로 동기화 기능을 켤 수 없다. 삭제 snapshot/Outbox 원자성, Worker와 credential revoke/fencing을 구현·검증하기 전 Google 일정 삭제 전파는 금지한다.

## GC-02 전 잔여 결정

공유 캘린더 승인자 선정·소유권 넘김 절차, 두 파트너 편집 권한 증명 방식, OAuth scope/동의 및 Google 검증, 암호화 키 보관·회전·복구, 초기 가져오기 승인 권한, 30일 만료/법적 삭제 우선순위, 대량 삭제 기준의 batch 경계와 override 권한을 확정해야 한다.
