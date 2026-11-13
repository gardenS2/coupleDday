import { test } from "node:test";
import assert from "node:assert/strict";
import {
  predictCycle,
  cycleMark,
  addDays,
} from "../src/lib/cyclePrediction.ts";
const period = (start, end = null) => ({
  id: start,
  couple_id: "test",
  start_date: start,
  end_date: end,
  version: 1,
});
const regular = [
  period("2026-10-19", "2026-10-23"),
  period("2026-09-21", "2026-09-25"),
  period("2026-08-24", "2026-08-28"),
];
test("no history gives no predictions, one record explicitly uses defaults", () => {
  assert.equal(predictCycle([], "2026-10-25").prediction, null);
  const r = predictCycle([regular[0]], "2026-10-25");
  assert.equal(r.prediction.cycleDays, 28);
  assert.equal(r.prediction.intervalCount, 0);
  assert.match(r.explanation, /기본 28일/);
});
test("average start intervals and inclusive period durations cross month boundary", () => {
  const p = predictCycle(regular, "2026-10-25").prediction;
  assert.equal(p.nextStart, "2026-11-16");
  assert.equal(p.nextEnd, "2026-11-20");
  assert.equal(p.ovulation, "2026-11-02");
  assert.equal(p.fertileStart, "2026-10-28");
  assert.equal(p.fertileEnd, "2026-11-03");
  assert.equal(p.intervalCount, 2);
});

test("actual recorded periods mark every inclusive date through month and year edges", () => {
  const october = period("2026-10-19", "2026-10-23");
  for (const day of [19, 20, 21, 22, 23]) {
    assert.equal(cycleMark(`2026-10-${String(day).padStart(2, "0")}`, [october], null, "2026-10-25"), "period");
  }
  const monthEdge = period("2026-10-30", "2026-11-03");
  assert.equal(cycleMark("2026-10-31", [monthEdge], null, "2026-11-05"), "period");
  assert.equal(cycleMark("2026-11-03", [monthEdge], null, "2026-11-05"), "period");
  const yearEdge = period("2026-12-30", "2027-01-02");
  assert.equal(cycleMark("2027-01-01", [yearEdge], null, "2027-01-05"), "period");
});
test("mark precedence keeps actual records above forecasts and ovulation above fertile fill", () => {
  const p = predictCycle(regular, "2026-10-25").prediction;
  assert.equal(cycleMark("2026-10-19", regular, p, "2026-10-25"), "period");
  assert.equal(cycleMark("2026-10-28", regular, p, "2026-10-25"), "fertile");
  assert.equal(cycleMark("2026-11-02", regular, p, "2026-10-25"), "ovulation");
  assert.equal(cycleMark("2026-11-16", regular, p, "2026-10-25"), "expected");
  assert.equal(
    cycleMark(
      "2026-11-16",
      [period("2026-11-16", "2026-11-20")],
      p,
      "2026-11-16",
    ),
    "period",
  );
  assert.equal(cycleMark("2026-11-04", regular, p, "2026-10-25"), null);
});
test("overdue prediction stays anchored; no invented future cycles", () => {
  const p = predictCycle(regular, "2027-01-05").prediction;
  assert.equal(p.nextStart, "2026-11-16");
  assert.equal(p.overdue, true);
  assert.equal(cycleMark("2027-01-11", regular, p, "2027-01-05"), null);
});
test("future records are excluded from averaging and input order is immaterial", () => {
  const input = [...regular].reverse();
  const copy = JSON.stringify(input);
  assert.deepEqual(
    predictCycle([...input, period("2027-01-01")], "2026-10-25"),
    predictCycle(regular, "2026-10-25"),
  );
  assert.equal(JSON.stringify(input), copy);
});
test("leap day, year boundary and DST are calendar-day arithmetic", () => {
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
});
test("implausible/missing intervals and long unclosed periods suppress estimates", () => {
  assert.equal(
    predictCycle([period("2026-10-19"), period("2026-10-18")], "2026-10-25")
      .prediction,
    null,
  );
  assert.equal(
    predictCycle([period("2026-10-19"), period("2026-01-01")], "2026-10-25")
      .prediction,
    null,
  );
  assert.equal(
    predictCycle([period("2026-10-01")], "2026-10-25").prediction,
    null,
  );
});
test("changing or deleting a shared period recalculates estimates; irregularity flagged", () => {
  const p = predictCycle(
    [
      period("2026-10-19", "2026-10-23"),
      period("2026-09-21", "2026-09-25"),
      period("2026-08-10", "2026-08-14"),
    ],
    "2026-10-25",
  ).prediction;
  assert.equal(p.cycleDays, 35);
  assert.equal(p.irregular, true);
  assert.equal(
    predictCycle(regular.slice(1), "2026-10-25").prediction.nextStart,
    "2026-10-19",
  );
});
test("recent six intervals only and duration default remains explicit", () => {
  const p = predictCycle([period("2026-10-19")], "2026-10-25").prediction;
  assert.equal(p.periodDays, 5);
  assert.equal(p.defaultDuration, true);
  const starts = Array.from({ length: 9 }, (_, i) =>
    period(addDays("2026-10-19", -28 * i), addDays("2026-10-19", -28 * i + 4)),
  );
  assert.equal(predictCycle(starts, "2026-10-25").prediction.intervalCount, 6);
});
