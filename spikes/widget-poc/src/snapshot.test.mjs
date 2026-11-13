import test from 'node:test';
import assert from 'node:assert/strict';
import { dPlus, dLabel, seoulDate, snapshot, timeline, ordinal } from './snapshot.ts';
test('start day is 1 and 100th day includes start', () => {
  assert.equal(dPlus('2026-01-01', '2026-01-01'), 1);
  assert.equal(dPlus('2026-01-01', '2026-04-10'), 100);
});
test('Seoul midnight independent of host timezone', () => {
  assert.equal(seoulDate(new Date('2026-10-25T14:59:59Z')), '2026-10-25');
  assert.equal(seoulDate(new Date('2026-10-25T15:00:00Z')), '2026-10-26');
});
test('future, same day, past, leap and invalid dates', () => {
  assert.equal(dLabel('2027-01-01','2026-12-31'), 'D-1');
  assert.equal(dLabel('2026-01-01','2026-01-01'), 'D-DAY');
  assert.equal(dLabel('2026-01-01','2026-01-02'), 'D+1');
  assert.equal(dPlus('2024-02-28','2024-03-01'),3);
  assert.throws(() => ordinal('2026-02-29'));
});
test('month grid has correct start, length and exactly 3 marked events', () => {
  const s=snapshot('2026-02-28');
  assert.equal(s.weeks.length,6);
  assert.equal(s.events.length,3);
  assert.equal(s.weeks.join('').match(/\*/g).length,3);
  assert.equal(s.weeks[0].slice(0,2),' 1');
  assert.ok(!s.weeks.join('').includes('29'));
  assert.equal(snapshot('2026-10-26').dday,'D+299');
});
test('timeline starts now then Seoul midnights over month rollover', () => {
  const entries=timeline(new Date('2026-10-31T14:59:00Z'));
  assert.equal(entries.length,8);
  assert.equal(entries[1].date.toISOString(),'2026-10-31T15:00:00.000Z');
  assert.equal(entries[1].props.month,'2026-11');
});
