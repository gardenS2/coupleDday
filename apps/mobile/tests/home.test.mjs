import { test } from "node:test";
import assert from "node:assert/strict";
import { upcomingHomeEvents } from "../src/lib/home.ts";

const event = (id, date) => ({ id, title: `이벤트 ${id}`, date });

test("no events returns an empty list", () => {
  assert.deepEqual(upcomingHomeEvents([], "2026-10-25"), []);
});

test("includes today and formats its weekday and D-day", () => {
  assert.deepEqual(upcomingHomeEvents([event("today", "2026-10-25")], "2026-10-25"), [
    { ...event("today", "2026-10-25"), weekday: "일", dday: "D-DAY" },
  ]);
});

test("sorts by date, keeps equal-date order stable, and limits to five", () => {
  const result = upcomingHomeEvents(
    [
      event("f", "2026-11-15"),
      event("d", "2026-11-11"),
      event("b", "2026-11-11"),
      event("past", "2026-10-24"),
      event("e", "2026-11-13"),
      event("a", "2026-10-25"),
      event("c", "2026-11-12"),
    ],
    "2026-10-25",
  );
  assert.deepEqual(
    result.map(({ id, dday }) => [id, dday]),
    [
      ["a", "D-DAY"],
      ["b", "D-17"],
      ["d", "D-17"],
      ["c", "D-18"],
      ["e", "D-19"],
    ],
  );
  assert.equal(result[1].weekday, "수");
});

test("labels an active date range as ongoing", () => {
  assert.equal(upcomingHomeEvents([
    { ...event("active", "2027-01-10"), end_date: "2027-01-13", is_ongoing: true },
  ], "2027-01-10")[0].dday, "진행 중");
});
