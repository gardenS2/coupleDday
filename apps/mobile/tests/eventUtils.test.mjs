import { test } from "node:test";
import assert from "node:assert/strict";
import { monthRange, validateEventDraft } from "../src/lib/eventUtils.ts";

const valid = {
  title: "  처음 만난 날  ",
  event_date: "2028-02-29",
  event_type: "anniversary",
  icon_key: "heart",
};

test("normalizes a valid title and accepts a leap-day date", () => {
  assert.deepEqual(validateEventDraft(valid), { ...valid, title: "처음 만난 날", is_yearly: false });
});

test("rejects empty titles, malformed dates and unsupported icons", () => {
  assert.throws(() => validateEventDraft({ ...valid, title: "  " }), /이벤트명/);
  assert.throws(
    () => validateEventDraft({ ...valid, event_date: "2027-02-29" }),
    /날짜를 올바른/,
  );
  assert.throws(
    () => validateEventDraft({ ...valid, icon_key: "settings" }),
    /아이콘/,
  );
});

test("month range handles leap February and year boundaries", () => {
  assert.deepEqual(monthRange("2028-02"), {
    firstDate: "2028-02-01",
    lastDate: "2028-02-29",
  });
  assert.deepEqual(monthRange("2026-12"), {
    firstDate: "2026-12-01",
    lastDate: "2026-12-31",
  });
});

test("accepts an inclusive multi-day range and treats equal dates as one day", () => {
  assert.equal(
    validateEventDraft({ ...valid, event_date: "2027-01-11", end_date: "2027-01-13", event_type: "event" }).end_date,
    "2027-01-13",
  );
  assert.equal(
    validateEventDraft({ ...valid, event_date: "2027-01-11", end_date: "2027-01-11" }).end_date,
    null,
  );
});

test("rejects an end date before the start and recurring multi-day events", () => {
  assert.throws(
    () => validateEventDraft({ ...valid, event_date: "2027-01-13", end_date: "2027-01-11" }),
    /종료일은 시작일보다 빠를 수 없어요/,
  );
  assert.throws(
    () => validateEventDraft({ ...valid, event_date: "2027-01-11", end_date: "2027-01-13", is_yearly: true }),
    /여러 날 일정은 매년 반복할 수 없어요/,
  );
});
