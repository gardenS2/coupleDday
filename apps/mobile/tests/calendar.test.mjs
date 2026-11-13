import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarMonthDays,
  calendarWeekday,
  moveCalendarMonth,
} from "../src/lib/calendar.ts";

test("month grid starts on Sunday and places dates in their weekday columns", () => {
  const days = calendarMonthDays("2026-11");
  assert.equal(days[0], "2026-11-01");
  assert.equal(calendarWeekday(days[0]), "일");
  assert.equal(days[6], "2026-11-07");
  assert.equal(calendarWeekday(days[6]), "토");
});

test("leap February has 29 dates and common February has 28", () => {
  const leap = calendarMonthDays("2028-02");
  const common = calendarMonthDays("2027-02");
  assert.ok(leap.includes("2028-02-29"));
  assert.equal(leap.filter((date) => date.startsWith("2028-02-")).length, 29);
  assert.equal(common.filter((date) => date.startsWith("2027-02-")).length, 28);
  assert.equal(common[0], "2027-01-31");
  assert.equal(common[1], "2027-02-01");
});

test("moving across December and January changes year and clamps selection", () => {
  assert.deepEqual(moveCalendarMonth("2026-12", "2026-12-31", 1), {
    month: "2027-01",
    selectedDate: "2027-01-31",
  });
  assert.deepEqual(moveCalendarMonth("2027-01", "2027-01-31", 1), {
    month: "2027-02",
    selectedDate: "2027-02-28",
  });
  assert.deepEqual(moveCalendarMonth("2027-01", "2027-01-31", -1), {
    month: "2026-12",
    selectedDate: "2026-12-31",
  });
});

test("calendar date layout is timezone independent", () => {
  const originalTZ = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const utc = calendarMonthDays("2028-02");
    process.env.TZ = "America/Los_Angeles";
    assert.deepEqual(calendarMonthDays("2028-02"), utc);
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});
