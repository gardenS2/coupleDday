import type { IconName } from "../components/AppIcon";
import { daysInMonth, daysUntil } from "./dateUtils.ts";

export type EventType = "anniversary" | "event";
export type EventDraft = {
  title: string;
  event_date: string;
  end_date?: string | null;
  event_type: EventType;
  icon_key: IconName | null;
  is_yearly?: boolean;
};

const EVENT_ICONS: IconName[] = ["heart", "calendar", "home", "drop", "book"];

export function validateEventDraft(draft: EventDraft): EventDraft {
  const title = draft.title.trim();
  if (!title) throw new Error("이벤트명을 입력해 주세요.");
  if (title.length > 80) throw new Error("이벤트명은 80자 이내로 입력해 주세요.");
  try {
    daysUntil(draft.event_date, draft.event_date);
    if (draft.end_date) daysUntil(draft.end_date, draft.end_date);
  } catch {
    throw new Error("날짜를 올바른 YYYY-MM-DD 형식으로 입력해 주세요.");
  }
  if (draft.end_date && draft.end_date < draft.event_date)
    throw new Error("종료일은 시작일보다 빠를 수 없어요.");
  if (draft.is_yearly && draft.end_date && draft.end_date > draft.event_date)
    throw new Error("여러 날 일정은 매년 반복할 수 없어요.");
  if (draft.event_type !== "anniversary" && draft.event_type !== "event")
    throw new Error("이벤트 구분을 선택해 주세요.");
  if (draft.icon_key !== null && !EVENT_ICONS.includes(draft.icon_key))
    throw new Error("사용할 수 없는 아이콘이에요.");
  return {
    ...draft,
    title,
    ...(draft.end_date !== undefined
      ? { end_date: draft.end_date && draft.end_date > draft.event_date ? draft.end_date : null }
      : {}),
    is_yearly: draft.event_type === "anniversary" && (draft.is_yearly ?? false),
  };
}

export function monthRange(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new RangeError(`Invalid event month: ${month}`);
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const lastDay = daysInMonth(year, monthNumber);
  return { firstDate: `${month}-01`, lastDate: `${month}-${String(lastDay).padStart(2, "0")}` };
}
