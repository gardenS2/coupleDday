# 홈 위젯 PoC 기술 검증 보고서

> 2026-10-29 재검증: Android release 테스트 빌드·설치·앱 실행 및 갱신 요청 성공. 홈 화면 배치 후 최종 표시는 아직 미확인입니다. 상세는 `06-mobile-and-shared-health.md`의 Android 재검증 항목을 확인하세요.

검증일 2026-10-26, macOS arm64. 독립 경로 `spikes/widget-poc/`. 운영 Supabase 연결·실사용자 계정·사진·건강 데이터·알림 서버·배포는 없다. 원본 폴더를 변경하지 않았다.

## 공식 예제와 실제 호환성

`npx --yes create-expo-app@latest spikes/widget-poc --example with-widgets --no-install`로 공식 예제를 생성했다. CLI가 PoC 하위 폴더에 자체 Git 저장소와 초기 커밋을 자동 생성했으며 참고 이미지나 루트 문서는 그 저장소에 들어가지 않았다. 원격 push는 하지 않았다.

| 구성 | 확인 결과 |
|---|---|
| macOS / CPU | Darwin 24.6.0 / arm64 |
| 시스템 Node / npm | 23.6.0 / 10.9.2; RN 엔진 요구 범위 밖 경고 |
| 검증용 Node | npm 도구 캐시의 22.23.4 사용; 시스템 설치는 변경하지 않음 |
| Xcode | 26.3 (17C529), `/Applications/Xcode.app/Contents/Developer` |
| CocoaPods | 1.17.0 |
| Java | Temurin OpenJDK 17.0.20 |
| Android SDK | 환경 변수 `ANDROID_HOME`으로 지정; adb 37.0.1 |
| Android AVD | Galaxy_S24_FE |
| iOS Simulator | iOS 17.2 / 26.3 기기 확인; 테스트 대상 iPhone 17 Pro / iOS 26.3 |
| 설치 Expo | 57.0.31 |
| expo-widgets / @expo/ui | 57.0.27 / 57.0.26 |
| React / React DOM | 19.2.3 / 19.2.3 |
| React Native | 예제 0.86.0 → SDK 권장 0.86.3 |
| TypeScript | 6.0.3 (package-lock.json 고정) |

