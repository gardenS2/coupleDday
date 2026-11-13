import { useState } from "react";
import { Text, View } from "react-native";
import {
  Screen,
  Brand,
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
import { useAuth } from "../lib/auth";
import { db, friendlyError } from "../lib/supabase";
import { today, validDate } from "../lib/health";
export default function Connect({ preview = false }: { preview?: boolean }) {
  const auth = useAuth();
  const [mode, setMode] = useState<"create" | "join">("create"),
    [date, setDate] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit() {
    if (preview) {
      setMessage("가상 미리보기예요. 저장하거나 연결하지 않아요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const r =
        mode === "create"
          ? await db().rpc("create_couple", { p_relationship_start: date })
          : await db().rpc("accept_couple_invite", {
              p_token: code.trim().toLowerCase(),
            });
      if (r.error) throw r.error;
      await auth.refresh();
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Brand />
      <Title>우리 사이에,{"\n"}작은 연결 하나.</Title>
      <Body>
        처음이라면 공간을 만들고,{"\n"}초대받았다면 코드를 붙여넣어 주세요.
      </Body>
      <View style={{ alignItems: "center", padding: 12 }}>
        <Text style={{ fontSize: 58, color: colors.pink }}>○ ─ ♡ ─ ○</Text>
      </View>
      <Card>
        <View style={s.row}>
          <Chip
            label="공간 만들기"
            selected={mode === "create"}
            onPress={() => setMode("create")}
          />
          <Chip
            label="초대받았어요"
            selected={mode === "join"}
            onPress={() => setMode("join")}
          />
        </View>
        {mode === "create" ? (
          <>
            <Text style={s.section}>처음 함께한 날</Text>
            <Field
              label="사귄 날짜"
              placeholder="YYYY-MM-DD"
              value={date}
              onChangeText={setDate}
              maxLength={10}
            />
            <Body>이 날을 1일로 세어 우리의 D+를 만들어요.</Body>
          </>
        ) : (
          <>
            <Text style={s.section}>둘만의 초대 코드</Text>
            <Field
              label="초대 코드"
              placeholder="상대가 보낸 코드를 붙여넣어 주세요"
              value={code}
              onChangeText={setCode}
              multiline
              autoCorrect={false}
            />
            <Body>코드는 발급 후 24시간 동안 사용할 수 있어요.</Body>
          </>
        )}
        <Notice text={message || auth.error} />
        <Button
          busy={busy}
          title={mode === "create" ? "우리의 공간 만들기" : "함께 연결하기"}
          disabled={
            !preview &&
            (mode === "create"
              ? !validDate(date) || date > today()
              : !/^[0-9a-fA-F]{64}$/.test(code.trim()))
          }
          onPress={() => void submit()}
        />
      </Card>
      <Card>
        <Text style={{ color: colors.pink, fontWeight: "600" }}>
          ♡ 연결하면 함께 공유돼요
        </Text>
        <Body>
          건강 날짜·증상·기분·메모는 두 사람 모두 조회·수정·삭제할 수 있어요.
          커플 연결이 끝나면 해당 공간의 접근 권한도 사라져요.
        </Body>
      </Card>
      {!preview && (
        <Button
          secondary
          title="로그아웃"
          onPress={() =>
            void auth.logout().catch((e) => setMessage(friendlyError(e)))
          }
        />
      )}
    </Screen>
  );
}
