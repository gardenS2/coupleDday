import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Body, Button, Notice, Screen } from "../../components/ui";

export default function GoogleCalendarOAuthCallback() {
  const { result } = useLocalSearchParams<{ result?: string }>();
  const connected = result === "connected";
  const cancelled = result === "cancelled";
  useEffect(() => {
    if (connected) {
      const timer = setTimeout(() => router.replace("/(tabs)/settings"), 900);
      return () => clearTimeout(timer);
    }
  }, [connected]);

  return (
    <Screen>
      <Notice
        text={connected
          ? "Google Calendar 권한을 승인했어요. 공유 캘린더 선택은 다음 단계에서 진행해요."
          : cancelled
            ? "Google Calendar 연결을 취소했어요. 앱 계정은 그대로 유지돼요."
            : "Google Calendar 권한을 연결하지 못했어요. 설정에서 다시 시도해 주세요."}
      />
      <Body>Google 인증 정보는 앱으로 전달되지 않고 서버에서 처리돼요.</Body>
      <Button title="설정으로 돌아가기" onPress={() => router.replace("/(tabs)/settings")} />
    </Screen>
  );
}
