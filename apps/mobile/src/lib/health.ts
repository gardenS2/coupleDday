import { db } from "./supabase";
import { findPeriodOverlap } from "./periodUtils";
export type Daily = {
  id: string;
  couple_id: string;
  log_date: string;
  symptoms: string[];
  mood: string | null;
  memo: string;
  version: number;
  updated_by: string | null;
};
export type Period = {
  id: string;
  couple_id: string;
  start_date: string;
  end_date: string | null;
  version: number;
};
export const symptoms = [
  "복통",
  "두통",
  "요통",
  "피곤",
  "여드름",
  "붓기",
  "예민함",
  "식욕 증가",
];
export const moods = ["좋아요", "평온해요", "울적해요", "예민해요"];
export const today = () =>
  new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export async function loadHealth(couple: string, month: string) {
  const first = month + "-01";
  const last = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  )
    .toISOString()
    .slice(0, 10);
  const [daily, periods, history] = await Promise.all([
    db()
      .from("cycle_daily_logs")
      .select("*")
      .eq("couple_id", couple)
      .gte("log_date", first)
      .lte("log_date", last)
      .order("log_date"),
    db()
      .from("cycle_records")
      .select("*")
      .eq("couple_id", couple)
      .lte("start_date", last)
      .or(`end_date.is.null,end_date.gte.${first}`)
      .order("start_date", { ascending: false }),
    db()
      .from("cycle_records")
      .select("*")
      .eq("couple_id", couple)
      .lte("start_date", today())
      .order("start_date", { ascending: false })
  ]);
  if (history.error) throw history.error;
  if (daily.error) throw daily.error;
  if (periods.error) throw periods.error;
  return {
    daily: daily.data as Daily[],
    periods: periods.data as Period[],
    history: history.data as Period[],
  };
}
export async function saveDaily(
  couple: string,
  date: string,
  values: Pick<Daily, "symptoms" | "mood" | "memo">,
  existing?: Daily,
) {
  const query = existing
    ? db()
        .from("cycle_daily_logs")
        .update(values)
        .eq("id", existing.id)
        .eq("version", existing.version)
    : db()
        .from("cycle_daily_logs")
        .insert({ couple_id: couple, log_date: date, ...values });
  const result = await query.select("id");
  if (result.error) throw result.error;
  if (!result.data.length) throw new Error("conflict");
}
export async function removeHealth(
  table: "cycle_daily_logs" | "cycle_records",
  id: string,
  version: number,
) {
  const result = await db()
    .from(table)
    .delete()
    .eq("id", id)
    .eq("version", version)
    .select("id");
  if (result.error) throw result.error;
  if (!result.data.length) throw new Error("conflict");
}
export async function savePeriod(
  couple: string,
  start: string,
  end: string | null,
  existing?: Period,
) {
  if (!validDate(start) || (end && (!validDate(end) || end < start)))
    throw new Error("invalid date");
  const existingPeriods = await db()
    .from("cycle_records")
    .select("id,start_date,end_date")
    .eq("couple_id", couple);
  if (existingPeriods.error) throw existingPeriods.error;
  if (findPeriodOverlap(existingPeriods.data, start, end, existing?.id))
    throw new Error("period_overlap");
  const query = existing
    ? db()
        .from("cycle_records")
        .update({ start_date: start, end_date: end })
        .eq("id", existing.id)
        .eq("version", existing.version)
    : db()
        .from("cycle_records")
        .insert({ couple_id: couple, start_date: start, end_date: end });
  const result = await query.select("id");
  if (result.error) throw result.error;
  if (!result.data.length) throw new Error("conflict");
}
