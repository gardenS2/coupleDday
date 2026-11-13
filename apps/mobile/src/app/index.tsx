import { Redirect } from "expo-router";
import { useAuth } from "../lib/auth";
import { Screen, Body, Button } from "../components/ui";
export default function Index() {
  const a = useAuth();
  if (a.loading)
    return (
      <Screen>
        <Body>우리의 공간을 열고 있어요…</Body>
      </Screen>
    );
  if (a.error && a.session)
    return (
      <Screen>
        <Body>{a.error}</Body>
        <Button title="다시 시도" onPress={() => void a.refresh()} />
      </Screen>
    );
  return (
    <Redirect
      href={!a.session ? "/login" : !a.couple ? "/connect" : "/(tabs)"}
    />
  );
}
