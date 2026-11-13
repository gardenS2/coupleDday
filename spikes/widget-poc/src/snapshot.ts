export type Snapshot = { title: string; dday: string; next: string; month: string; weeks: string[]; events: string[]; updated: string };
const DAY = 86400000;
export function ordinal(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid civil date');
  const value = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('Invalid civil date');
  return value / DAY;
}
export function seoulDate(now: Date): string {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function dPlus(start: string, today: string): number { return ordinal(today) - ordinal(start) + 1; }
export function dLabel(target: string, today: string): string {
  const days = ordinal(target) - ordinal(today);
  return days === 0 ? 'D-DAY' : days > 0 ? `D-${days}` : `D+${-days}`;
}
export function snapshot(today: string): Snapshot {
  const start = '2026-01-01';
  const month = today.slice(0, 7);
  const dates = [5, 15, 25];
  const names = ['산책 약속', '책방 데이트', '함께 요리'];
  const first = new Date(month + '-01T00:00:00Z');
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = Array.from({length: 42}, (_, i) => {
    const d = i - first.getUTCDay() + 1;
    return d < 1 || d > count ? '   ' : String(d).padStart(2, ' ') + (dates.includes(d) ? '*' : ' ');
  });
  return { title: '하늘 ♥ 바다', dday: `D+${dPlus(start, today)}`, next: '가상 기념일 ' + dLabel('2026-12-01', today), month,
    weeks: Array.from({length: 6}, (_, i) => cells.slice(i * 7, i * 7 + 7).join(' ')),
    events: dates.map((d, i) => `${d}일 ${names[i]}`), updated: today };
}
export function timeline(now: Date) {
  const today = seoulDate(now);
  const midnight = new Date(today + 'T00:00:00+09:00').getTime();
  return Array.from({length: 8}, (_, i) => {
    const date = i === 0 ? now : new Date(midnight + i * DAY);
    return { date, props: snapshot(seoulDate(date)) };
  });
}
