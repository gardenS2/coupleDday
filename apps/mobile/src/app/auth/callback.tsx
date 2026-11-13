import { Redirect, router } from "expo-router";
import { Body, Button, Notice, Screen } from "../../components/ui";
import { useAuth } from "../../lib/auth";

export default function AuthCallback() {
  const auth = useAuth();
  if (auth.googleAuthNotice === "인증을 완료했어요.")
    return <Redirect href="/" />;
  return (
    <Screen>
      {auth.googleAuthNotice ? (
        <Notice text={auth.googleAuthNotice} />
      ) : (
        <Body>인증 결과를 확인하고 있어요. 잠시 기다려 주세요.</Body>
      )}
      <Button
        title="앱으로 돌아가기"
        onPress={() =>
          router.replace(auth.session ? "/(tabs)/settings" : "/login")
        }
      />
    </Screen>
  );
}
