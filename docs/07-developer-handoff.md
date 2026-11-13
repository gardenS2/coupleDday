# 개발·운영 환경과 VS Code 인수인계

2026-11-11 기준. 저장소 전체 루트를 `coupleDday/`로 가정합니다. 대상 GitHub 저장소는 `gardenS2/coupleDday`입니다. 원격 저장소의 `development`/`production` 환경은 생성되어 있습니다. 프로젝트 문서만 GitHub에 업로드했으며, 실제 Secret 등록·앱 소스 업로드·Actions 실행은 아직 하지 않았습니다.

## 1. 바로 실행하기

예시의 `REPO_ROOT`는 이 저장소를 체크아웃한 로컬 경로입니다. 명령을 실행하기 전에 `REPO_ROOT=/path/to/coupleDday`로 지정하세요.

VS Code에서 `$REPO_ROOT` 폴더를 엽니다. 내장 터미널에서:

```sh
cd "$REPO_ROOT/apps/mobile"
npm ci
npm run ios:dev
# 또는
npm run android:dev
```

Node 22.13 이상(22 LTS 권장), iOS는 macOS + Xcode/시뮬레이터/CocoaPods, Android는 Android Studio + SDK + 실행 가능한 에뮬레이터가 필요합니다. Android SDK를 찾지 못하면 macOS 터미널에서:

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

최초 네이티브 빌드에는 시간이 걸립니다. Android는 설치된 Gradle/SDK와 호환되는 JDK가 필요하며 이 작업 환경은 JDK 17을 사용했습니다. iOS는 기본적으로 시뮬레이터에서 확인하고, 실기기 배포 서명은 별도 설정합니다.

| 명령 (`apps/mobile`에서 실행) | 설정 파일 | 동작 |
|---|---|---|
| `npm run android:dev` | `.env.dev` | Android 개발 빌드 및 실행, Metro 8082 |
| `npm run ios:dev` | `.env.dev` | iOS 개발 빌드 및 실행, Metro 8082 |
| `npm run start:dev` | `.env.dev` | 개발 JS 서버만 시작, 캐시 초기화 |
| `npm run android:prod` | `.env.prod` | Android release 변형 로컬 실행 |
| `npm run ios:prod` | `.env.prod` | iOS Release 구성 로컬 실행 |
| `npm run export:dev` / `npm run export:prod` | 해당 파일 | Android/iOS/web JS 번들 검사, `dist/` 생성 |
| `npm run test:env` | 실제 키 불필요 | 설정 격리·검증·CI 임시 파일 테스트 |
| `npm run typecheck` / `npm run lint` | 실제 키 불필요 | 타입 및 코드 검사 |

#재 빌드
cd "$REPO_ROOT/apps/mobile"
npm run ios:dev
npm run android:dev

기존 `npm run android`, `npm run ios`, `npm start`는 dev 명령의 별칭입니다. `npx expo ...`를 직접 실행하면 이 환경 선택기를 우회하므로 위 명령을 사용합니다. 환경/키를 바꿀 때는 기존 Metro 터미널에서 Ctrl+C로 종료하고 다시 시작하세요. 동일 포트의 이전 서버를 계속 쓰면 이전 설정이 남을 수 있습니다. 이미 다른 서버가 8082를 사용하면 종료하거나 두 실행 명령에 동일한 `--port`를 지정합니다.

예: 특정 iOS 시뮬레이터 선택은 `npm run ios:dev -- --device`입니다. 개발 Android의 로컬 DB 주소는 자동으로 `10.0.2.2`로 바뀝니다. 두 플랫폼을 동시에 테스트할 때 로컬 DB 주소가 다른 번들이 섞이지 않도록 iOS를 종료한 뒤 Android 명령으로 서버를 새로 시작하는 순차 검증을 권장합니다. 클라우드 개발 DB는 두 플랫폼에서 같은 URL을 사용합니다.

`prod`는 **운영 DB에 연결**하는 설정입니다. 로컬 release 실행이 스토어 업로드를 뜻하지 않습니다. 현재 Android release 서명은 테스트용이고, 앱 식별자도 `com.example.coupledday.mobile`입니다. 스토어 서명과 식별자는 출시 전에 별도로 설정해야 합니다.

## 2. 환경 파일

