import { Redirect } from "expo-router";
import { useAuth } from "../lib/auth";
import Connect from "../screens/Connect";
import { Screen, Body, Button } from "../components/ui";
export default function Route() {
  const a = useAuth();
  if (a.loading)
    return (
      <Screen>
        <Body>연결 확인 중…</Body>
      </Screen>
    );
  if (!a.session) return <Redirect href="/login" />;
  if (a.couple) return <Redirect href="/(tabs)" />;
  if (a.error)
    return (
      <Screen>
        <Body>{a.error}</Body>
        <Button title="다시 확인" onPress={() => void a.refresh()} />
      </Screen>
    );
  return <Connect />;
}
