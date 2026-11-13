import type { Period } from "./health";
import { addCalendarDays, differenceInCalendarDays } from "./dateUtils.ts";

export const cycleColors = {
  period: "#613047",
  fertile: "#2D294D",
  fertileText: "#C7B7F4",
  ovulation: "#C7B7F4",
  expected: "#AE7E96",
};
const dayNumber = (value: string) => differenceInCalendarDays("1970-01-01", value);
export const addDays = addCalendarDays;
const average = (values: number[]) =>
  Math.round(values.reduce((sum, n) => sum + n, 0) / values.length);
export type CyclePrediction = {
  nextStart: string;
  nextEnd: string;
  ovulation: string;
  fertileStart: string;
  fertileEnd: string;
  cycleDays: number;
  periodDays: number;
  intervalCount: number;
  defaultDuration: boolean;
  irregular: boolean;
  overdue: boolean;
};
export type PredictionResult = {
  prediction: CyclePrediction | null;
  explanation: string;
};
/** A calendar estimate, not evidence of ovulation or a contraceptive method.
 * Only predict the next cycle from observed starts. Never roll a missed period forward.
 * UTC arithmetic prevents DST/local-time changes from shifting calendar dates.
 */
export function predictCycle(
  records: Period[],
  asOf: string,
): PredictionResult {
  const history = [...records]
    .filter((p) => p.start_date <= asOf)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  if (!history.length)
    return {
      prediction: null,
      explanation: "마법 시작일을 기록하면 예정일을 볼 수 있어요.",
    };
  const latest = history[0];
  const intervals = history
    .slice(0, 6)
    .flatMap((p, i) =>
      history[i + 1]
        ? [dayNumber(p.start_date) - dayNumber(history[i + 1].start_date)]
        : [],
    );
  if (intervals.some((n) => !Number.isFinite(n) || n < 15 || n > 90))
    return {
      prediction: null,
      explanation:
        "기록 간격이 크게 다르거나 누락되어 예측을 표시하지 않아요. 시작일을 확인해 주세요.",
    };
  const cycleDays = intervals.length ? average(intervals) : 28;
  const durations = history
    .slice(0, 6)
    .filter((p) => p.end_date && p.end_date <= asOf)
    .map((p) => dayNumber(p.end_date!) - dayNumber(p.start_date) + 1)
    .filter((n) => n >= 1 && n <= 14);
  const periodDays = durations.length ? average(durations) : 5;
  const nextStart = addDays(latest.start_date, cycleDays);
  if (
    (!latest.end_date &&
      dayNumber(asOf) - dayNumber(latest.start_date) >= 14) ||
    (latest.end_date && latest.end_date >= nextStart)
  )
    return {
      prediction: null,
      explanation:
        "진행 중인 기간 또는 종료일을 확인하면 예정일을 다시 계산해요.",
    };
  const ovulation = addDays(nextStart, -14);
  const irregular =
    intervals.length > 1 && Math.max(...intervals) - Math.min(...intervals) > 7;
  return {
    prediction: {
      nextStart,
      nextEnd: addDays(nextStart, periodDays - 1),
      ovulation,
      fertileStart: addDays(ovulation, -5),
      fertileEnd: addDays(ovulation, 1),
      cycleDays,
      periodDays,
      intervalCount: intervals.length,
      defaultDuration: !durations.length,
      irregular,
      overdue: nextStart < asOf,
    },
    explanation: intervals.length
      ? `최근 ${intervals.length}개 주기 평균 ${cycleDays}일 기준`
      : "기록이 1개라 기본 28일 주기로 임시 계산했어요.",
  };
}
export type CycleMark = "period" | "fertile" | "ovulation" | "expected" | null;
export function cycleMark(
  date: string,
  records: Period[],
  prediction: CyclePrediction | null,
  asOf: string,
): CycleMark {
  if (records.some((p) => p.start_date <= date && date <= (p.end_date ?? asOf)))
    return "period";
  if (!prediction) return null;
  if (date >= prediction.nextStart && date <= prediction.nextEnd)
    return "expected";
  if (date === prediction.ovulation) return "ovulation";
  if (date >= prediction.fertileStart && date <= prediction.fertileEnd)
    return "fertile";
  return null;
}
