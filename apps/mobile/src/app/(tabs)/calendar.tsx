import { useEffect, useState } from "react";
import { Alert, AppState, Pressable, Text, View, useWindowDimensions } from "react-native";
import { AppIcon } from "../../components/AppIcon";
import {
  Body,
  colors,
  Notice,
  Screen,
  s,
} from "../../components/ui";
import { useAuth } from "../../lib/auth";
import {
  calendarMonthDays,
  calendarWeekday,
  calendarWeekdays,
  moveCalendarMonth,
} from "../../lib/calendar";
import { daysUntil, formatDDay, localDateKey } from "../../lib/dateUtils";
import { cycleColors } from "../../lib/cyclePrediction";
import { loadHealth, type Period } from "../../lib/health";
import {
  createEvent,
  deleteEvent,
  loadEventsForMonth,
  updateEvent,
  type CoupleEvent,
  type EventDraft,
} from "../../lib/events";
import { friendlyError } from "../../lib/supabase";
import { calendarItemsForMonth } from "../../lib/calendarItems";
import { CalendarEventEditor } from "../../components/CalendarEventEditor";

export default function Calendar() {
  const { width: windowWidth } = useWindowDimensions();
  const auth = useAuth();
  const [today, setToday] = useState(localDateKey);
  const [month, setMonth] = useState(() => localDateKey().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(localDateKey);
  const [periodData, setPeriodData] = useState<{
    month: string;
    periods: Period[];
  }>({ month: "", periods: [] });
  const [periodError, setPeriodError] = useState({ month: "", message: "" });
  const eventRequestKey = `${auth.couple?.id ?? ""}:${month}:${auth.eventsRevision}`;
  const [eventResult, setEventResult] = useState<{
    key: string;
    events: CoupleEvent[];
    error: string;
  }>({ key: "", events: [], error: "" });
  const [editor, setEditor] = useState<
    { mode: "create"; date: string } | { mode: "edit"; event: CoupleEvent } | null
  >(null);
  const [editorError, setEditorError] = useState("");
  const [eventMessage, setEventMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleMidnight = () => {
      if (timer) clearTimeout(timer);
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(() => {
        setToday(localDateKey());
        scheduleMidnight();
      }, Math.max(1, midnight.getTime() - now.getTime()));
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setToday(localDateKey());
        scheduleMidnight();
      }
    });
    scheduleMidnight();
    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const coupleId = auth.couple?.id;
    if (!coupleId) return;
    let active = true;
    void loadHealth(coupleId, month)
      .then((data) => {
        if (active) {
          setPeriodData({ month, periods: data.periods });
          setPeriodError({ month, message: "" });
        }
      })
      .catch(() => {
        if (active) {
          setPeriodData({ month, periods: [] });
          setPeriodError({ month, message: "마법 기록을 불러오지 못했어요." });
        }
      });
    return () => {
      active = false;
    };
  }, [auth.couple?.id, month]);

  useEffect(() => {
    const coupleId = auth.couple?.id;
    if (!coupleId) return;
    let active = true;
    void loadEventsForMonth(coupleId, month)
      .then((events) => {
        if (active)
          setEventResult({ key: eventRequestKey, events, error: "" });
      })
      .catch(() => {
        if (active)
          setEventResult({
            key: eventRequestKey,
            events: [],
            error: "일정을 불러오지 못했어요. DB migration 적용 여부를 확인해 주세요.",
          });
      });
    return () => {
      active = false;
    };
  }, [auth.couple?.id, auth.eventsRevision, eventRequestKey, month]);

  const dates = calendarMonthDays(month);
  const [year, monthNumber] = month.split("-").map(Number);
  const [selectedYear, selectedMonth, selectedDay] = selectedDate
    .split("-")
    .map(Number);
  const selectedOffset = daysUntil(selectedDate, today);
  const selectedDDay = formatDDay(selectedOffset);

  function changeMonth(offset: number) {
    const next = moveCalendarMonth(month, selectedDate, offset);
    setMonth(next.month);
    setSelectedDate(next.selectedDate);
  }

  function selectDate(date: string) {
    setSelectedDate(date);
    setMonth(date.slice(0, 7));
  }

  const periods = periodData.month === month ? periodData.periods : [];
  const loadMessage = periodError.month === month ? periodError.message : "";

  function hasPeriod(date: string) {
    return periods.some(
      (period) =>
        period.start_date <= date && date <= (period.end_date ?? today),
    );
  }

  const selectedHasPeriod = hasPeriod(selectedDate);
  const periodsLoaded = periodData.month === month;
  const eventsLoaded = eventResult.key === eventRequestKey;
  const monthEvents = eventsLoaded ? eventResult.events : [];
  const calendarItems = calendarItemsForMonth(
    monthEvents, month, auth.couple?.relationship_start ?? null,
  );
  const selectedItems = calendarItems.filter((item) => item.date === selectedDate);

  async function saveDraft(draft: EventDraft) {
    const coupleId = auth.couple?.id;
    if (!coupleId || !editor) return;
    setSaving(true);
    setEditorError("");
    setEventMessage("");
    try {
      const saved =
        editor.mode === "edit"
          ? await updateEvent(coupleId, editor.event, draft)
          : await createEvent(coupleId, draft);
      const nextMonth = saved.event_date.slice(0, 7);
      const currentEvents =
        eventResult.key === eventRequestKey ? eventResult.events : [];
      const nextEvents =
        nextMonth === month
          ? [
              ...currentEvents.filter((event) => event.id !== saved.id),
              saved,
            ].sort((a, b) =>
              a.event_date < b.event_date
                ? -1
                : a.event_date > b.event_date
                  ? 1
                  : a.id < b.id
                    ? -1
                    : 1,
            )
          : [saved];
      setMonth(nextMonth);
      setSelectedDate(saved.event_date);
      setEventResult({
        key: `${coupleId}:${nextMonth}:${auth.eventsRevision + 1}`,
        events: nextEvents,
        error: "",
      });
      setEditor(null);
      setEventMessage("일정을 저장했어요.");
      auth.invalidateEvents();
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      setEditorError(/is_yearly/i.test(raw)
        ? "매년 반복 기능을 사용하려면 최신 DB migration을 먼저 적용해 주세요."
        : /^(이벤트명|이벤트 구분|이벤트 날짜|날짜|사용할 수 없는 아이콘)/.test(raw)
          ? raw
          : friendlyError(error));
    } finally {
      setSaving(false);
    }
  }

  function askToDelete(event: CoupleEvent) {
    Alert.alert("일정을 삭제할까요?", `‘${event.title}’ 일정이 삭제됩니다.`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => void removeEvent(event),
      },
    ]);
  }

  async function removeEvent(event: CoupleEvent) {
    const coupleId = auth.couple?.id;
    if (!coupleId || deletingId) return;
    setDeletingId(event.id);
    setEventMessage("");
    try {
      await deleteEvent(coupleId, event);
      setEventResult({
        key: `${coupleId}:${month}:${auth.eventsRevision + 1}`,
        events: monthEvents.filter((item) => item.id !== event.id),
        error: "",
      });
      setEventMessage("일정을 삭제했어요.");
      auth.invalidateEvents();
    } catch (error) {
      setEventMessage(friendlyError(error));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Screen>
      <View style={{ ...s.row, justifyContent: "space-between", paddingHorizontal: 14, marginBottom: -16 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="이전 달"
            onPress={() => changeMonth(-1)}
            hitSlop={10}
            style={{ padding: 8 }}
          >
            <AppIcon name="left" color={colors.pink} size={22} />
          </Pressable>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "700" }}>
            {year}년 {monthNumber}월
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="다음 달"
            onPress={() => changeMonth(1)}
            hitSlop={10}
            style={{ padding: 8 }}
          >
            <AppIcon name="right" color={colors.pink} size={22} />
          </Pressable>
      </View>

      <View style={{ backgroundColor: colors.card, borderRadius: 26, paddingHorizontal: 10, paddingTop: 12, paddingBottom: 12, gap: 3 }}>

        <View style={{ flexDirection: "row" }}>
          {calendarWeekdays.map((weekday, index) => (
            <Text
              key={weekday}
              style={{
                flex: 1,
                textAlign: "center",
                color: index === 0 ? "#F0808D" : index === 6 ? "#91B5F4" : colors.muted,
                fontSize: 12,
                paddingVertical: 4,
                fontWeight: "600",
              }}
            >
              {weekday}
            </Text>
          ))}
        </View>

        {Array.from({ length: dates.length / 7 }, (_, week) => (
          <View key={`${month}-week-${week}`} style={{ flexDirection: "row" }}>
            {dates.slice(week * 7, week * 7 + 7).map((date) => {
              const day = Number(date.slice(8, 10));
              const weekdayIndex = calendarWeekdays.indexOf(calendarWeekday(date) as (typeof calendarWeekdays)[number]);
              const inMonth = date.slice(0, 7) === month;
              const isSelected = date === selectedDate;
              const isToday = date === today;
              const marked = hasPeriod(date);
              const dayItems = calendarItems.filter((item) => item.date === date);
              const rangeItem = dayItems.find((item) =>
                item.event?.end_date && item.event.end_date > item.event.event_date,
              );
              const labelItem = dayItems.find((item) => item.source === "holiday") ??
                dayItems.find((item) => !item.event?.end_date || item.event.end_date <= item.event.event_date) ??
                dayItems.find((item) => item.event?.event_date === date);
              const period = periods.find((item) => item.start_date <= date && date <= (item.end_date ?? today));
              const itemColor = labelItem?.source === "holiday" ? "#F0808D" : labelItem?.source === "milestone" ? colors.pink : colors.muted;
              return (
                <Pressable
                  key={date}
                  accessibilityRole="button"
                  accessibilityLabel={`${date} ${calendarWeekday(date)}요일`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => selectDate(date)}
                  style={{
                    flex: 1,
                    height: Math.max(62, Math.min(76, (windowWidth - 68) / 7)),
                    alignItems: "center",
                    justifyContent: "flex-start",
                    paddingTop: 4,
                    backgroundColor: isSelected ? colors.soft : "transparent",
                    borderRadius: 12,
                  }}
                >
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 15,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isSelected ? colors.mint : "transparent",
                      borderWidth: isToday ? 1 : 0,
                      borderColor: colors.pink,
                    }}
                  >
                    <Text
                      style={{
                        color: !inMonth
                          ? "#685E69"
                          : isSelected
                            ? colors.bg
                            : isToday || weekdayIndex === 0
                              ? colors.pink
                              : weekdayIndex === 6 ? "#91B5F4" : colors.text,
                        fontSize: 13,
                        fontWeight: isToday || isSelected ? "700" : "400",
                      }}
                    >
                      {day}
                    </Text>
                  </View>
                  {labelItem ? (
                    <Text numberOfLines={1} style={{ color: itemColor, fontSize: 9, lineHeight: 12, maxWidth: "100%", textAlign: "center" }}>
                      {labelItem.title}
                    </Text>
                  ) : <View style={{ height: 12 }} />}
                  {rangeItem ? (
                    <View style={{ position: "absolute", bottom: 12, left: 0, right: 0, height: 3, backgroundColor: colors.pink,
                      borderTopLeftRadius: rangeItem.event?.event_date === date ? 3 : 0,
                      borderBottomLeftRadius: rangeItem.event?.event_date === date ? 3 : 0,
                      borderTopRightRadius: rangeItem.event?.end_date === date ? 3 : 0,
                      borderBottomRightRadius: rangeItem.event?.end_date === date ? 3 : 0 }} />
                  ) : null}
                  {marked ? (
                    <View style={{ position: "absolute", bottom: 7, left: 0, right: 0, height: 3, backgroundColor: cycleColors.period, opacity: 0.9 }}>
                      {period?.start_date === date ? <Text style={{ position: "absolute", top: 2, left: 2, color: cycleColors.period, fontSize: 8 }}>마법</Text> : null}
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 8, marginTop: -12 }}>
        <Legend color="#F0808D" label="공휴일" />
        <Legend color={colors.pink} label="우리 날" />
        <Legend color={colors.muted} label="이벤트 날" />
        <Legend color={cycleColors.period} label="마법" />
      </View>

      <View style={{ backgroundColor: colors.card, borderRadius: 26, padding: 22, gap: 16 }}>
        <View style={{ ...s.row, justifyContent: "space-between" }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700", flexShrink: 1 }}>
            {selectedYear}.{String(selectedMonth).padStart(2, "0")}.{String(selectedDay).padStart(2, "0")} ({calendarWeekday(selectedDate)})
          </Text>
          <Text style={{ color: colors.pink, fontSize: 18, fontWeight: "700" }}>{selectedDDay}</Text>
        </View>
        {loadMessage ? <Body>{loadMessage}</Body> : !periodsLoaded ? <Body>마법 기록을 불러오는 중이에요.</Body> : selectedHasPeriod ? <Body>마법 기간이에요.</Body> : null}
        <View style={{ gap: 12 }}>
          {eventsLoaded && eventResult.error ? (
            <Body>{eventResult.error}</Body>
          ) : !eventsLoaded ? (
            <Body>일정을 불러오는 중이에요.</Body>
          ) : selectedItems.length ? (
            selectedItems.map((item) => {
              const content = (
                <>
                  <AppIcon name={item.iconKey ?? "calendar"}
                    color={item.source === "milestone" ? colors.mint : colors.pink} size={21} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>
                      {item.title}
                    </Text>
                    <Body>
                      {item.source === "holiday" ? "공휴일" : item.source === "milestone" ? "우리 날 · 자동 계산" : `${item.eventType === "anniversary" ? "기념일" : "일반 일정"}${item.event?.is_yearly ? " · 매년 반복" : ""}`}
                    </Body>
                  </View>
                </>
              );
              return (
                <View key={item.id} style={{ ...s.row, justifyContent: "space-between", gap: 8 }}>
                  {item.event ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`${item.title} 수정`}
                      onPress={() => {
                        setEditorError("");
                        setEditor({ mode: "edit", event: item.event! });
                      }} style={{ ...s.row, flex: 1 }}>
                      {content}
                    </Pressable>
                  ) : <View style={{ ...s.row, flex: 1 }}>{content}</View>}
                  {item.event ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`${item.title} 삭제`}
                      accessibilityState={{ disabled: !!deletingId }} disabled={!!deletingId}
                      onPress={() => askToDelete(item.event!)} style={{ padding: 8 }}>
                      <AppIcon name="trash" color={colors.muted} size={20} />
                    </Pressable>
                  ) : null}
                </View>
              );
            })
          ) : (
            <Body>등록된 날이 없어요</Body>
          )}
          <Notice text={eventMessage} />
          <Pressable accessibilityRole="button" onPress={() => { setEditorError(""); setEditor({ mode: "create", date: selectedDate }); }} style={{ alignSelf: "flex-end", backgroundColor: colors.wine, borderRadius: 24, paddingVertical: 10, paddingHorizontal: 18 }}>
            <Text style={{ color: colors.pink, fontSize: 15, fontWeight: "600" }}>+ 이 날 추가</Text>
          </Pressable>
        </View>
      </View>
      {editor ? (
        <CalendarEventEditor
          key={editor.mode === "edit" ? editor.event.id : `new-${editor.date}`}
          initialDate={editor.mode === "create" ? editor.date : editor.event.event_date}
          event={editor.mode === "edit" ? editor.event : null}
          visible
          busy={saving}
          error={editorError}
          onClose={() => setEditor(null)}
          onSave={(draft) => void saveDraft(draft)}
        />
      ) : null}
    </Screen>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ ...s.row, gap: 7 }}>
      <View
        style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }}
      />
      <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}
