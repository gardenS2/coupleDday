import { useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";
import { router } from "expo-router";
import { AppIcon } from "../../components/AppIcon";
import {
  Screen,
  Brand,
  Title,
  Body,
  Card,
  Button,
  colors,
  s,
} from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { localDateKey, relationshipDay } from "../../lib/dateUtils";
import { upcomingHomeEvents } from "../../lib/home";
import { loadUpcomingEvents, type CoupleEvent } from "../../lib/events";
import { upcomingCalendarItems } from "../../lib/calendarItems";

export default function Home() {
  const a = useAuth();
  const [today, setToday] = useState(localDateKey);
  const eventRequestKey = `${a.couple?.id ?? ""}:${today}:${a.eventsRevision}`;
  const [eventResult, setEventResult] = useState<{
    key: string;
    events: CoupleEvent[];
    error: string;
  }>({ key: "", events: [], error: "" });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleMidnightRefresh = () => {
      if (timer) clearTimeout(timer);
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(() => {
        setToday(localDateKey());
        scheduleMidnightRefresh();
      }, Math.max(1, midnight.getTime() - now.getTime()));
    };
    const refreshDate = () => {
      setToday(localDateKey());
      scheduleMidnightRefresh();
    };
    scheduleMidnightRefresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshDate();
    });
    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const coupleId = a.couple?.id;
    if (!coupleId) return;
    let active = true;
    void loadUpcomingEvents(coupleId, today)
      .then((events) => {
        if (active) setEventResult({ key: eventRequestKey, events, error: "" });
      })
      .catch(() => {
        if (active)
          setEventResult({
            key: eventRequestKey,
            events: [],
            error: "다가오는 일정을 불러오지 못했어요.",
          });
      });
    return () => {
      active = false;
    };
  }, [a.couple?.id, a.eventsRevision, eventRequestKey, today]);

  const days = a.couple
    ? relationshipDay(a.couple.relationship_start, today)
    : null;
  const loadedEvents = eventResult.key === eventRequestKey;
  const upcomingItems = upcomingCalendarItems(
    eventResult.events, a.couple?.relationship_start ?? null, today,
  );
  const events = upcomingHomeEvents(upcomingItems.map((item) => ({
    id: item.id,
    title: item.title,
    date: item.date,
    start_date: item.event?.event_date ?? item.date,
    end_date: item.endDate ?? item.event?.end_date ?? null,
    is_ongoing: item.isOngoing ?? false,
    event_type: item.eventType,
    icon_key: item.iconKey,
    source: item.source,
  })), today);
  const myName = a.profile?.private_name.trim();
  const partnerName = a.profile?.partner_name?.trim();

  return (
    <Screen>
      <Brand />
      <View style={{ ...s.row, justifyContent: "center", gap: 12 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "600" }}>
          {myName || "내 이름 미등록"}
        </Text>
        <AppIcon name="heart" size={22} color={colors.pink} filled />
        <Text style={{ color: colors.muted, fontSize: 18, fontWeight: "600" }}>
          {partnerName || "연인 이름 미등록"}
        </Text>
      </View>
      <Title>함께라서,{"\n"}오늘도 좋은 날.</Title>
      <View
        style={{
          ...s.card,
          backgroundColor: colors.wine,
          paddingVertical: 34,
          alignItems: "center",
        }}
      >
        <Text style={{ color: colors.pink, fontSize: 14 }}>
          OUR DAYS TOGETHER
        </Text>
        <Text style={{ color: colors.pink, fontSize: 64, fontWeight: "800" }}>
          {days === null ? "D+—" : `D+${days}`}
        </Text>
        {a.couple ? (
          <Body>{a.couple.relationship_start}부터 함께</Body>
        ) : (
          <Body>교제 시작일을 불러오지 못했어요.</Body>
        )}
      </View>
      <Card>
        <Text style={s.section}>다가오는 날</Text>
        {eventResult.key === eventRequestKey && eventResult.error ? (
          <Body>{eventResult.error}</Body>
        ) : !loadedEvents ? (
          <Body>일정을 불러오는 중이에요.</Body>
        ) : events.length ? (
          events.map((event) => (
            <View key={event.id} style={{ ...s.row, justifyContent: "space-between" }}>
              <View style={{ ...s.row, flex: 1 }}>
                <AppIcon name={event.icon_key ?? "calendar"} size={22} color={colors.pink} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>
                    {event.title}
                  </Text>
                  <Body>
                    {event.source === "holiday" ? "공휴일 · " : event.source === "milestone" ? "우리 날 · " : event.event_type === "anniversary" ? "기념일 · " : "일정 · "}
                    {event.start_date && event.end_date && event.end_date > event.start_date
                      ? `${event.start_date} ~ ${event.end_date}`
                      : event.date} ({event.weekday})
                  </Body>
                </View>
              </View>
              <Text style={{ color: colors.pink, fontWeight: "700" }}>
                {event.dday}
              </Text>
            </View>
          ))
        ) : (
          <Body>등록된 일정이 없어요. 달력에서 소중한 날을 관리해 보세요.</Body>
        )}
        <Button
          secondary
          title="일정 관리"
          onPress={() => router.push("/(tabs)/calendar")}
        />
      </Card>
      <Card>
        <Text style={s.section}>
          {a.count === 2
            ? "두 사람이 연결되어 있어요"
            : "소중한 한 사람을 기다려요"}
        </Text>
        <Body>
          {a.count === 2
            ? "오늘의 마음과 몸도 함께 살펴보세요."
            : "초대 코드를 보내 둘만의 공간을 완성해요."}
        </Body>
        <Button
          title={a.count === 2 ? "오늘의 건강 기록" : "초대 코드 만들기"}
          onPress={() =>
            router.push(a.count === 2 ? "/(tabs)/magic" : "/(tabs)/settings")
          }
        />
      </Card>
    </Screen>
  );
}
