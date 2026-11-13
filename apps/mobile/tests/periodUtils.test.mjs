import { test } from "node:test";
import assert from "node:assert/strict";
import { findPeriodOverlap } from "../src/lib/periodUtils.ts";

const period = (id, start_date, end_date) => ({ id, start_date, end_date });

test("period date ranges overlap inclusively and adjacent ranges do not", () => {
  const existing = [period("saved", "2026-10-19", "2026-10-23")];
  assert.equal(findPeriodOverlap(existing, "2026-10-23", "2026-10-25")?.id, "saved");
  assert.equal(findPeriodOverlap(existing, "2026-10-24", "2026-10-26"), undefined);
});

test("open periods overlap future ranges, and editing excludes its own record", () => {
  const existing = [period("open", "2026-10-19", null)];
  assert.equal(findPeriodOverlap(existing, "2026-11-01", "2026-11-03")?.id, "open");
  assert.equal(findPeriodOverlap(existing, "2026-10-19", "2026-10-23", "open"), undefined);
});
