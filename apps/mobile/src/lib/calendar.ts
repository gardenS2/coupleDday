import { addCalendarDays, daysInMonth } from "./dateUtils.ts";

export const calendarWeekdays = ["일", "월", "화", "수", "목", "금", "토"] as const;

function parseMonth(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new RangeError(`Invalid calendar month: ${month}`);
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  daysInMonth(year, monthNumber);
  return { year, monthNumber };
}

export function calendarWeekday(dateOnly: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new RangeError(`Invalid date-only value: ${dateOnly}`);
  return calendarWeekdays[date.getUTCDay()];
}

/** Full Sunday-to-Saturday rows, including dimmed adjacent-month dates. */
export function calendarMonthDays(month: string): string[] {
  const { year, monthNumber } = parseMonth(month);
  const first = `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}-01`;
  const firstWeekday = calendarWeekdays.indexOf(
    calendarWeekday(first) as (typeof calendarWeekdays)[number],
  );
  const count = daysInMonth(year, monthNumber);
  const cells = Math.ceil((firstWeekday + count) / 7) * 7;
  return Array.from({ length: cells }, (_, index) =>
    addCalendarDays(first, index - firstWeekday),
  );
}

export function moveCalendarMonth(
  month: string,
  selectedDate: string,
  offset: number,
): { month: string; selectedDate: string } {
  if (!Number.isInteger(offset)) throw new RangeError("Month offset must be an integer");
  const { year, monthNumber } = parseMonth(month);
  calendarWeekday(selectedDate);
  if (selectedDate.slice(0, 7) !== month)
    throw new RangeError("Selected date must belong to the visible month");
  const absoluteMonth = year * 12 + monthNumber - 1 + offset;
  const nextYear = Math.floor(absoluteMonth / 12);
  const nextMonth = ((absoluteMonth % 12) + 12) % 12 + 1;
  const nextMonthKey = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
  const day = Number(selectedDate.slice(8, 10));
  if (!Number.isInteger(day)) throw new RangeError(`Invalid selected date: ${selectedDate}`);
  const nextDay = Math.min(day, daysInMonth(nextYear, nextMonth));
  return {
    month: nextMonthKey,
    selectedDate: `${nextMonthKey}-${String(nextDay).padStart(2, "0")}`,
  };
}
