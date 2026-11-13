import { daysUntil, formatDDay } from "./dateUtils.ts";
import type { IconName } from "../components/AppIcon";

export type HomeEvent = {
  id: string;
  title: string;
  date: string;
  start_date?: string;
  end_date?: string | null;
  is_ongoing?: boolean;
  event_type?: "anniversary" | "event";
  icon_key?: IconName | null;
  source?: "event" | "milestone" | "holiday";
};

export type UpcomingHomeEvent = HomeEvent & {
  weekday: string;
  dday: string;
};

/** Stable date, weekday and D-day formatting for already-resolved occurrences. */
export function upcomingHomeEvents(
  events: readonly HomeEvent[],
  today: string,
): UpcomingHomeEvent[] {
  return events
    .filter((event) => daysUntil(event.date, today) >= 0)
    .slice()
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    )
    .slice(0, 5)
    .map((event) => ({
      ...event,
      weekday: weekdayOf(event.date),
      dday: event.is_ongoing ? "진행 중" : formatDDay(daysUntil(event.date, today)),
    }));
}

function weekdayOf(dateOnly: string): string {
  // Validate the date and calculate weekday in UTC so device timezone cannot shift it.
  daysUntil(dateOnly, dateOnly);
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return ["일", "월", "화", "수", "목", "금", "토"][date.getUTCDay()];
}
