# 우리의 온도 · 모바일 앱

기존 다크/로즈 화면 스타일을 바탕으로 만든 React Native + Expo 앱입니다.
로그인/가입 → 커플 공간 생성 또는 초대 수락 → 홈/건강 기록/설정이 연결됩니다.

## 실행과 환경 설정

상세 명령, GitHub Secrets, Docker, VS Code 주요 파일은 [개발 인수인계](../../docs/07-developer-handoff.md)를 참고하세요.

```sh
npm ci
npm run ios:dev
# 또는 npm run android:dev
```

- 개발: `config/env/.env.dev`, 운영: `config/env/.env.prod`. 실제 파일은 Git 제외입니다.
- 신규 체크아웃에서는 저장소 루트에서 `config/env/.env.dev.example`, `config/env/.env.prod.example`을 각각 복사한 뒤 URL과 공개 키를 입력합니다.
- 로컬 서명 자격증명이 필요한 경우 `config/keys/`에 둘 수 있습니다. 실제 키 파일은 Git 제외이며, CI/배포 키는 GitHub Secrets 또는 EAS에 보관합니다.
- `src/config/supabase.ts`에는 키를 직접 입력하지 않습니다. 이전 `.env.local`/소스 직접 입력 방식은 사용하지 않습니다.
- `npm run ios:prod`, `npm run android:prod`는 운영 설정의 로컬 Release 실행입니다. 스토어 업로드 명령이 아닙니다.
- GitHub development/production 환경 각각의 `MOBILE_ENV_FILE` Secret을 루트 `.github/workflows/mobile-check.yml`이 주입합니다. 워크플로는 코드/번들만 검사하며 DB·스토어에 배포하지 않습니다.

환경 파일 만들기 (저장소 루트에서 실행):

```sh
cp -n config/env/.env.dev.example config/env/.env.dev
cp -n config/env/.env.prod.example config/env/.env.prod
```

## Supabase 스키마

현재 연결한 Supabase 프로젝트에는 이 저장소의 마이그레이션이 이미 적용되어 있습니다. 새 프로젝트를 준비할 때는 `../../spikes/auth-couple-poc/supabase/migrations/`의 SQL을 파일명 순서대로 검토해 적용하고, 기존 운영 데이터와 정책을 먼저 확인하세요. 실행 전에 대상 프로젝트가 개발/운영 중 어느 환경인지 확인해야 합니다.

기존 테이블이 있으면 먼저 차이를 검토하세요. Supabase Auth 이메일 가입과 이메일 확인/SMTP를 설정하고, 확인 메일을 누른 뒤 앱에서 로그인합니다. 공개 `sb_publishable_` 키만 쓰며 관리자 키는 앱에 넣지 않습니다. 스토어 배포 전 앱 식별자와 서명 설정을 별도로 변경합니다.

## 구현 범위

- 이메일 로그인/가입, 메일 인증 안내, 보안 저장소의 세션 복원 및 토큰 갱신, 로그아웃
- 시작일로 커플 생성, 초대 코드 생성/복사/폐기/수락(24시간, 일회용), 최대 2명, 연결 종료
- 두 사람이 공유하는 월별 건강 달력, 증상/기분/메모 저장·수정·삭제, 생리 기간 추가·수정·삭제
- 날짜·기간 중복 차단, 서버에서 기록 작성자/최종 수정자 관리, version을 이용한 동시 수정 충돌 감지
- 같은 커플이면 작성자 구분 없이 모두 CRUD, 미가입자/다른 커플/탈퇴자는 서버에서 차단
- 마지막 구성원까지 탈퇴하면 해당 커플과 건강 기록이 삭제됩니다. 화면에서 확인 후 실행합니다.

건강 기록은 **커플당 하나의 공유 달력**입니다. 사용자별로 별도 생리 달력을 분리하지 않습니다. 상대의 변경은 화면 재진입/새로고침/앱 복귀 시 조회하며, 실시간 푸시는 구현하지 않았습니다. 오프라인에서는 저장 완료로 표시하지 않습니다.

기존 5개 탭을 유지했으며 일반 일정 달력·일기/사진 기록은 다음 구현 대상임을 화면에 표시합니다. 별도 위젯 PoC는 `../../spikes/widget-poc`에 있습니다. 이 앱에 운영 데이터 위젯을 합치지는 않았습니다. 건강 데이터는 위젯/알림으로 내보내지 않습니다.

## 디자인 확인

키가 없어도 로그인 디자인을 볼 수 있습니다. 개발 빌드의 `화면 미리보기`에서 가상 초대/건강 화면을 확인합니다. 샘플 데이터는 서버에 저장하지 않으며 배포 빌드에서는 미리보기 경로가 차단됩니다.

네이티브 로그인 세션은 SecureStore에 분할 저장합니다. 웹은 디자인 확인용이며 세션을 메모리에만 보관합니다. 앱이 비활성 상태가 되면 가림 화면을 표시합니다. 이는 OS 수준 캡처 차단 또는 생체인증 잠금을 의미하지 않습니다.

## 로컬 DB 검증

`../../spikes/auth-couple-poc`에서 `npm ci`, `npm run start`, `npm run migrate`, `npm test`, `npm run lint:db`를 실행합니다. 이 명령은 로컬 Docker만 허용하며 운영 DB로 연결하지 않습니다. 운영 연결 후에는 별도 검증 계정 두 개로 로그인·초대·서로의 기록 수정·삭제와 탈퇴 후 접근 차단을 점검하세요.