개발은 **`.env.dev`**, 운영은 **`.env.prod`**. 둘 다 `apps/mobile/`에 있습니다. 실제 파일은 Git 제외, `.example` 파일만 공유합니다. 신규 체크아웃에서는 다음처럼 복사합니다. 기존 파일이 있을 때는 덮어쓰지 마세요.

```sh
cp -n .env.dev.example .env.dev
cp -n .env.prod.example .env.prod
```

두 파일의 형식:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=
# #여기에 운영key추가 — 공개용 sb_publishable_... 키
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

개발 파일에는 개발 프로젝트 키, 운영 파일에는 운영 프로젝트 키를 입력합니다. 개발 파일 두 값이 모두 빈 경우 화면 디자인 미리보기만 가능하며 로그인은 비활성입니다. 운영 실행과 CI 번들 검사는 빈 값을 거부합니다. 운영은 원격 HTTPS URL만 허용합니다.

설정은 `scripts/expo-env.mjs`가 정확히 한 파일만 읽어 전달합니다. `.env.local`, `.env.production` 등의 자동 로딩은 끄고, 터미널에 남은 기존 `EXPO_PUBLIC_*` 변수도 제거합니다. `NODE_ENV`를 개발/운영 DB 선택 용도로 바꾸지 않습니다.

`src/config/supabase.ts`에는 더 이상 키를 직접 적지 않습니다. GitHub Secrets로 관리해도 `EXPO_PUBLIC_*` 값은 최종 앱 번들에서 읽을 수 있습니다. 공개 키만 사용하고 관리자 키, DB 비밀번호, `service_role`, `sb_secret_`는 넣지 않습니다. 데이터 접근 제한은 로그인 JWT와 DB RLS가 담당합니다.

## 3. GitHub Secrets 연결

