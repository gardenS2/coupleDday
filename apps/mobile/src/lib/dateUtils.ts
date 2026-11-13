const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function epochDay(value: string): number {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new RangeError(`Invalid date-only value: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31)
    throw new RangeError(`Invalid date-only value: ${value}`);

  // setUTCFullYear avoids Date.UTC's special handling of years 0 through 99.
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new RangeError(`Invalid date-only value: ${value}`);
  return date.getTime() / DAY_MS;
}

function dateFromEpochDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Difference in local-calendar date labels; positive when `to` is later. */
export function differenceInCalendarDays(from: string, to: string): number {
  return epochDay(to) - epochDay(from);
}

/** Add whole calendar days to a YYYY-MM-DD value without local-time arithmetic. */
export function addCalendarDays(date: string, amount: number): string {
  if (!Number.isInteger(amount)) throw new RangeError("Days must be an integer");
  return dateFromEpochDay(epochDay(date) + amount);
}

/** Relationship start date counts as day one. */
export function relationshipDay(startDate: string, today: string): number {
  return differenceInCalendarDays(startDate, today) + 1;
}

export function daysUntil(eventDate: string, today: string): number {
  return differenceInCalendarDays(today, eventDate);
}

export function formatDDay(days: number): string {
  if (!Number.isInteger(days)) throw new RangeError("Days must be an integer");
  if (days === 0) return "D-DAY";
  return days > 0 ? `D-${days}` : `D+${Math.abs(days)}`;
}

/** The 100th day is the relationship start plus 99 calendar days. */
export function relationship100thDay(startDate: string): string {
  return addCalendarDays(startDate, 99);
}

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12)
    throw new RangeError("Invalid year or month");
  const first = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12
    ? `${String(year + 1).padStart(4, "0")}-01-01`
    : `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`;
  return differenceInCalendarDays(first, nextMonth);
}

/** Build today's date key from the device's local calendar, never UTC. */
export function localDateKey(now: Date = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid date");
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
