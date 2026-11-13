import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarDays,
  daysInMonth,
  daysUntil,
  differenceInCalendarDays,
  formatDDay,
  localDateKey,
  relationship100thDay,
  relationshipDay,
} from "../src/lib/dateUtils.ts";

test("relationship day and event countdown use inclusive local calendar dates", () => {
  assert.equal(relationshipDay("2026-10-08", "2026-10-25"), 18);
  assert.equal(daysUntil("2026-11-11", "2026-10-25"), 17);
  assert.equal(formatDDay(17), "D-17");
  assert.equal(formatDDay(daysUntil("2026-10-25", "2026-10-25")), "D-DAY");
  assert.equal(formatDDay(-2), "D+2");
});

test("relationship 100th day is start plus 99 days", () => {
  assert.equal(relationship100thDay("2026-10-08"), "2027-01-15");
});

test("leap and common February lengths are correct", () => {
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2027, 2), 28);
  assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addCalendarDays("2028-02-29", 1), "2028-03-01");
});

test("month and year boundaries retain date-only values", () => {
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(differenceInCalendarDays("2026-12-31", "2027-01-01"), 1);
});

test("date-only arithmetic is independent of device timezone", () => {
  const originalTZ = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const utcResult = {
      day: relationshipDay("2026-10-08", "2026-10-25"),
      next: addCalendarDays("2026-12-31", 1),
      localToday: localDateKey(new Date(2026, 9, 25, 0, 30)),
    };
    process.env.TZ = "America/Los_Angeles";
    const westResult = {
      day: relationshipDay("2026-10-08", "2026-10-25"),
      next: addCalendarDays("2026-12-31", 1),
      localToday: localDateKey(new Date(2026, 9, 25, 0, 30)),
    };
    assert.deepEqual(utcResult, westResult);
    assert.equal(utcResult.localToday, "2026-10-25");
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});

test("invalid date-only values and fractional day shifts are rejected", () => {
  assert.throws(() => differenceInCalendarDays("2027-02-29", "2027-03-01"), RangeError);
  assert.throws(() => addCalendarDays("2026-01-01", 1.5), RangeError);
});
