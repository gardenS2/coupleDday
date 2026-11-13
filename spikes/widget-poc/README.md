# Couple Widget PoC

공식 `create-expo-app --example with-widgets`에서 생성한 독립 실험이다. Supabase·실사용자·원본 사진을 사용하지 않는다. 전체 앱 구현이 아니다.

검증 결과와 제약은 `../../docs/03-widget-poc-report.md` 참고. Node 22.23.4로 검증하며 시스템 Node 23은 지원 범위 밖이다.

```sh
npm ci
npx tsc --noEmit
npx expo lint
node --experimental-strip-types --test src/snapshot.test.mjs
npx expo prebuild
npx expo run:ios
npx expo run:android
```

개발 빌드가 필요하며 Expo Go로는 위젯을 검사할 수 없다. 앱 실행 후 고정 날짜 갱신을 누르고 홈 화면의 위젯 목록에서 '우리의 D-Day', '이번 달 일정'을 추가한다. 첫 앱 실행·스냅샷 생성 전 갤러리 표시 보장은 이번 버전에 구현하지 않았다. 실제 갤러리 추가 성공 여부는 보고서를 참조한다.

고정 모드는 2026-10-26, 시작일 2026-01-01, 가상 인물 하늘·바다, 해당 월 5/15/25일 가상 약속을 사용한다. 기대 D+는 299, 가상 기념일까지 D-36이다. 실제 시각 모드는 오늘의 서울 날짜와 iOS의 다음 7일 자정 타임라인을 생성한다. Android는 snapshot만 갱신하며 자정 백그라운드 갱신은 구현하지 않았다.

`src/snapshot.ts`는 순수 날짜 계산·비민감 스냅샷, `widgets/*.ios.tsx`/`*.android.tsx`는 OS별 렌더링, `App.tsx`는 수동 검증 화면이다. 일반 `.tsx` 재수출 파일은 TypeScript 해석용이며 Metro가 OS 접미사 파일을 선택한다. `.gitignore`에 로컬 빌드/캐시/비밀 파일을 제외한다. 앱 서명 키·계정·운영 DB 연결은 추가하지 않는다.
