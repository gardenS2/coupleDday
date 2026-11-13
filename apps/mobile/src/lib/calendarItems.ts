import { addCalendarDays, daysInMonth, daysUntil } from "./dateUtils.ts";
import type { CoupleEvent } from "./events";

export type CalendarItemSource = "event" | "milestone" | "holiday";
export type CalendarItem = {
  id: string;
  title: string;
  date: string;
  source: CalendarItemSource;
  event?: CoupleEvent;
  eventType?: "anniversary" | "event";
  iconKey: CoupleEvent["icon_key"];
  endDate?: string;
  isOngoing?: boolean;
};

type Holiday = { date: string; name: string };

// Verified against the Korea AeroSpace Administration's published annual
// almanacs. Add a year only after its official almanac is published/checked.
const HOLIDAYS: Record<number, Holiday[]> = {
  2026: [
    ["01-01", "새해"], ["02-16", "설날 연휴"], ["02-17", "설날"], ["02-18", "설날 연휴"],
    ["03-01", "3·1절"], ["03-02", "3·1절 대체공휴일"], ["05-01", "노동절"],
    ["05-05", "어린이날"], ["05-24", "부처님오신날"], ["05-25", "부처님오신날 대체공휴일"],
    ["06-03", "전국동시지방선거"], ["06-06", "현충일"], ["07-17", "제헌절"],
    ["08-15", "광복절"], ["08-17", "광복절 대체공휴일"], ["09-24", "추석 연휴"],
    ["09-25", "추석"], ["09-26", "추석 연휴"], ["10-03", "개천절"],
    ["10-05", "개천절 대체공휴일"], ["10-09", "한글날"], ["12-25", "기독탄신일"],
  ].map(([md, name]) => ({ date: `2026-${md}`, name })),
  2027: [
    ["01-01", "새해"], ["02-06", "설날 연휴"], ["02-07", "설날"], ["02-08", "설날 연휴"],
    ["02-09", "설날 대체공휴일"], ["03-01", "3·1절"], ["05-01", "노동절"],
    ["05-03", "노동절 대체공휴일"], ["05-05", "어린이날"], ["05-13", "부처님오신날"],
    ["06-06", "현충일"], ["07-17", "제헌절"], ["07-19", "제헌절 대체공휴일"],
    ["08-15", "광복절"], ["08-16", "광복절 대체공휴일"], ["09-14", "추석 연휴"],
    ["09-15", "추석"], ["09-16", "추석 연휴"], ["10-03", "개천절"],
    ["10-04", "개천절 대체공휴일"], ["10-09", "한글날"], ["10-11", "한글날 대체공휴일"],
    ["12-25", "기독탄신일"], ["12-27", "기독탄신일 대체공휴일"],
  ].map(([md, name]) => ({ date: `2027-${md}`, name })),
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateInYear(monthDay: string, year: number) {
  const date = `${year}-${monthDay}`;
  try {
    daysUntil(date, date);
    return date;
  } catch {
    return null;
  }
}

/** Same solar month/day; Feb 29 is omitted in non-leap years, never shifted. */
export function yearlyOccurrence(originalDate: string, year: number) {
  const monthDay = originalDate.slice(5);
  // Leap-day recurrence remains unresolved. Preserve the original date only;
  // do not infer a substitute date or decide which later years should recur.
  if (monthDay === "02-29" && year !== Number(originalDate.slice(0, 4))) return null;
  const candidate = dateInYear(monthDay, year);
  return candidate && candidate >= originalDate ? candidate : null;
}

function eventsForMonth(events: readonly CoupleEvent[], month: string): CalendarItem[] {
  const year = Number(month.slice(0, 4));
  const last = `${month}-${pad(daysInMonth(year, Number(month.slice(5, 7))))}`;
  const output: CalendarItem[] = [];
  for (const event of events) {
    if (!event.is_yearly) {
      const eventEnd = event.end_date ?? event.event_date;
      const firstVisible = `${month}-01`;
      const lastVisible = `${month}-${pad(daysInMonth(year, Number(month.slice(5, 7))))}`;
      if (event.event_date <= lastVisible && eventEnd >= firstVisible) {
        let date = event.event_date < firstVisible ? firstVisible : event.event_date;
        while (date <= eventEnd && date <= lastVisible) {
          output.push({
            id: `event:${event.id}:${date}`, title: event.title,
            date, source: "event", event,
            eventType: event.event_type, iconKey: event.icon_key,
          });
          date = addCalendarDays(date, 1);
        }
      }
      continue;
    }
    const occurrence = yearlyOccurrence(event.event_date, year);
    if (occurrence?.startsWith(`${month}-`) && occurrence <= last) output.push({
      id: `event:${event.id}:${occurrence}`, title: event.title,
      date: occurrence, source: "event", event,
      eventType: event.event_type, iconKey: event.icon_key,
    });
  }
  return output;
}

function milestonesForMonth(startDate: string | null, month: string): CalendarItem[] {
  if (!startDate) return [];
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const first = `${month}-01`;
  const last = `${month}-${pad(daysInMonth(year, monthNumber))}`;
  if (last < startDate) return [];
  const firstOrdinal = Math.max(1, Math.ceil((daysUntil(startDate, first) + 1) / 100));
  const output: CalendarItem[] = [];
  for (let ordinal = firstOrdinal; ; ordinal++) {
    const number = ordinal * 100;
    const date = addCalendarDays(startDate, number - 1);
    if (date > last) break;
    if (date >= first) output.push({
      id: `milestone:${startDate}:${number}`, title: `${number}일`, date,
      source: "milestone", eventType: "anniversary", iconKey: "heart",
    });
  }
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  if (monthNumber === startMonth && year > startYear && !(startMonth === 2 && startDay === 29)) {
    const date = dateInYear(`${pad(startMonth)}-${pad(startDay)}`, year);
    if (date && date <= last) {
      const years = year - startYear;
      output.push({
        id: `milestone:${startDate}:${years}y`, title: `${years}주년`, date,
        source: "milestone", eventType: "anniversary", iconKey: "heart",
      });
    }
  }
  return output;
}

function holidaysForMonth(month: string): CalendarItem[] {
  const year = Number(month.slice(0, 4));
  return (HOLIDAYS[year] ?? [])
    .filter(({ date }) => date.startsWith(`${month}-`))
    .map(({ date, name }) => ({
      id: `holiday:${date}:${name}`, title: name, date, source: "holiday",
      eventType: "event", iconKey: "calendar",
    }));
}

function suppressDuplicateMilestones(items: CalendarItem[]) {
  const manualAnniversaryDates = new Set(
    items.filter((item) => item.source === "event" && item.eventType === "anniversary")
      .map((item) => item.date),
  );
  return items.filter((item) =>
    item.source !== "milestone" || !manualAnniversaryDates.has(item.date),
  );
}

const sourceOrder: Record<CalendarItemSource, number> = { holiday: 0, event: 1, milestone: 2 };
function sortItems(items: CalendarItem[]) {
  return items.sort((a, b) => a.date.localeCompare(b.date) ||
    sourceOrder[a.source] - sourceOrder[b.source] || a.id.localeCompare(b.id));
}

export function calendarItemsForMonth(
  events: readonly CoupleEvent[], month: string, relationshipStart: string | null,
) {
  return sortItems(suppressDuplicateMilestones([
    ...eventsForMonth(events, month),
    ...milestonesForMonth(relationshipStart, month),
    ...holidaysForMonth(month),
  ]));
}

export function upcomingCalendarItems(
  events: readonly CoupleEvent[], relationshipStart: string | null, today: string,
) {
  const horizon = addCalendarDays(today, 365);
  const output = new Map<string, CalendarItem>();
  for (let cursor = today.slice(0, 7); cursor <= horizon.slice(0, 7); ) {
    const monthItems = calendarItemsForMonth(events, cursor, relationshipStart);
    for (const item of monthItems)
      if (item.date >= today && item.date <= horizon &&
        !(item.event?.end_date && item.event.end_date > item.event.event_date)) output.set(item.id, item);
    const [year, month] = cursor.split("-").map(Number);
    cursor = month === 12 ? `${year + 1}-01` : `${year}-${pad(month + 1)}`;
  }
  for (const event of events) {
    if (!event.is_yearly) {
      if (event.end_date && event.end_date > event.event_date && event.end_date >= today && event.event_date <= horizon) {
        const isOngoing = event.event_date <= today;
        const date = isOngoing ? today : event.event_date;
        output.set(`event:${event.id}:${event.event_date}`, {
          id: `event:${event.id}:${event.event_date}`, title: event.title, date,
          source: "event", event, eventType: event.event_type, iconKey: event.icon_key,
          endDate: event.end_date, isOngoing,
        });
      }
      continue;
    }
    let year = Number(today.slice(0, 4));
    for (let attempt = 0; attempt < 9; attempt++, year++) {
      const date = yearlyOccurrence(event.event_date, year);
      if (!date || date < today || date > horizon) continue;
      output.set(`event:${event.id}:${date}`, {
        id: `event:${event.id}:${date}`, title: event.title, date,
        source: "event", event, eventType: event.event_type, iconKey: event.icon_key,
      });
      break;
    }
  }
  const items = sortItems(suppressDuplicateMilestones([...output.values()]));
  return items.slice(0, 5);
}

export function holidayYearsAvailable() {
  return Object.keys(HOLIDAYS).map(Number).sort((a, b) => a - b);
}
