import { useState } from "react";
import { Alert, Text } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useAuth } from "../../lib/auth";
import { db, friendlyError } from "../../lib/supabase";
import {
  Screen,
  Title,
  Body,
  Card,
  Button,
  Notice,
  Field,
  s,
  colors,
} from "../../components/ui";
import { daysUntil } from "../../lib/dateUtils";
import { today } from "../../lib/health";
export default function Settings() {
  const a = useAuth();
  const [invite, setInvite] = useState<{
      invite_id: string;
      invite_token: string;
      expires_at: string;
    } | null>(null),
    [message, setMessage] = useState(""),
    [myNameDraft, setMyName] = useState<string | null>(null),
    [relationshipStartDraft, setRelationshipStart] = useState<string | null>(
      null,
    ),
    [busy, setBusy] = useState(false);
  const myName = myNameDraft ?? a.profile?.private_name ?? "";
  const relationshipStart =
    relationshipStartDraft ?? a.couple?.relationship_start ?? "";
  async function task(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (e) {
      const reason = e instanceof Error ? e.message : "";
      setMessage(
        /^(이름을 입력|날짜를 YYYY-MM-DD|교제 시작일은)/.test(reason)
          ? reason
          : friendlyError(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Title>우리의 설정</Title>
      <Card>
        <Text style={s.section}>우리의 프로필</Text>
        <Field
          label="내 이름"
          placeholder="이름을 입력해 주세요"
          value={myName}
          onChangeText={setMyName}
          maxLength={40}
          returnKeyType="done"
        />
        <Button
          title="내 이름 저장"
          busy={busy}
          onPress={() =>
            void task(async () => {
              const value = myName.trim();
              if (!value) throw new Error("이름을 입력해 주세요.");
              await a.saveMyName(value);
              setMyName(null);
              setMessage("이름을 저장했어요.");
            })
          }
        />
        <Field
          label="교제 시작일"
          placeholder="YYYY-MM-DD"
          value={relationshipStart}
          onChangeText={setRelationshipStart}
          maxLength={10}
          keyboardType="numbers-and-punctuation"
        />
        <Body>저장한 날짜는 두 사람의 D-day 기준으로 함께 사용해요.</Body>
        <Button
          secondary
          title="교제 시작일 저장"
          busy={busy}
          onPress={() =>
            void task(async () => {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(relationshipStart))
                throw new Error("날짜를 YYYY-MM-DD 형식으로 입력해 주세요.");
              if (daysUntil(relationshipStart, today()) > 0)
                throw new Error("교제 시작일은 오늘 이후일 수 없어요.");
              await a.saveRelationshipStart(relationshipStart);
              setRelationshipStart(null);
              setMessage("교제 시작일을 저장했어요.");
            })
          }
        />
      </Card>
      <Card>
        <Text style={s.section}>{a.count}/2명 연결</Text>
        <Body>커플 안의 건강 기록은 두 사람이 같은 권한으로 관리해요.</Body>
        <Button
          secondary
          title="연결 상태 새로고침"
          onPress={() => void a.refresh()}
        />
      </Card>
      {a.count < 2 && (
        <Card>
          <Text style={s.section}>한 사람을 위한 초대</Text>
          <Body>새 코드를 만들면 이전 코드는 사용할 수 없어요.</Body>
          <Button
            title="초대 코드 만들기"
            busy={busy}
            onPress={() =>
              void task(async () => {
                const r = await db().rpc("create_couple_invite");
                if (r.error) throw r.error;
                setInvite(r.data[0]);
              })
            }
          />
          {invite && (
            <>
              <Text
                selectable
                style={{ color: colors.pink, fontSize: 15, lineHeight: 24 }}
              >
                {invite.invite_token}
              </Text>
              <Body>발급 후 24시간 동안 유효해요.</Body>
              <Button
                secondary
                title="코드 복사하기"
                onPress={() =>
                  void Clipboard.setStringAsync(invite.invite_token).then(() =>
                    setMessage("복사했어요. 상대에게 직접 전달해 주세요."),
                  )
                }
              />
              <Button
                secondary
                title="이 코드 폐기하기"
                busy={busy}
                onPress={() =>
                  void task(async () => {
                    const r = await db().rpc("revoke_couple_invite", {
                      p_invite_id: invite.invite_id,
                    });
                    if (r.error) throw r.error;
                    setInvite(null);
                  })
                }
              />
            </>
          )}
        </Card>
      )}
      <Notice text={message} />
      <Card>
        <Text style={s.section}>계정</Text>
        <Body>{a.session?.user.email}</Body>
        <Button
          secondary
          title="로그아웃"
          busy={busy}
          onPress={() =>
            void task(async () => {
              setInvite(null);
              await a.logout();
            })
          }
        />
        <Button
          secondary
          title="커플 연결 종료"
          disabled={busy}
          onPress={() =>
            Alert.alert(
              "커플 연결을 종료할까요?",
              "공유 기록에 접근할 수 없게 됩니다. 마지막 구성원이 나가면 건강 기록도 모두 삭제되며 되돌릴 수 없습니다.",
              [
                { text: "취소", style: "cancel" },
                {
                  text: "연결 종료",
                  style: "destructive",
                  onPress: () =>
                    void task(async () => {
                      const r = await db().rpc("leave_couple");
                      if (r.error) throw r.error;
                      setInvite(null);
                      await a.refresh();
                    }),
                },
              ],
            )
          }
        />
      </Card>
    </Screen>
  );
}
