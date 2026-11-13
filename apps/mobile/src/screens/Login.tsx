import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import {
  Brand,
  Screen,
  Title,
  Body,
  Card,
  Field,
  Button,
  Chip,
  Notice,
  s,
  colors,
} from "../components/ui";
import { configured, db, friendlyError } from "../lib/supabase";
export default function Login() {
  const [signup, setSignup] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const auth = db().auth;
      const result = signup
        ? await auth.signUp({ email: email.trim(), password })
        : await auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (signup && !result.data.session)
        setMessage("인증 메일을 보냈어요. 이메일 인증 후 로그인해 주세요.");
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Brand />
      <View style={{ paddingVertical: 12, gap: 14 }}>
        <Text style={{ fontSize: 12, letterSpacing: 3, color: colors.pink }}>
          JUST THE TWO OF US
        </Text>
        <Title>우리의 하루를,{"\n"}같은 온도로.</Title>
        <Body>
          함께한 날부터 오늘의 마음까지.{"\n"}둘만의 작은 공간을 시작해요.
        </Body>
      </View>
      <Card>
        <View style={s.row}>
          <Chip
            label="로그인"
            selected={!signup}
            onPress={() => {
              setSignup(false);
              setMessage("");
            }}
          />
          <Chip
            label="처음이에요"
            selected={signup}
            onPress={() => {
              setSignup(true);
              setMessage("");
            }}
          />
        </View>
        <Field
          label="이메일"
          placeholder="you@example.com"
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
        />
        <Field
          label="비밀번호"
          placeholder={
            signup ? "8자 이상 입력해 주세요" : "비밀번호를 입력해 주세요"
          }
          secureTextEntry
          autoComplete={signup ? "new-password" : "current-password"}
          value={password}
          onChangeText={setPassword}
        />
        <Notice text={message} />
        <Button
          title={signup ? "우리의 공간 시작하기" : "다시, 우리에게"}
          busy={busy}
          disabled={!configured || !email.includes("@") || password.length < 8}
          onPress={() => void submit()}
        />
      </Card>
      <Body>
        커플 연결 후 건강 기록은 두 사람이 함께 보고 수정할 수 있어요.
      </Body>
      {!configured && (
        <Card>
          <Text style={s.section}>아직 연결 전이에요</Text>
          <Body>앱 연결 설정을 마치면 로그인할 수 있어요.</Body>
        </Card>
      )}
      {__DEV__ && (
        <Button
          secondary
          title="화면 디자인 미리보기"
          onPress={() => router.push("/preview")}
        />
      )}
    </Screen>
  );
}
