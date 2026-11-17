# Google OAuth · GC-02 구현 및 설정 안내

## 현재 상태

- 기존 이메일 로그인과 `session.user.id`를 유지하는 Supabase Google Identity 연결/해제 UI를 구현했다. Supabase Auth의 PKCE flow와 기존 계정의 `linkIdentity`/`unlinkIdentity`를 사용한다.
- Calendar API 권한은 Google 로그인 연결과 별도 동의다. 앱은 시스템 브라우저에서 Google로 이동하고 Google은 Supabase Edge Function callback으로 돌아온다. 서버 callback이 일회용 state, PKCE verifier, OAuth code를 검증·교환한다.
- refresh token은 AES-256-GCM으로 암호화해 GC-01 `google_calendar_credentials`에 저장한다. 암호문·nonce·key version만 저장하며, 클라이언트는 credentials와 OAuth session 테이블에 접근할 수 없다.
- 재연결은 같은 Google `sub`의 기존 암호화 refresh token을 보존한다. 다른 Google 계정으로 바꾸려면 이전 token 철회를 먼저 완료해야 한다. 권한 해제는 서버에서 revoke 후 자격증명을 지우며, 실패하면 `revocation_pending`으로 남겨 재시도한다.
- GC-02 migrations `20261113000300_google_calendar_oauth_sessions.sql`, `20261113000400_google_calendar_disconnect_fencing.sql`, `20261113000500_gc02_disconnect_rpc_fix.sql`을 연결된 Supabase 프로젝트에 적용했다. 2026-11-13 기준 로컬·원격 12개 migration 이력이 모두 일치한다. GC-02 원격 rollback DML/권한 검사는 9/9 통과했고, GC-01 잔여 검사는 16/16 통과했다. 합성 데이터는 rollback했고 사후 조회에서 테스트 credential·OAuth session·connection은 각각 0개였다.
- Edge Function 소스는 작성했지만 Google Cloud 값/서버 Secrets가 아직 제공되지 않아 원격 함수는 배포하지 않았고 실제 Google 동의·토큰 발급을 검증하지 않았다. Calendar 일정 CRUD, 캘린더 목록·선택, webhook 및 동기화는 미구현이다.

## Google Cloud 설정

1. Google Cloud Console에서 사용할 프로젝트를 선택하고 **APIs & Services → Library**에서 **Google Calendar API**를 활성화한다.
2. **Google Auth Platform → Branding**에서 앱 이름·지원 이메일을 설정하고, **Audience**를 `External` 테스트 단계로 둔 뒤 테스트할 A/B 계정을 **Test users**에 등록한다. 공개 출시 전 동의 화면과 요청 scope에 필요한 Google 검토를 마친다.
3. **Google Auth Platform → Clients → Create client → Web application**에서 OAuth Web client를 만든다. 실제 client ID/secret을 생성·입력한다. Authorized redirect URIs에는 아래 두 callback을 각각 추가한다.
   - Supabase Identity 로그인/연결: `https://gllplnwnacjcujeaeuei.supabase.co/auth/v1/callback`
   - Calendar OAuth 서버 callback: `https://gllplnwnacjcujeaeuei.supabase.co/functions/v1/google-calendar-oauth-callback`
4. **Google Auth Platform → Data Access**에서 Calendar scope를 확인한다. 현재 요청 범위는 `openid`, `email`, `profile`, `https://www.googleapis.com/auth/calendar.events`이다. 다음 단계에서 캘린더 목록을 읽을 때 `https://www.googleapis.com/auth/calendar.calendarlist.readonly`를 추가 동의할 수 있다.
5. Supabase Dashboard **Authentication → Sign In / Providers → Google**에서 첫 번째 Supabase Identity callback용 Web client ID/secret을 설정하고 provider를 활성화한다. Identity Linking을 위해 **Allow manual linking**을 켠다.
6. Supabase **Authentication → URL Configuration → Redirect URLs**에 `coupledday://auth/callback`을 등록한다. 이 주소는 Supabase Auth Identity flow 전용이다. Calendar OAuth는 서버 callback 뒤 앱으로 돌아오므로 Google에 등록하는 redirect URI가 아니다.

