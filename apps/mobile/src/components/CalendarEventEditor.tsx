import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { AppIcon, type IconName } from "./AppIcon";
import {
  Body,
  Button,
  Card,
  colors,
  Field,
  Notice,
  s,
} from "./ui";
import type { CoupleEvent, EventDraft, EventType } from "../lib/events";

const iconOptions: { name: IconName; label: string }[] = [
  { name: "heart", label: "하트" },
  { name: "calendar", label: "달력" },
  { name: "home", label: "홈" },
  { name: "drop", label: "마법" },
  { name: "book", label: "기록" },
];

export function CalendarEventEditor({
  initialDate,
  event,
  visible,
  busy,
  error,
  onClose,
  onSave,
}: {
  initialDate: string;
  event: CoupleEvent | null;
  visible: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (draft: EventDraft) => void;
}) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState(event?.event_date ?? initialDate);
  const [dateMode, setDateMode] = useState<"single" | "range">(
    event?.end_date && event.end_date > event.event_date ? "range" : "single",
  );
  const [endDate, setEndDate] = useState(event?.end_date ?? event?.event_date ?? initialDate);
  const [eventType, setEventType] = useState<EventType>(
    event?.event_type ?? "anniversary",
  );
  const [icon, setIcon] = useState<IconName | null>(event?.icon_key ?? "heart");
  const [yearly, setYearly] = useState(event?.is_yearly ?? false);
  const rangeDateError = dateMode === "range" && endDate < date
    ? "종료일은 시작일보다 빠를 수 없어요."
    : "";
  const isLeapDay = date.endsWith("-02-29");
  const canRepeat = eventType === "anniversary" && !isLeapDay && dateMode === "single";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0009" }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}
        >
          <View style={{ padding: 16, paddingBottom: 28 }}>
            <Card>
              <Text style={s.section}>{event ? "일정 수정" : "이 날 추가"}</Text>
              <Field
                label="이벤트명 (필수)"
                placeholder="예: 처음 만난 날"
                value={title}
                onChangeText={setTitle}
                maxLength={80}
                returnKeyType="done"
              />
              <View style={{ gap: 8 }}>
                <Text style={s.label}>날짜 방식</Text>
                <View style={{ ...s.row, flexWrap: "wrap" }}>
                  <Choice label="하루" selected={dateMode === "single"} onPress={() => setDateMode("single")} />
                  <Choice label="여러 날" selected={dateMode === "range"} onPress={() => { setDateMode("range"); setEndDate((value) => value || date); setYearly(false); }} />
                </View>
              </View>
              <Field
                label={dateMode === "single" ? "날짜 (필수)" : "시작일 (From)"}
                placeholder="YYYY-MM-DD"
                value={date}
                onChangeText={setDate}
                maxLength={10}
                keyboardType="numbers-and-punctuation"
              />
              {dateMode === "range" ? (
                <>
                  <Field
                    label="종료일 (To)"
                    placeholder="YYYY-MM-DD"
                    value={endDate}
                    onChangeText={setEndDate}
                    maxLength={10}
                    keyboardType="numbers-and-punctuation"
                  />
                  <Notice text={rangeDateError} />
                </>
              ) : null}
              <View style={{ gap: 8 }}>
                <Text style={s.label}>구분</Text>
                <View style={{ ...s.row, flexWrap: "wrap" }}>
                  <Choice
                    label="기념일"
                    selected={eventType === "anniversary"}
                    onPress={() => setEventType("anniversary")}
                  />
                  <Choice
                    label="일반 일정"
                    selected={eventType === "event"}
                    onPress={() => setEventType("event")}
                  />
                </View>
              </View>
              <View style={{ gap: 8 }}>
                <Text style={s.label}>아이콘 (선택)</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: icon === null }}
                    onPress={() => setIcon(null)}
                    style={choiceStyle(icon === null)}
                  >
                    <Body>없음</Body>
                  </Pressable>
                  {iconOptions.map((option) => (
                    <Pressable
                      key={option.name}
                      accessibilityRole="button"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected: icon === option.name }}
                      onPress={() => setIcon(option.name)}
                      style={choiceStyle(icon === option.name)}
                    >
                      <AppIcon
                        name={option.name}
                        color={icon === option.name ? colors.pink : colors.muted}
                      />
                    </Pressable>
                  ))}
                </View>
              </View>
              {eventType === "anniversary" && dateMode === "range" ? (
                <Body>기간 기념일의 매년 반복은 날짜 정책이 정해지지 않아 사용할 수 없어요.</Body>
              ) : eventType === "anniversary" && isLeapDay ? (
                <Body>2월 29일 기념일의 반복 날짜 정책이 정해지지 않아 매년 반복은 설정할 수 없어요.</Body>
              ) : canRepeat ? (
                <Choice
                  label={yearly ? "매년 반복 켜짐" : "매년 반복"}
                  selected={yearly}
                  onPress={() => setYearly((value) => !value)}
                />
              ) : null}
              <Notice text={error} />
              <Button
                title={event ? "변경 사항 저장" : "일정 저장"}
                busy={busy}
                onPress={() =>
                  onSave({
                    title,
                    event_date: date,
                    end_date: dateMode === "range" ? endDate : null,
                    event_type: eventType,
                    icon_key: icon,
                    is_yearly: canRepeat && yearly,
                  })
                }
              />
              <Button secondary title="취소" disabled={busy} onPress={onClose} />
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={choiceStyle(selected)}
    >
      <Text style={{ color: selected ? colors.pink : colors.text }}>{label}</Text>
    </Pressable>
  );
}

function choiceStyle(selected: boolean) {
  return {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: 14,
    backgroundColor: selected ? colors.wine : colors.soft,
    borderWidth: selected ? 1 : 0,
    borderColor: colors.pink,
  };
}