[최신 Expo 위젯 문서](https://docs.expo.dev/versions/latest/sdk/widgets/)는 Android/iOS, `enableAndroid: true`, Android package 설정과 OS별 Compose/SwiftUI 렌더링을 설명한다. 반면 [SDK 57 문서](https://docs.expo.dev/versions/v57.0.0/sdk/widgets/)는 iOS 전용으로 소개한다. **문서 제목만으로 지원 여부를 확정하지 않았다.** 설치된 57.0.27의 `plugin/src/withWidgets.ts`에서 Android opt-in을 확인했고, prebuild가 실제 두 Android receiver와 iOS 위젯 extension을 생성했다. 네이티브 실행 성공 여부는 아래 실행 결과를 따른다.

최신 문서의 createWidget 기본 props 세 번째 인자는 설치 버전의 타입에 없다. 이번 코드는 설치 타입에 맞는 2인자 호출만 사용하며 앱의 버튼으로 초기 스냅샷을 생성한다. `initialLayout` 등 설치 타입에 없는 최신 옵션은 넣지 않았다. Expo Go는 사용할 수 없으며 로컬 네이티브 개발 빌드가 필요하다.

## 최소 구현

- 앱 화면은 위젯 갱신 버튼 2개뿐이다. 라우팅·Supabase·건강·푸시는 구현하지 않았다.
- DdayWidget: 가상 인물 하늘·바다, 시작 2026-01-01, 기준일 2026-10-26 → D+299. 가상 기념일 2026-12-01 → D-36.
- CalendarWidget: 현재 선택 월의 7열·6주 날짜 텍스트, 5/15/25일 가상 일정 3개에 별표, 아래 일정 목록. 실제 공휴일 데이터가 아니다. 네이티브 캘린더 컴포넌트·인터랙션·날짜별 편집은 범위 밖이다.
- SwiftUI와 Jetpack Compose 렌더러를 `.ios.tsx`/`.android.tsx`로 분리. 앱 계산 결과만 props로 보내고 widget 함수 내부에서 네트워크·React hooks·외부 상태를 사용하지 않는다.
- iOS 현재 시각 모드는 현재 스냅샷과 다음 7일 서울 자정의 타임라인을 예약한다. 고정 날짜 모드는 단일 snapshot이다. Android는 현재 snapshot만 갱신한다.
- 두 위젯에 마지막 기준 날짜와 가상 데이터 표시. 달력의 작은 크기 잘림·큰 글씨·OS 기본 테마는 실측 대상으로 남긴다.

## 명령과 로그

아래 경로는 PoC 폴더 기준이다. 생성/환경 조사 초기 출력은 채팅 도구 결과로 확인했고 이후 빌드·검사 원문은 로컬 파일로 남겼다. 사용자 이미지·건강 원문을 로그로 내보내지 않았다.

| 명령 | 결과 | 로그 |
|---|---|---|
| `node --version`, `npm --version`, `xcodebuild -version`, `java -version`, `pod --version` | 설치 확인 | 일부 `../../docs/logs/`, 초기 도구 출력 |
| `xcrun simctl list devices available` | 제한된 실행에서 권한 실패 → 권한 확장 재시도 성공 | 초기 도구 출력 |
| `emulator -list-avds`, `adb version` | AVD/adb 확인 | 초기 도구 출력 |
| `emulator -version` | 제한된 환경에서 Qt/neon 오류; 이 출력만으로 에뮬레이터 미설치로 판단하지 않음 | `../../docs/logs/android-emulator.txt` |
| `npx create-expo-app ... --example with-widgets --no-install` | 첫 시도 DNS 제한 실패 → 권한 확장 후 생성 성공 | 초기 도구 출력 |
| `npm install` | 성공, 엔진/보안 경고 있음 | `install.log` |
| `npx expo install --fix` | 첫 실패: react-dom 19.3.1 자동 peer와 React 19.2.3 충돌 | `compatibility.log` |
| `npx expo install react-dom` | SDK 권장 19.2.3 명시로 충돌 해결, RN 0.86.3 설치 | `logs/peer-fix.log` |
| `npx expo install --check` | 최종 성공: Dependencies are up to date | `logs/dependency-check.log` |
| `npx tsc --noEmit` | 초기에 Android Text API 차이 발견·수정; 최종 통과 | `logs/typecheck-final.log` (오류 없음) |
| `CI=1 npx expo lint` | 도구 설치·설정 후 최종 통과 | `logs/lint.log`, `logs/lint-final.log` |
| `node --experimental-strip-types --test src/snapshot.test.mjs` | 5/5 통과 | `logs/date-tests.log` |
| `CI=1 npx expo prebuild --no-install` | iOS/Android 생성 성공 | `logs/prebuild.log` |
| `npx expo export --platform all` | 웹용 react-native-web 누락으로 실패; 웹은 대상 아님 | `logs/bundle.log` |
| `npx expo export --platform ios --output-dir dist-ios` | 성공 | `logs/bundle-ios.log` |
| `npx expo export --platform android --output-dir dist-android` | 성공 | `logs/bundle-android.log` |
| `npm audit --json` | high 5건, 해결 미완료 | `logs/npm-audit.json` |

날짜 테스트는 시작일·100일, 서울 자정 직전/직후, 미래/당일/과거·연말·윤년·잘못된 날짜, 달력 3개 표시, 월 변경 타임라인을 검증한다. RLS 테스트는 설계만 있으며 이번에 실행하지 않았다.

보안 검사에서 node-forge/zod와 상위 Expo CLI 의존성에 high 5건이 보고됐다. `npm audit fix --force`는 Expo 44로의 비호환 변경을 제안해 실행하지 않았다. 공개 배포 전 SDK의 수정 릴리스와 실제 영향 범위를 재검증해야 한다. 가상 데이터의 로컬 PoC 결과를 운영 보안 승인으로 해석하지 않는다.

## 자정·앱 종료 제약과 재현 절차

[iOS WidgetKit 갱신 정책](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date): 앱이 종료돼도 미리 제공한 타임라인을 OS가 사용할 수 있지만 reload 시간은 OS의 예산·스케줄링 영향을 받는다. 7일 이후 앱을 다시 열지 않은 상황의 자동 보충은 구현하지 않았다. 타임라인이 있다는 사실이 실기기 자정 정시 갱신 성공을 의미하지 않는다.

[Android 갱신 정책](https://developer.android.com/develop/ui/views/appwidgets/advanced): 주기 갱신은 최소 간격과 절전 제한이 있어 정확한 자정 실행 보장이 없다. 이번 Android 구현에는 백그라운드 날짜 재계산 작업이 없으므로 앱 재진입 후 버튼 갱신 전까지 D+가 오래될 수 있다. 앱 종료/강제 종료/재부팅은 별도 시나리오이며 혼동하지 않는다. 향후 Android Worker/네이티브 위젯 또는 앱 재진입 갱신과 오래된 상태 표시를 비교한다. 정확 알람 권한으로 해결된다고 가정하지 않는다.

실기기 검증 절차: 가상 데이터 갱신 → 홈 길게 누르기/위젯 선택 → 두 위젯 추가 → 표시와 기준일 확인 → 앱 종료·비행기 모드 → 서울 23:59~00:05 관찰 → 실제 갱신 시간 기록 → 다음 날 앱 재진입·다시 갱신 → 월말/연말 반복. 별도로 재부팅, Android 강제 종료·절전, 시간대 변경, 크기 조절, 로그아웃 스냅샷 삭제를 검사한다. 실제 기기 시간을 이번 작업에서 변경하지 않았다.

## 차선책

양 OS expo-widgets 빌드가 안정적이면 고정한 SDK/lockfile로 계속 검증한다. Android 지원의 문서/실패 문제가 남으면 Android 네이티브 Glance 위젯과 얇은 Expo Module snapshot bridge를 별도 PoC로 검토한다. iOS도 필요 시 직접 WidgetKit extension을 유지한다. 이번에 미확인 API를 추가해 성공을 가장하거나 별도 네이티브 운영 구현을 만들지 않았다. iOS 서명·비공개 배포 계획은 `04-implementation-roadmap.md` 참조.

## 최종 OS별 실제 실행 결과

| 항목 | iOS 26.3 / iPhone 17 Pro Simulator | Android Galaxy_S24_FE Emulator |
|---|---|---|
| 네이티브 빌드 | **성공** (0 errors, 2 warnings) | **성공** (BUILD SUCCESSFUL, 첫 빌드 10분 6초) |
| 설치·실행 명령 | **성공**, 앱 UI 직접 확인 | **성공**, Expo 설치·MainActivity 실행 로그 확인 |
| OS 위젯 등록 | 갤러리에 두 종류 확인 | dumpsys에 두 Provider 등록 확인 |
| 홈 화면 D-Day 추가 | **성공**, D+299와 D-36 표시 확인 | **미실행** — 화면 제어 도구가 에뮬레이터 창을 인식하지 못함 |
| 홈 화면 달력 추가 | **성공**, 월 날짜와 가상 약속 3개 표시 확인 | **미실행** — 동일 UI 접근 제약 |
| 자정·앱 종료 후 갱신 | 타임라인 생성 로직 테스트만 통과; 실제 자정/강제 종료는 **미실행** | 백그라운드 재계산 **미구현**, 실측 **미실행** |
| 실기기·서명·내부 배포 | **미실행**, Simulator 서명은 실기기 서명과 다름 | **미실행**, 생성 APK는 에뮬레이터 debug 테스트용 |

실제 빌드 명령 (PoC 디렉터리):

```sh
# Node 22.23.4 이상과 Android SDK 환경 변수를 준비한다.
CI=1 npx expo run:ios --device --no-bundler
CI=1 npx expo run:android --no-bundler
npx expo start --localhost
```

원문 로그: `logs/ios-build.log`, `logs/android-build.log`. Android SDK 36 / build-tools 36.0.0 / NDK 27.1.12297006 / Kotlin 2.1.20가 사용됐다. Gradle이 이미 수락된 SDK 라이선스를 확인하고 필요한 NDK를 설치했다. SDK 도구 위치·XML 버전 경고와 deprecated API 경고가 있었으나 빌드는 통과했다.

iOS 첫 작은 위젯에서 D+ 숫자가 잘려 여백·폰트를 수정했고, 앱을 reload하고 snapshot을 다시 보내 D+299 전체 표시를 재확인했다. 달력 medium에도 세 가상 약속을 표시했다. 가상 데이터만 포함한 증거 화면은 `logs/ios-home-widgets.png`. 최종 코드의 타입 검사·lint를 다시 실행해 통과했다. 자정 대기 테스트를 한 것으로 보고하지 않는다.

Android는 adb에서 `emulator-5554`가 device 상태이고 OS 위젯 서비스에 `DdayWidgetProvider`, `CalendarWidgetProvider`가 등록된 것을 확인했다(`logs/android-widget-service.txt`). Provider `updatePeriodMillis=0`이므로 OS 주기 재계산이 자동 설정됐다고 간주할 수 없다. 등록된 홈 인스턴스에는 아직 이 앱의 위젯이 없다. CUA 앱 목록에는 에뮬레이터가 없고, 실행 중 qemu 프로세스명과 절대 경로로 연결해도 `Invalid app`이 반환됐다. **빌드/등록 성공과 홈 위젯 표시 성공을 구분하며 Android 표시 성공은 주장하지 않는다.** 런타임 오류 로그에서 이번 앱의 fatal crash는 관찰되지 않았지만 앱 UI를 직접 검증한 것은 아니다.

Android 남은 수동 절차: 개발 서버 실행 → 에뮬레이터의 Couple Widget PoC 실행 → 고정 날짜 갱신 → 홈 길게 누르기 → Widgets → 두 위젯 추가 → D+299/D-36와 3개 일정 확인. 달력 4×2에서 잘리면 크기를 늘리고 최소 크기 설정을 후속 수정한다. 이 절차와 실기기 자정 테스트가 끝나기 전 양 OS 위젯 PoC가 완전히 통과했다고 판단하지 않는다.

정리: 테스트용 Metro 서버는 작업 종료 시 중지했다. 재검증 시 위 명령으로 다시 시작해야 한다. iOS 홈 위젯은 저장된 스냅샷을 표시한다. 앱 화면의 React Native SafeAreaView deprecated 경고는 PoC에 남아 있으며 본 앱은 safe-area-context로 전환한다.