APP-ID-01에서 Expo slug `cpldday`, Android package/iOS bundle ID `com.cpldday.app`을 확정했고 기존 `coupledday` scheme을 유지한다. 현재 Google Calendar 인증은 Web OAuth client → 서버 callback 방식이라 Android/iOS client ID 및 인증서 지문을 직접 사용하지 않는다. Supabase Identity용 callback과 Calendar OAuth server callback URI는 앱 ID 변경 후에도 그대로다. 별도의 네이티브 Google OAuth client를 콘솔에 만들어 둔 경우 **Google Auth Platform → Clients**에서 Android package를 `com.cpldday.app`으로, iOS bundle ID를 `com.cpldday.app`으로 맞춘다. Google Android OAuth client는 Android package와 서명 인증서의 **SHA-1**을 사용한다. 개발·Play App Signing 인증서에 맞는 SHA-1을 각각 등록해야 할 수 있다. SHA-256은 이 앱에 설정된 Android OAuth client나 App Links가 요구하지 않으며, 현재 App Links도 구성하지 않았다. 출시용 인증서 지문은 저장소에 없다.

앱 콜백은 기존 `expo-linking`과 app route를 사용하며, GC-02 Google Calendar 흐름에서 `expo-auth-session` API는 호출하지 않는다. 인증 응답은 서버 callback에서 처리하고 앱에는 결과 딥링크만 돌아온다.

Android App Links의 HTTPS `intent-filter`와 `assetlinks.json`은 현재 구성되어 있지 않다. Supabase Identity의 앱 복귀 주소는 계속 `coupledday://auth/callback`, Calendar OAuth의 앱 복귀 주소는 `coupledday://auth/google-calendar-callback`이다. 새 앱 ID는 이전 설치본과 별도 앱이며, Android SecureStore 데이터는 앱 삭제 시 없어지고 iOS Keychain 세션도 새 bundle ID로 이관된다고 가정하면 안 된다. GC-02 인증 흐름은 Expo Go가 아니라 custom scheme이 포함된 Development Build에서 확인해야 한다.

## Supabase Edge Function Secrets

아래 값은 앱 `.env.dev`, Expo 공개 환경변수, GitHub 소스에 넣지 않는다. **Supabase Dashboard → Edge Functions → Secrets** 또는 승인된 개발자 단말의 Supabase CLI로 현재 테스트 프로젝트에 등록한다.

| 이름 | 값 |
|---|---|
| `GC_GOOGLE_CLIENT_ID` | 위 Google OAuth Web client ID |
| `GC_GOOGLE_CLIENT_SECRET` | 같은 Web client의 client secret |
| `GC_GOOGLE_TOKEN_ENCRYPTION_KEY` | 32-byte AES key를 Base64로 인코딩한 값 |
| `GC_GOOGLE_TOKEN_ENCRYPTION_KEY_VERSION` | 임의의 비밀이 아닌 버전 식별자(예: `v1`) |

`SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`는 Supabase Edge Function runtime이 제공하는 기본 서버 환경변수이며 별도 secret으로 등록하지 않는다. `SUPABASE_` 접두어는 예약되어 있으므로 프로젝트 관리자가 수동 등록할 항목이 아니다. 앱에서 해당 키를 사용하지 않는다. 토큰 키를 바꾸기 전에는 기존 암호문을 새 키로 재암호화해야 하며, GC-02에는 key rotation 작업이 포함되지 않았다.

## 배포 및 검증 순서

