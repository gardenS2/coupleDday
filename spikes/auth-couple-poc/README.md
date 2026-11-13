# 로컬 인증·커플 연결 검증

이 폴더는 단계 1의 독립 서버 검증용이다. 원본 Android/위젯 PoC와 분리되어 있으며 운영 프로젝트에 연결하지 않는다. 모바일 화면은 포함하지 않는다.

요구 환경: Node 22 권장, 실행 중인 Docker Desktop, npm. Supabase CLI 2.122.0은 lockfile로 고정한다.

```sh
npm ci
npm start
npm test
npm run lint:db
npm run stop
```

`npm start`는 이름이 `couple-auth-local`인 전용 로컬 Supabase 스택과 `couple-auth-local-net` 네트워크를 사용한다. API 127.0.0.1:55431 / DB 127.0.0.1:55432만 노출한다. Docker의 기존 자격증명 도우미에 의존하지 않도록 `.local-docker/`에 빈 설정을 만들고 공개 이미지만 받는다. 기존 Docker 계정·설정·다른 컨테이너는 수정하지 않는다. Docker를 시작하면 기존 컨테이너가 자체 restart 정책에 따라 시작될 수 있으므로 다른 컨테이너를 임의로 종료하지 않는다.

테스트는 실제 로컬 Auth API로 `@example.test` 가상 계정을 생성한다. 상태 조회의 공개 키와 사용자 JWT만 API 요청에 사용하고, 로컬 관리자 SQL은 만료 fixture와 가상 계정 정리에만 사용한다. 권한 검증을 관리자 권한으로 수행하지 않는다. 테스트 종료 hook은 해당 실행에서 생성한 계정을 정리한다. 원격 URL과 remote Docker socket은 허용하지 않는다. 실행 중인 프로젝트의 포트를 임의로 다른 서비스에 재사용하지 않는다.

설정은 개발 전용이다: 이메일 확인과 실제 메일 전송을 사용하지 않으며 Storage·Realtime·Edge Functions·Studio도 비활성이다. 이 설정을 운영에 배포하지 않는다. `supabase link`, `db push`, 실사용자 가입, 배포 명령은 없다.

## 파일

- `supabase/migrations/20261026000100_auth_couple.sql`: profiles/couples/couple_members/couple_invites, RLS, grants, 원자적 RPC.
- `tests/auth-couple.test.mjs`: 실제 Auth/PostgREST 기반 권한·동시성·세션 검증.
- `scripts/local.mjs`: 로컬 전용 실행, 개인 Docker 자격증명 미사용, CLI 키 출력 제외.
- `logs/integration-loopback.log`: 최종 테스트 결과.
- `logs/db-lint-final.log`: 최종 DB 검사.
- `../../docs/05-auth-couple-flow-report.md`: 구현 결과, API 계약과 한계.

새 마이그레이션 적용은 `npm run migrate`로 로컬에만 수행한다. 기본 정지 명령은 DB 볼륨을 보존한다. 작업 종료 시 테스트 스택을 정지했으므로 사용 전 `npm start`가 필요하다.

## 모바일 로컬 연결

`npm start`와 `npm run migrate` 후 `npm run env:mobile`로 비어 있는 `../../config/env/.env.dev`에 로컬 URL/공개 키를 기록합니다. 값이 이미 있으면 덮어쓰지 않습니다. Android/iOS 실행 및 Docker 필요 여부는 [개발 인수인계](../../docs/07-developer-handoff.md)를 참고하세요.
