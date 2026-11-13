import { useCallback, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  Text,
  View,
  TextInput,
  StyleSheet,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Field, Button, Notice, colors } from "../components/ui";
import { useAuth } from "../lib/auth";
import {
  type Daily,
  type Period,
  today,
  validDate,
  symptoms,
  moods,
  loadHealth,
  saveDaily,
  savePeriod,
  removeHealth,
} from "../lib/health";
import { AppIcon, MoodIcon } from "../components/AppIcon";
import { predictCycle, cycleMark, cycleColors } from "../lib/cyclePrediction";
import { friendlyError } from "../lib/supabase";
const demoDaily: Daily = {
  id: "demo",
  couple_id: "demo",
  log_date: "2026-10-19",
  symptoms: ["피곤"],
  mood: "평온해요",
  memo: "따뜻한 차와 함께 천천히 쉬었던 하루.",
  version: 1,
  updated_by: null,
};
const demoHistory: Period[] = [
  {
    id: "demo-period",
    couple_id: "demo",
    start_date: "2026-10-19",
    end_date: "2026-10-23",
    version: 1,
  },
  {
    id: "demo-sep",
    couple_id: "demo",
    start_date: "2026-09-21",
    end_date: "2026-09-25",
    version: 1,
  },
  {
    id: "demo-aug",
    couple_id: "demo",
    start_date: "2026-08-24",
    end_date: "2026-08-28",
    version: 1,
  },
];
const markLabels = {
  period: "마법",
  fertile: "가임기 (예측)",
  ovulation: "배란 예정",
  expected: "마법 예정",
};
export default function Health({ preview = false }: { preview?: boolean }) {
  const auth = useAuth();
  const couple = auth.couple?.id;
  const [date, setDate] = useState(preview ? "2026-10-25" : today()),
    [month, setMonth] = useState(preview ? "2026-10" : today().slice(0, 7));
  const [daily, setDaily] = useState<Daily[]>(preview ? [demoDaily] : []),
    [periods, setPeriods] = useState<Period[]>(
      preview
        ? [
            {
              id: "demo-period",
              couple_id: "demo",
              start_date: "2026-10-19",
              end_date: "2026-10-23",
              version: 1,
            },
          ]
        : [],
    );
  const [history, setHistory] = useState<Period[]>(preview ? demoHistory : []);
  const asOf = preview ? "2026-10-25" : today();
  const forecast = predictCycle(history, asOf);
  const [chosen, setChosen] = useState<string[]>([]),
    [mood, setMood] = useState<string | null>(null),
    [memo, setMemo] = useState("");
  const [start, setStart] = useState(date),
    [end, setEnd] = useState(""),
    [editing, setEditing] = useState<Period>(),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState("");
  const [periodOpen, setPeriodOpen] = useState(false);
  const epoch = useRef(0);
  const record = daily.find((r) => r.log_date === date);
  const refresh = useCallback(async (targetMonth = month, targetDate = date) => {
    if (preview || !couple) return;
    const run = ++epoch.current;
    setLoading(true);
    try {
      const data = await loadHealth(couple, targetMonth);
      if (run === epoch.current) {
        setDaily(data.daily);
        setPeriods(data.periods);
        setHistory(data.history);
        const row = data.daily.find((r) => r.log_date === targetDate);
        setChosen(row?.symptoms ?? []);
        setMood(row?.mood ?? null);
        setMemo(row?.memo ?? "");
        setMessage("");
      }
    } catch (e) {
      if (run === epoch.current) {
        setDaily([]);
        setPeriods([]);
        setHistory([]);
        setMessage(friendlyError(e));
      }
    } finally {
      if (run === epoch.current) setLoading(false);
    }
  }, [couple, month, date, preview, setChosen, setMood, setMemo]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        epoch.current++;
        if (!preview) {
          setDaily([]);
          setPeriods([]);
          setHistory([]);
          setMemo("");
          setChosen([]);
          setMood(null);
        }
      };
    }, [refresh, preview, setChosen, setMood, setMemo]),
  );
  function chooseDate(value: string) {
    setDate(value);
    const row = daily.find((r) => r.log_date === value);
    setChosen(row?.symptoms ?? []);
    setMood(row?.mood ?? null);
    setMemo(row?.memo ?? "");
  }
  const locked = busy || loading;
  async function act(
    work: () => Promise<void>,
    refreshTarget?: { month: string; date: string },
  ) {
    if (preview) {
      setMessage("디자인 미리보기예요. 가상 기록은 서버에 저장하지 않아요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await work();
      await refresh(refreshTarget?.month, refreshTarget?.date);
      setMessage("두 사람의 공간에 반영했어요.");
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  function confirmDelete(
    table: "cycle_daily_logs" | "cycle_records",
    row: Daily | Period,
  ) {
    Alert.alert(
      "공유 기록을 삭제할까요?",
      "상대의 화면에서도 사라져요. 삭제 후 되돌릴 수 없어요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: () =>
            void act(() => removeHealth(table, row.id, row.version)),
        },
      ],
    );
  }
  function moveMonth(offset: number) {
    const d = new Date(month + "-01T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + offset);
    const next = d.toISOString().slice(0, 7);
    setMonth(next);
    chooseDate(next + "-01");
    setEditing(undefined);
    setStart(next + "-01");
    setEnd("");
  }
  const first = new Date(month + "-01T00:00:00Z").getUTCDay();
  const days = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  const activePeriod = periods.find(
    (p) => p.start_date <= date && (!p.end_date || date <= p.end_date),
  );
  const shortDate = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  function openPeriod(row?: Period) {
    setEditing(row);
    setStart(row?.start_date ?? date);
    setEnd(row?.end_date ?? "");
    setPeriodOpen(true);
  }
  return (
    <SafeAreaView style={h.screen} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={h.content}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void refresh()}
              tintColor={colors.pink}
            />
          }
        >
          <View style={h.monthHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="이전 달"
              disabled={locked}
              onPress={() => moveMonth(-1)}
              style={h.arrow}
            >
              <AppIcon name="left" />
            </Pressable>
            <Text accessibilityRole="header" style={h.monthTitle}>
              {Number(month.slice(0, 4))}년 {Number(month.slice(5, 7))}월
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="다음 달"
              disabled={locked}
              onPress={() => moveMonth(1)}
              style={h.arrow}
            >
              <AppIcon name="right" />
            </Pressable>
          </View>
          <View style={h.calendar}>
            <View style={h.grid}>
              {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
                <Text key={day} style={h.weekday}>
                  {day}
                </Text>
              ))}
              {Array.from(
                { length: Math.ceil((days + first) / 7) * 7 },
                (_, i) => {
                  const d = i - first + 1;
                  if (d < 1 || d > days)
                    return <View key={i} style={h.dayCell} />;
                  const value = `${month}-${String(d).padStart(2, "0")}`;
                  const mark = cycleMark(
                    value,
                    periods,
                    forecast.prediction,
                    asOf,
                  );
                  const selected = value === date;
                  const hasLog = daily.some((r) => r.log_date === value);
                  return (
                    <Pressable
                      key={i}
                      disabled={locked}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: locked }}
                      accessibilityLabel={`${value}${mark ? ", " + markLabels[mark] : ""}${hasLog ? ", 일일 기록 있음" : ""}`}
                      onPress={() => chooseDate(value)}
                      style={h.dayCell}
                    >
                      {selected && (
                        <View pointerEvents="none" style={h.selectionRing} />
                      )}
                      <View
                        style={[
                          h.dayCircle,
                          mark === "period" && h.periodDay,
                          mark === "fertile" && h.fertileDay,
                          mark === "ovulation" && h.ovulationDay,
                          mark === "expected" && h.expectedDay,
                          selected && !mark && h.selectedDay,
                        ]}
                      >
                        <Text
                          style={[
                            h.dayNumber,
                            mark === "period" && { color: colors.pink },
                            (mark === "fertile" || mark === "ovulation") && {
                              color: cycleColors.fertileText,
                            },
                            mark === "expected" && {
                              color: cycleColors.expected,
                            },
                          ]}
                        >
                          {d}
                        </Text>
                        {hasLog && <View style={h.recordDot} />}
                        {value === today() && !selected && (
                          <View style={h.todayLine} />
                        )}
                      </View>
                    </Pressable>
                  );
                },
              )}
            </View>
            <View style={h.legend}>
              {(
                [
                  ["마법", { backgroundColor: cycleColors.period }],
                  ["가임기", { backgroundColor: cycleColors.fertile }],
                  [
                    "배란 예정",
                    { borderWidth: 2, borderColor: cycleColors.ovulation },
                  ],
                  [
                    "마법 예정",
                    { borderWidth: 2, borderColor: cycleColors.expected },
                  ],
                ] as const
              ).map(([label, style]) => (
                <View style={h.legendItem} key={label}>
                  <View style={[h.legendDot, style]} />
                  <Text style={h.legendText}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={{ gap: 5 }}>
            <Text style={h.footnote}>{forecast.explanation}</Text>
            {forecast.prediction && (
              <Text style={h.footnote}>
                다음 마법{" "}
                {forecast.prediction.nextStart.slice(5).replace("-", "/")} ~{" "}
                {forecast.prediction.nextEnd.slice(5).replace("-", "/")} · 배란
                예정 {forecast.prediction.ovulation.slice(5).replace("-", "/")}
                {"\n"}
                {forecast.prediction.defaultDuration
                  ? "마법 기간은 기본 5일로 임시 계산해요."
                  : `기록된 마법 기간 평균 ${forecast.prediction.periodDays}일 기준`}
              </Text>
            )}
            {forecast.prediction?.irregular && (
              <Text style={h.footnote}>
                주기 차이가 커서 예정일의 오차가 클 수 있어요.
              </Text>
            )}
            {forecast.prediction?.overdue && (
              <Text style={h.footnote}>
                예정일이 지났어요. 새 시작일을 기록하면 다시 계산해요.
              </Text>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            onPress={() => openPeriod(activePeriod)}
            style={({ pressed }) => [
              h.periodButton,
              { opacity: locked ? 0.5 : pressed ? 0.8 : 1 },
            ]}
          >
            <AppIcon name="drop" color="#2B1822" size={22} />
            <Text style={h.periodButtonText}>
              {shortDate} {activePeriod ? "마법 기간 수정" : "마법 시작"}
            </Text>
          </Pressable>
          <Notice text={message} />
          <View style={h.sectionHeader}>
            <Text style={h.sectionLabel}>{shortDate} 기록</Text>
            <Text style={h.shared}>두 사람의 공유 기록</Text>
          </View>
          <View style={h.logCard}>
            <Text style={h.label}>증상</Text>
            <View style={h.chips}>
              {symptoms.map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: chosen.includes(item),
                    disabled: locked,
                  }}
                  disabled={locked}
                  onPress={() =>
                    setChosen(
                      chosen.includes(item)
                        ? chosen.filter((v) => v !== item)
                        : [...chosen, item],
                    )
                  }
                  style={[h.chip, chosen.includes(item) && h.chipSelected]}
                >
                  <Text
                    style={[
                      h.chipText,
                      chosen.includes(item) && { color: colors.pink },
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={h.label}>기분</Text>
            <View style={h.moods}>
              {moods.map((item, i) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityLabel={item}
                  accessibilityState={{
                    selected: mood === item,
                    disabled: locked,
                  }}
                  disabled={locked}
                  onPress={() => setMood(mood === item ? null : item)}
                  style={[h.mood, mood === item && h.chipSelected]}
                >
                  <MoodIcon index={i} />
                </Pressable>
              ))}
            </View>
            <View style={{ gap: 6 }}>
              <TextInput
                accessibilityLabel="공유 메모"
                placeholder="메모"
                placeholderTextColor={colors.muted}
                multiline
                maxLength={300}
                editable={!locked}
                value={memo}
                onChangeText={setMemo}
                style={h.memo}
              />
              <Text style={h.counter}>{memo.length}/300</Text>
            </View>
            <Button
              title={record ? "기록 수정 저장" : "기록 저장"}
              busy={busy}
              disabled={loading || (!preview && !couple)}
              onPress={() =>
                void act(() =>
                  saveDaily(
                    couple!,
                    date,
                    { symptoms: chosen, mood, memo },
                    record,
                  ),
                )
              }
            />
            {record && (
              <Pressable
                accessibilityRole="button"
                disabled={locked}
                onPress={() => confirmDelete("cycle_daily_logs", record)}
                style={h.deleteDaily}
              >
                <Text style={h.deleteText}>이 날 기록 삭제</Text>
              </Pressable>
            )}
          </View>
          <View style={h.sectionHeader}>
            <Text style={h.sectionLabel}>지난 기록</Text>
            <Pressable
              accessibilityRole="button"
              disabled={locked}
              onPress={() => openPeriod()}
              hitSlop={8}
            >
              <Text style={h.addText}>기간 추가</Text>
            </Pressable>
          </View>
          {loading && history.length === 0 ? (
            <View style={h.history}>
              <Text style={h.empty}>지난 기록을 불러오는 중이에요.</Text>
            </View>
          ) : history.length === 0 && !message ? (
            <View style={h.history}>
              <Text style={h.empty}>지난 생리 기록이 없어요.</Text>
            </View>
          ) : (
            history.map((p) => (
              <View style={h.history} key={p.id}>
                <AppIcon name="drop" color={colors.pink} size={23} filled />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${p.start_date} 마법 기간 수정`}
                  disabled={locked}
                  onPress={() => openPeriod(p)}
                  style={{ flex: 1, paddingVertical: 6 }}
                >
                  <Text style={h.historyText}>
                    {formatPeriodDate(p.start_date)} ~{"\n"}
                    {p.end_date ? formatPeriodDate(p.end_date) : "진행 중"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${p.start_date} 마법 기간 삭제`}
                  disabled={locked}
                  onPress={() => confirmDelete("cycle_records", p)}
                  style={h.trashButton}
                >
                  <AppIcon name="trash" size={21} />
                </Pressable>
              </View>
            ))
          )}
          <Text style={h.footnote}>
            두 사람 모두 기록을 수정·삭제할 수 있어요.{"\n"}예측은 평균값 기반
            추정이며 의학적 판단이나 피임 수단으로 쓸 수 없어요. 표시되지 않은
            날도 임신 가능성이 없는 날을 뜻하지 않아요.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal
        visible={periodOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setPeriodOpen(false);
        }}
      >
        <KeyboardAvoidingView
          style={h.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <SafeAreaView style={h.sheet} edges={["bottom"]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 24, gap: 18 }}
            >
              <View style={h.sheetHandle} />
              <Text style={h.sheetTitle}>
                {editing ? "마법 기간 수정" : `${shortDate} 마법 시작`}
              </Text>
              <Text style={h.footnote}>
                시작일과 종료일을 기록해 주세요. 진행 중이면 종료일은 비워
                두세요.
              </Text>
              <Field
                label="시작일"
                placeholder="YYYY-MM-DD"
                value={start}
                onChangeText={setStart}
                editable={!busy}
                maxLength={10}
              />
              <Field
                label="종료일 (선택)"
                placeholder="YYYY-MM-DD"
                value={end}
                onChangeText={setEnd}
                editable={!busy}
                maxLength={10}
              />
              <Notice text={message} />
              <Button
                title={editing ? "기간 수정 저장" : "마법 시작 기록"}
                busy={busy}
                disabled={
                  loading ||
                  (!preview && !couple) ||
                  !validDate(start) ||
                  (!!end && (!validDate(end) || end < start))
                }
                onPress={() =>
                  void act(async () => {
                    await savePeriod(couple!, start, end || null, editing);
                    setPeriodOpen(false);
                    setEditing(undefined);
                    setMonth(start.slice(0, 7));
                    setDate(start);
                  }, { month: start.slice(0, 7), date: start })
                }
              />
              <Button
                secondary
                title="닫기"
                disabled={busy}
                onPress={() => setPeriodOpen(false)}
              />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
function formatPeriodDate(value: string) {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  return `${value.replaceAll("-", ".")} (${"일월화수목금토"[day]})`;
}
const h = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#141116" },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32, gap: 18 },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  monthTitle: { color: colors.text, fontSize: 24, fontWeight: "700" },
  arrow: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  calendar: {
    backgroundColor: "#211D25",
    borderRadius: 24,
    paddingHorizontal: 10,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 12,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: {
    width: "14.2857%",
    textAlign: "center",
    color: colors.muted,
    fontSize: 13,
    paddingBottom: 16,
  },
  dayCell: {
    width: "14.2857%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircle: {
    width: "94%",
    aspectRatio: 1,
    maxWidth: 54,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  periodDay: { backgroundColor: cycleColors.period },
  fertileDay: { backgroundColor: cycleColors.fertile },
  ovulationDay: {
    backgroundColor: cycleColors.fertile,
    borderColor: cycleColors.ovulation,
  },
  expectedDay: { borderColor: cycleColors.expected },
  selectionRing: {
    position: "absolute",
    width: "100%",
    aspectRatio: 1,
    maxWidth: 58,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: colors.mint,
  },
  selectedDay: { backgroundColor: "#50404D" },
  dayNumber: { color: colors.text, fontSize: 17 },
  recordDot: {
    position: "absolute",
    bottom: 5,
    width: 4,
    height: 4,
    borderRadius: 4,
    backgroundColor: colors.mint,
  },
  todayLine: {
    position: "absolute",
    bottom: 4,
    width: 12,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.pink,
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 9,
    paddingTop: 4,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 6 },
  legendText: { color: colors.muted, fontSize: 11 },
  periodButton: {
    backgroundColor: "#F2AAC5",
    borderRadius: 40,
    minHeight: 44,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  periodButtonText: { color: "#2B1822", fontSize: 18, fontWeight: "700" },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    marginTop: 4,
  },
  sectionLabel: { color: colors.muted, fontSize: 16 },
  shared: { color: colors.muted, fontSize: 11 },
  logCard: {
    borderRadius: 24,
    backgroundColor: "#211D25",
    padding: 17,
    gap: 16,
  },
  label: { color: colors.muted, fontSize: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 4 },
  chip: {
    backgroundColor: "#2B2431",
    borderRadius: 30,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: "transparent",
  },
  chipSelected: { backgroundColor: colors.wine, borderColor: colors.pink },
  chipText: { color: "#D7C7D0", fontSize: 16, fontWeight: "600" },
  moods: { flexDirection: "row", gap: 10 },
  mood: {
    width: 54,
    height: 48,
    borderRadius: 28,
    backgroundColor: "#2B2431",
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  memo: {
    borderRadius: 18,
    backgroundColor: "#2B2431",
    padding: 16,
    minHeight: 100,
    color: colors.text,
    fontSize: 17,
    textAlignVertical: "top",
  },
  counter: {
    color: "#D0BFC9",
    fontSize: 14,
    textAlign: "right",
    paddingRight: 12,
  },
  deleteDaily: { alignSelf: "center", padding: 10 },
  deleteText: { color: colors.muted, fontSize: 13 },
  addText: { color: colors.pink, fontSize: 13 },
  history: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    backgroundColor: "#211D25",
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  historyText: { color: "#D7C7D0", fontSize: 16, lineHeight: 26 },
  empty: { color: colors.muted, fontSize: 14, paddingVertical: 14 },
  trashButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  footnote: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 20,
    paddingHorizontal: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "#00000099",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "90%",
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    alignSelf: "center",
  },
  sheetTitle: { color: colors.text, fontSize: 23, fontWeight: "700" },
});