[gardenS2/coupleDday 환경 설정](https://github.com/gardenS2/coupleDday/settings/environments)에 **development**, **production** 두 환경이 생성되어 있습니다. 각 환경에 같은 이름의 Environment secret **`MOBILE_ENV_FILE`**을 만듭니다.

| GitHub Environment | Secret 이름 | 넣을 내용 |
|---|---|---|
| development | MOBILE_ENV_FILE | 클라우드 개발 Supabase용 `.env.dev` 파일 전체 내용 |
| production | MOBILE_ENV_FILE | `.env.prod` 파일 전체 내용 |

GitHub runner에는 개발자 Mac의 Docker가 없으므로 development Secret에 `localhost` 주소를 넣어 원격 DB 연결 테스트를 기대하면 안 됩니다. 이 워크플로는 DB 접속 없이 번들 생성만 검사합니다. 실제 원격 동작에는 클라우드 개발 프로젝트 URL을 사용합니다.

저장소 루트의 `.github/workflows/mobile-check.yml`을 올린 뒤 Actions → Mobile environment check → Run workflow에서 dev/prod를 선택합니다. 선택된 GitHub 환경의 Secret으로 파일을 권한 600으로 만들고 → 환경 테스트/타입 검사/lint/3개 플랫폼 JS 번들 생성 → 성공·실패와 관계없이 파일을 정리합니다. 파일 내용을 로그에 출력하거나 artifact로 업로드하지 않습니다. 실제 DB 마이그레이션, 사용자 생성, APK/IPA 서명, 스토어 배포는 실행하지 않습니다. production 환경의 승인자/허용 브랜치는 저장소 관리자가 설정할 수 있습니다.

GitHub CLI를 쓰는 경우 실제 저장소명을 지정한 다음 로컬 파일에서 직접 등록할 수 있습니다. 아래는 사용자가 실행할 예시이며 아직 실행하지 않았습니다.

```sh
gh secret set MOBILE_ENV_FILE --repo gardenS2/coupleDday --env development < apps/mobile/.env.dev
gh secret set MOBILE_ENV_FILE --repo gardenS2/coupleDday --env production < apps/mobile/.env.prod
```

GitHub Secrets는 등록 후 원문을 다운로드하는 저장소가 아닙니다. 로컬 실행에는 로컬 파일을 별도로 가지고 있어야 합니다. 파일이 과거에 이미 커밋됐다면 ignore만으로 기록이 지워지지 않습니다. 추적 여부를 확인하고 필요하면 추적 해제와 키 교체를 수행하세요.

**현재 폴더 주의점:** 루트는 아직 Git 저장소가 아니며, 루트 `.gitignore`라는 이름은 기존 이미지가 있는 **디렉터리**입니다. 이를 임의로 옮기거나 지우지 않았습니다. 앱 환경 파일 제외 규칙은 `apps/mobile/.gitignore`에 있으므로 루트를 Git으로 관리할 때도 적용됩니다. 저장소 최초 등록 전에 기존 `.gitignore/` 이미지 폴더를 Git 외부로 보관할지 정리하고 루트 ignore 파일을 마련해야 합니다. 원본 개인 이미지를 `git add .`로 올리지 마세요. `apps/mobile`만 별도 저장소로 올릴 경우 워크플로 위치와 `working-directory`/lockfile 경로를 수정해야 합니다.

## 4. Docker는 언제 필요한가?

| 테스트 방식 | Docker |
|---|---|
| 키 없이 디자인 미리보기 | 필요 없음 |
| Supabase 클라우드 개발/운영 프로젝트에 연결 | 필요 없음 |
| 내 Mac의 로컬 Auth/DB/RLS 테스트 | 필요함 |

Docker는 앱 화면 서버가 아니라 **로컬 Supabase 백엔드**를 실행합니다. 화면의 JS 개발 서버는 `apps/mobile`의 Expo/Metro가 담당합니다. Docker Desktop을 앱에서 실행하고 엔진이 준비되면 VS Code 터미널에서:

```sh
cd "$REPO_ROOT/spikes/auth-couple-poc"
npm ci
npm start
npm run migrate
npm run env:mobile
npm test
npm run lint:db
```

`npm run env:mobile`은 로컬 공개 키만 골라 `apps/mobile/.env.dev`에 기록합니다. 관리자 키를 출력하지 않으며, 기존 파일에 값이 있으면 덮어쓰지 않고 중단합니다. 기존 클라우드 개발 설정은 따로 보관하고 값이 비어 있는 개발 파일에서 실행하세요. 로컬 Supabase가 실행 중이어야 하며 CLI가 `PUBLISHABLE_KEY`를 제공해야 합니다.

이후 다른 터미널에서 `apps/mobile`로 이동해 `npm run ios:dev` 또는 `npm run android:dev`를 실행합니다. 로컬 API는 `http://127.0.0.1:55431`, DB는 `127.0.0.1:55432`입니다. Android 에뮬레이터에서는 실행 스크립트가 API URL을 `http://10.0.2.2:55431`로 바꿉니다. Android 실기기의 localhost는 휴대전화 자체이므로 이 로컬 구성 대신 클라우드 개발 DB를 사용하세요. 단순히 Mac의 LAN IP로 변경하는 것은 지원하지 않습니다.

로컬 설정은 이메일 확인을 생략하고 실제 메일을 보내지 않습니다. 클라우드 환경에서는 이메일 공급자/인증/SMTP 설정을 별도로 해야 합니다. 운영 DB 설치는 README의 두 SQL 순서를 따르며, 로컬 config.toml을 운영에 덮어쓰지 않습니다.

종료:

```sh
cd "$REPO_ROOT/spikes/auth-couple-poc"
npm run stop
```

기본 정지는 DB 볼륨을 보존합니다. 다른 Docker 컨테이너는 건드리지 않습니다. 기존 개인 Docker 자격증명 대신 이 프로젝트의 `.local-docker/` 설정과 `couple-auth-local-net` 네트워크를 사용합니다. Docker가 시작되지 않았거나 포트가 점유되면 먼저 엔진 상태/포트 사용을 확인하세요. `db reset`은 이 가이드에 필요하지 않습니다.

## 5. VS Code에서 읽을 소스 순서

| 파일/폴더 | 역할·수정할 때 볼 부분 |
|---|---|
| `apps/mobile/package.json` | 실행 명령, SDK/패키지 버전 |
| `apps/mobile/scripts/environment.mjs` | 파일 선택, URL/키 검증, Android 주소 변환 |
| `apps/mobile/scripts/expo-env.mjs`, `ci-env.mjs` | 로컬 Expo 실행 / GitHub Secret 임시 파일 처리 |
| `apps/mobile/src/config/supabase.ts` | 번들에 들어가는 공개 환경변수 참조 |
| `apps/mobile/src/lib/supabase.ts` | Supabase 클라이언트, SecureStore 세션 저장, 오류 문구 |
| `apps/mobile/src/lib/auth.tsx` | 로그인 상태, 커플 조회, 복원/갱신/로그아웃 |
| `apps/mobile/src/app/_layout.tsx`, `index.tsx` | 인증 공급자, 비활성 화면 가림, 로그인/연결/홈 분기 |
| `apps/mobile/src/screens/Login.tsx` | 이메일 로그인/가입 UI 및 요청 |
| `apps/mobile/src/screens/Connect.tsx` | 시작일·초대 코드 입력 및 커플 연결 |
| `apps/mobile/src/screens/Health.tsx` | 건강 달력, 증상·기분·메모·기간 CRUD UI |
| `apps/mobile/src/lib/health.ts` | 날짜 검사, DB 조회/저장/삭제 및 version 충돌 처리 |
| `apps/mobile/src/components/ui.tsx` | 공통 색상, 카드, 입력창, 버튼, 여백 |
| `apps/mobile/src/app/(tabs)/settings.tsx` | 초대 생성/복사/폐기, 커플 종료 |
| `apps/mobile/src/app/preview.tsx` | 개발 전용 가상 데이터 디자인 미리보기 |
| `spikes/auth-couple-poc/supabase/migrations/` | 001 인증·커플, 002 공유 건강기록·RLS, 20261105 기존 가입자 프로필 보완 |
| `spikes/auth-couple-poc/tests/auth-couple.test.mjs` | 실제 로컬 사용자 권한·동시성·탈퇴 검사 |
| `.github/workflows/mobile-check.yml` | 수동 실행 CI, 환경 Secret 주입·검사·삭제 |
| `spikes/widget-poc/` | 별도 위젯 검증 앱. 본 모바일 앱과 아직 통합되지 않음 |

수정은 `src/`, `scripts/`, `app.json`에서 시작합니다. `node_modules`, `dist`, 자동 생성 `ios/`, `android/`는 일반 화면 개발의 수정 대상이 아닙니다. 네이티브 설정을 바꿔야 할 때는 Expo 설정/플러그인과 재생성 영향을 먼저 확인합니다.

## 6. 기능 인수인계와 검증 범위

건강기록은 커플당 하나의 공유 달력이며 작성자와 관계없이 같은 커플 두 사람 모두 조회/수정/삭제할 수 있습니다. 외부 커플·미인증·탈퇴자는 서버에서 차단합니다. 마지막 구성원까지 탈퇴하면 공유 기록이 삭제됩니다. 화면 확인 후 두 계정으로 연결 → 한쪽 작성 → 다른 쪽 수정·삭제 → 탈퇴 후 차단까지 점검하세요.

화면 디자인/iOS 실행과 로컬 DB 권한 테스트는 이전 작업에서 확인했습니다. 이번 변경은 환경 선택, GitHub 주입 파일 처리, Git 제외 규칙과 코드 검사를 검증합니다. 실제 GitHub Actions와 운영 키 연결, Android 홈 위젯 최종 표시, 스토어 서명·배포는 별도 확인 항목입니다. 의존성 검사에 남은 경고도 출시 전 호환 업데이트 및 재검증이 필요합니다.

공식 근거: [Expo 환경변수](https://docs.expo.dev/guides/environment-variables/), [GitHub 환경과 Secrets](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

이번 변경 검증 결과: 환경 테스트 7/7 통과, TypeScript/Expo lint 통과, 두 실행 명령의 CLI 호출 확인. 임시 Git 저장소에서 `.env.dev`/`.env.prod` 제외 및 예시 파일 포함을 확인했습니다. 실제 기기 재빌드와 GitHub 원격 workflow 실행은 이번 설정 변경 검증에 포함하지 않았습니다.

## GitHub 연결 확인 결과

`https://github.com/gardenS2/coupleDday` 저장소는 확인 당시 커밋이 없는 빈 저장소였습니다. 2026-11-11에는 프로젝트 문서만 업로드했으며, 앱 소스와 `.github/workflows/mobile-check.yml`은 아직 업로드하지 않았습니다. 실제 키·원본 개인 이미지·코드는 업로드하지 않았습니다.


## 7. 클라우드 개발 DB 초기 적용 (2026-11-05)

개발 설정 파일은 `apps/mobile/.env.dev`로 통일했습니다. 기존 로컬 파일을 이름만 변경하여 URL과 키를 보존했습니다. 실행 스크립트, 테스트, 예제, CI 파일 생성 및 문서도 새 이름을 사용합니다. GitHub의 `MOBILE_ENV_FILE` Secret 이름과 내용 형식은 그대로입니다. 실행 중인 개발 서버는 종료 후 `npm run start:dev`로 재시작하세요.

앱 로그인은 Supabase의 `auth` 스키마를 사용합니다. 로그인 성공이 앱 테이블 설치를 의미하지는 않습니다. 앱 테이블은 같은 프로젝트의 `public`, 내부 권한 검사 함수는 `private` 스키마에 설치합니다.

- 대상: `.env.dev`가 가리키는 `gllplnwnacjcujeaeuei` / CoupleDday. 관리 화면은 main 브랜치를 Production으로 표시합니다. 파일명만으로 별도 개발 DB가 생성되지는 않습니다.
- 적용 위치: https://supabase.com/dashboard/project/gllplnwnacjcujeaeuei/sql
- 확인 위치: https://supabase.com/dashboard/project/gllplnwnacjcujeaeuei/editor → public
- 준비 파일: `spikes/auth-couple-poc/supabase/bootstrap-development.sql`
- 원본: `spikes/auth-couple-poc/supabase/migrations/`의 날짜순 SQL 3개.
- 현 상태: 2026-11-05 사용자 확인 후 SQL Editor에서 원격 적용 완료. 테이블 6개 모두 RLS 활성화 확인. 건강기록 2개 테이블의 CRUD 정책 8개가 authenticated + private.is_member(couple_id) 조건으로 생성됨을 확인했습니다. 기존 가입자 프로필 누락 0건, 신규 가입 프로필 생성 트리거 1개를 확인했습니다. 실제 앱 두 계정 간 CRUD 점검은 별도로 필요합니다.

초기 SQL은 하나의 트랜잭션으로 테이블 6개(`profiles`, `couples`, `couple_members`, `couple_invites`, `cycle_records`, `cycle_daily_logs`), 함수와 RLS를 생성합니다. 가입되어 있는 사용자의 프로필은 이름을 덮어쓰지 않고 누락된 행만 추가합니다. 건강기록은 같은 커플 구성원에게 공동 CRUD 권한을 부여하며 다른 커플과 미인증 사용자는 차단합니다. 초기 SQL은 신규 DB에 한 번만 실행합니다. 기존 DB에 재실행하거나 `db reset`하지 마세요.

SQL Editor로 실행하면 CLI 마이그레이션 이력은 자동 등록되지 않습니다. 이후 CLI `db push`로 전환하기 전 실제 적용 결과를 대조하고 `supabase migration repair --status applied`로 적용된 버전만 등록해야 합니다. 그 전에는 무조건 `db push`하지 마세요. 클라우드 Supabase 사용에는 로컬 Docker가 필요 없습니다.

## 8. 마법탭 UI 재구현 (2026-11-05)

비공개 참고 이미지 `04_cycle_calendar.jpg`, `05_cycle_daily_log.jpg`를 기준으로 `apps/mobile/src/screens/Health.tsx`를 재구성했습니다. 월 제목과 이전/다음 이동, 짙은 배경의 원형 날짜, 마법 기간 색상, 민트색 선택 테두리와 일일 기록 점을 적용했습니다. 증상 칩 8개, 기분 이모지 4개, 메모와 300자 표시, 지난 기간 카드가 이어집니다. 기존 Supabase 저장/수정/삭제 및 version 충돌 처리를 유지하며, 저장 버튼으로 반영합니다.

분홍색 마법 시작 버튼 또는 지난 기간을 누르면 시작일·종료일 입력 창이 열립니다. 날짜는 YYYY-MM-DD이며, 진행 중인 기간의 종료일은 비워 둡니다. 휴지통은 삭제 확인 후 처리합니다. 월 화면은 해당 월과 겹치는 기간을 표시합니다. 가임기·배란일 예측 기능은 구현하지 않았으며 예측 색상을 실제 기록처럼 표시하지 않습니다. 진행 중인 기간 색상은 오늘까지만 표시합니다.

하단 탭은 어두운 배경과 선택된 아이콘의 둥근 강조 영역으로 맞췄으며 마법 아이콘을 물방울 형태로 교체했습니다.

검증: 타입 검사와 린트 통과. 로컬 브라우저 가상 데이터 미리보기에서 390px 너비 달력/일일 기록 레이아웃, 월 이동, 날짜 선택, 증상·기분 선택, 메모 글자 수, 기간 입력 창, 시작일보다 이른 종료일의 저장 비활성화를 확인했습니다. 실제 기기 및 클라우드 두 계정 간 저장·수정·삭제는 이번 UI 변경 후 별도로 확인해야 합니다. 실제 사용자 기록은 변경하지 않았습니다.

## 9. iOS 아이콘 및 주기 예측 (2026-11-06)

`src/components/AppIcon.tsx`의 번들 SVG로 하단 탭, 물방울, 휴지통, 월 이동 및 기분 그림을 통일했습니다. 시스템 특수문자와 이모지 폰트에 의존하지 않습니다. Expo SDK에 맞는 `react-native-svg`를 추가했으므로 **기존 설치 앱은 한 번 네이티브 재빌드**가 필요합니다. `apps/mobile`에서 `npm run ios:dev` / `npm run android:dev`를 실행하세요. 이후 화면 코드 수정은 일반 새로고침으로 반영됩니다.

`src/lib/cyclePrediction.ts`가 날짜 계산을 담당합니다. `loadHealth`는 선택 월의 기록과 별도로 오늘까지의 최근 시작 기록 7개를 조회합니다. 동일 커플 DB 기록으로 두 계정이 같은 예측을 계산하며, 마법탭 재진입/당겨서 새로고침/저장 후 재계산합니다. 예측 자체는 실제 기록으로 DB에 저장하지 않으며 추가 DB 마이그레이션은 필요 없습니다.

- 실제 마법: 자주색 채움 `#613047`.
- 가임기 추정: 보라색 채움 `#2D294D`, 글자 `#C7B7F4`.
- 배란 예정: 연보라 테두리 `#C7B7F4`.
- 마법 예정: 분홍 테두리 `#AE7E96`.
- 민트색은 선택 날짜의 바깥 테두리/일일 기록 점으로 유지합니다. 실제 기간은 예측보다 우선합니다.

계산: 최근 최대 6개 시작일 간격 평균을 반올림해 다음 시작일을 구합니다. 기록이 하나면 기본 28일임을 표시합니다. 기간은 최근 최대 6개 완료 기록의 일수(종료일 포함) 평균이며, 없으면 기본 5일임을 표시합니다. 배란 예정은 다음 시작일 14일 전, 가임기는 그 5일 전부터 1일 후까지의 추정 범위입니다. 배란 시점은 개인마다 달라 정확한 날짜나 피임 가능 여부를 판단할 수 없습니다. 참고: [NHS](https://www.nhs.uk/conditions/periods/fertility-in-the-menstrual-cycle/), [NHS inform](https://www.nhsinform.scot/healthy-living/womens-health/girls-and-young-women-puberty-to-around-25/periods-and-menstrual-health/periods-and-pregnancy/).

다음 한 주기만 추정하고 새 시작일이 없으면 예정일을 자동으로 반복 연장하지 않습니다. 간격 차이가 7일보다 크면 오차 안내를 표시합니다. 15일 미만/90일 초과 간격, 14일 이상 종료되지 않은 기간, 다음 예정일을 넘는 종료일은 기록 확인 안내와 함께 예측을 생략합니다. 이 수치는 앱의 계산 제한이며 의학적 정상 범위 판정이 아닙니다. 기간 길이 평균에는 1~14일의 완료 기록을 사용합니다.

`npm run test:cycle`에서 월·연도 경계, 윤년, 실제 기록 우선순위, 기본값, 불규칙/누락 기록, 지연된 예정일, 수정/삭제 후 재계산을 검사합니다. GitHub 검사 워크플로에도 추가했습니다. 이전 8절의 '예측 미제공' 상태는 이번 변경으로 대체됩니다.

최종 검증: 예측 9개 + 환경설정 7개 테스트 통과, TypeScript/린트 통과, Android·iOS·웹 JS 번들 생성 성공. iOS 17.2 / iPhone 15 Pro Max 시뮬레이터에서 네이티브 빌드·설치·실행 성공(오류 0개), 미리보기의 물방울/월 이동 벡터와 10월 가임기, 11월 배란·마법 예정 표시를 확인했습니다. 실물 iPhone/Android 기기 검증은 별도입니다. 개발 모드 로그인 화면의 디자인 미리보기는 Supabase 연결 여부와 관계없이 사용할 수 있게 했으며, 운영 빌드에는 노출되지 않습니다.