1. 위 Secrets와 Google redirect URI를 설정한다. 실제 key 값은 Codex/채팅에 보내지 않는다.
2. `cd /Users/garden/DEV/coupleDday/spikes/auth-couple-poc` 후 `npx supabase@2.122.0 functions deploy google-calendar-oauth-start`, `google-calendar-oauth-callback`, `google-calendar-oauth-disconnect`를 각각 실행한다. 배포 전에 현재 project ref가 `gllplnwnacjcujeaeuei`인지 확인한다.
3. 모바일 설정에서 Google Identity 연결과 Calendar 별도 권한 동의를 각각 시험한다. 동의 취소, 네트워크/설정 오류 후 재시도, same-account 재인증, 해제 실패 후 `revocation_pending`, 기존 이메일 로그인 및 `session.user.id` 유지를 확인한다.
4. 실제 Google 계정을 사용한 OAuth와 Android/iOS 브라우저 왕복은 아직 테스트하지 않았다. 승인된 테스트 사용자만 사용한다. Calendar 공유 대상 선택은 GC-03에서 진행한다.

## 서버 구현 파일

- `spikes/auth-couple-poc/supabase/functions/google-calendar-oauth-start/`: Supabase JWT·커플 멤버십 확인, connection owner 검사, PKCE verifier와 짧은 유효기간의 일회용 state 생성.
- `spikes/auth-couple-poc/supabase/functions/google-calendar-oauth-callback/`: state 1회 소비, authorization code 교환, Google `sub` 확인, server-side AES-GCM 저장. access/refresh token을 앱에 반환하지 않는다.
- `spikes/auth-couple-poc/supabase/functions/google-calendar-oauth-disconnect/`: 담당자 권한 확인, Google revoke, ciphertext 제거 또는 재시도 대기 상태.
- `spikes/auth-couple-poc/supabase/functions/_shared/google_oauth.ts`: 토큰 암·복호화, 만료 access token 갱신, CAS 기반 회전 저장, 비밀값을 출력하지 않는 공통 로직.
- `spikes/auth-couple-poc/supabase/migrations/20261113000300_google_calendar_oauth_sessions.sql`: RLS로 보호된 일회용 state/PKCE 세션과 service-role 전용 원자적 token 저장·갱신 RPC.
- `spikes/auth-couple-poc/supabase/migrations/20261113000400_google_calendar_disconnect_fencing.sql` 및 `20261113000500_gc02_disconnect_rpc_fix.sql`: 연결 해제·재인증과 callback/refresh의 경합을 차단하고 revocation 상태를 안전하게 처리한다.

## GC-03 이전 미완료 사항

- Google Cloud/Supabase Secrets 등록과 Edge Function 배포
- 실제 OAuth 승인·취소·철회·재인증 Android/iOS 테스트
- Edge Function은 Deno 런타임에서 아직 실행 검증하지 않았다. 로컬 TypeScript strict 검사와 구문 검사는 통과했다.
- Google OAuth 동의 화면 검토 및 공개 배포 승인 여부 확인
- Google 계정 변경을 위한 기존 token revoke 완료 흐름, 키 회전 운영 절차 검증
- calendarList scope 및 공유 캘린더 선택·A/B 편집 권한 확인
- 네이티브 OAuth client를 별도로 사용한다면 Google Cloud Console에서 Android package/iOS bundle ID를 `com.cpldday.app`으로 맞추고 실제 배포 서명 인증서 지문을 등록한다. 현재 Web OAuth 흐름에는 native client가 필요하지 않다.

실제 일정 동기화와 Google 일정 삭제 전파는 구현하지 않았다. 기존 일정 삭제와 recovery/Outbox의 동일 트랜잭션 처리를 포함한 후속 안전 게이트 전까지 삭제 전파를 켜지 않는다.

## 공식 설정 참고

- [Google OAuth 2.0 웹 서버 흐름](https://developers.google.com/identity/protocols/oauth2/web-server): redirect URI, state, authorization code 및 offline access.
- [Google API OAuth 자격 증명 만들기](https://developers.google.com/workspace/guides/create-credentials): Google Auth Platform에서 OAuth client를 만드는 위치.
- [Expo 앱 링크 처리](https://docs.expo.dev/linking/into-app/) 및 [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/): custom scheme용 Development Build와 앱 ID 변경 시 세션 저장 범위 참고.
- [Supabase Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets): GC 전용 서버 Secrets 등록, 예약 환경변수 및 런타임 기본 환경변수.
