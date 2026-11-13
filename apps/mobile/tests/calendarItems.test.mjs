import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarItemsForMonth,
  holidayYearsAvailable,
  upcomingCalendarItems,
  yearlyOccurrence,
} from "../src/lib/calendarItems.ts";

const event = (id, date, options = {}) => ({
  id,
  couple_id: "couple",
  title: options.title ?? `일정 ${id}`,
  event_date: date,
  end_date: options.end_date ?? null,
  event_type: options.event_type ?? "anniversary",
  icon_key: "heart",
  is_yearly: options.is_yearly ?? false,
  created_by: null,
  updated_by: null,
  created_at: "",
  updated_at: "",
  version: 1,
});

test("yearly solar anniversary uses the original month/day across years", () => {
  const recurring = event("christmas", "2026-12-25", { is_yearly: true });
  assert.equal(yearlyOccurrence(recurring.event_date, 2027), "2027-12-25");
  assert.equal(calendarItemsForMonth([recurring], "2027-12", null)[0].date, "2027-12-25");
  assert.deepEqual(
    calendarItemsForMonth([recurring], "2026-12", null)
      .filter((item) => item.source === "event").map((item) => item.date),
    ["2026-12-25"],
  );
});

test("Feb 29 recurrence stays unresolved outside its original year", () => {
  assert.equal(yearlyOccurrence("2024-02-29", 2027), null);
  assert.equal(yearlyOccurrence("2024-02-29", 2028), null);
  const recurring = event("leap", "2024-02-29", { is_yearly: true });
  assert.deepEqual(
    calendarItemsForMonth([recurring], "2027-02", null).filter((item) => item.source === "event"),
    [],
  );
  assert.equal(
    calendarItemsForMonth([recurring], "2024-02", null).find((item) => item.source === "event")?.date,
    "2024-02-29",
  );
});

test("100th-day and annual couple milestones use the relationship start", () => {
  assert.equal(
    calendarItemsForMonth([], "2027-01", "2026-10-08").find((item) => item.title === "100일")?.date,
    "2027-01-15",
  );
  assert.equal(
    calendarItemsForMonth([], "2027-10", "2026-10-08").find((item) => item.title === "1주년")?.date,
    "2027-10-08",
  );
  assert.equal(
    calendarItemsForMonth([], "2027-01", "2026-10-09").find((item) => item.title === "100일")?.date,
    "2027-01-16",
  );
  assert.equal(
    calendarItemsForMonth([], "2028-02", "2024-02-29").some((item) => item.title.endsWith("주년")),
    false,
  );
});

test("a manually entered anniversary suppresses the same-day automatic milestone", () => {
  const manual = event("manual", "2027-01-15", { title: "100일 기념" });
  const items = calendarItemsForMonth([manual], "2027-01", "2026-10-08");
  assert.equal(items.filter((item) => item.date === "2027-01-15").length, 1);
  assert.equal(items.find((item) => item.date === "2027-01-15").source, "event");
});

test("official 2026/2027 holiday set includes substitute holidays and is bounded", () => {
  assert.deepEqual(holidayYearsAvailable(), [2026, 2027]);
  const items2026 = calendarItemsForMonth([], "2026-08", null);
  assert.ok(items2026.some((item) => item.date === "2026-08-17" && item.title.includes("대체공휴일")));
  const items2027 = calendarItemsForMonth([], "2027-07", null);
  assert.ok(items2027.some((item) => item.date === "2027-07-19" && item.title.includes("대체공휴일")));
  assert.deepEqual(calendarItemsForMonth([], "2028-07", null), []);
});

test("same-day items retain all entries with a stable display order", () => {
  const items = calendarItemsForMonth([
    event("z", "2027-01-15", { event_type: "event" }),
    event("b", "2027-01-15", { event_type: "event" }),
  ], "2027-01", "2026-10-08");
  const sameDay = items.filter((item) => item.date === "2027-01-15");
  assert.deepEqual(sameDay.map((item) => item.id), [
    "event:b:2027-01-15", "event:z:2027-01-15", "milestone:2026-10-08:100",
  ]);
});

test("home resolves overdue annual events to their next date and sorts the TOP 5", () => {
  const oldRepeating = event("winter", "2025-12-25", { is_yearly: true });
  const result = upcomingCalendarItems([oldRepeating], null, "2027-12-28");
  assert.equal(result[0].date, "2028-12-25");
  assert.equal(result[0].event?.id, "winter");
  assert.ok(result.length <= 5);
  assert.ok(result.every((item) => item.date >= "2027-12-28"));
});

test("multi-day events appear once on each inclusive calendar date", () => {
  const trip = event("trip", "2027-01-11", { end_date: "2027-01-13", event_type: "event" });
  const overlap = event("overlap", "2027-01-12", { event_type: "event" });
  const allItems = calendarItemsForMonth([trip, overlap], "2027-01", null);
  const items = allItems.filter((item) => item.event?.id === "trip");
  assert.deepEqual(items.map((item) => item.date), ["2027-01-11", "2027-01-12", "2027-01-13"]);
  assert.equal(new Set(items.map((item) => item.id)).size, 3);
  assert.deepEqual(allItems.filter((item) => item.date === "2027-01-12" && item.source === "event").map((item) => item.event?.id), ["overlap", "trip"]);
});

test("multi-day events are queryable across month and year boundaries", () => {
  const monthEdge = event("month", "2027-01-30", { end_date: "2027-02-02", event_type: "event" });
  const yearEdge = event("year", "2027-12-30", { end_date: "2028-01-02", event_type: "event" });
  assert.deepEqual(
    calendarItemsForMonth([monthEdge], "2027-02", null).filter((item) => item.event?.id === "month").map((item) => item.date),
    ["2027-02-01", "2027-02-02"],
  );
  assert.deepEqual(
    calendarItemsForMonth([yearEdge], "2028-01", null).filter((item) => item.event?.id === "year").map((item) => item.date),
    ["2028-01-01", "2028-01-02"],
  );
});

test("home shows a future range once and an active range as ongoing, excluding ended ranges", () => {
  const future = event("future", "2027-01-11", { end_date: "2027-01-13", event_type: "event" });
  const active = event("active", "2027-01-09", { end_date: "2027-01-13", event_type: "event" });
  const ended = event("ended", "2027-01-01", { end_date: "2027-01-02", event_type: "event" });
  const futureItems = upcomingCalendarItems([future], null, "2027-01-10");
  const futureRangeItems = futureItems.filter((item) => item.event?.id === "future");
  assert.equal(futureRangeItems.length, 1);
  assert.equal(futureRangeItems[0].date, "2027-01-11");
  const activeItems = upcomingCalendarItems([active, ended], null, "2027-01-10");
  const activeRangeItems = activeItems.filter((item) => item.event?.id === "active");
  assert.equal(activeRangeItems.length, 1);
  assert.equal(activeRangeItems[0].isOngoing, true);
  assert.equal(activeRangeItems[0].date, "2027-01-10");
  assert.equal(activeItems.some((item) => item.event?.id === "ended"), false);
});
