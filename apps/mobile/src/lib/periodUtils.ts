export type PeriodRange = {
  id: string;
  start_date: string;
  end_date: string | null;
};

const OPEN_END = "9999-12-31";

/** Date-only ranges are inclusive; a null end date represents an ongoing range. */
export function findPeriodOverlap(
  periods: readonly PeriodRange[],
  startDate: string,
  endDate: string | null,
  excludeId?: string,
): PeriodRange | undefined {
  const candidateEnd = endDate ?? OPEN_END;
  return periods.find((period) =>
    period.id !== excludeId &&
    startDate <= (period.end_date ?? OPEN_END) &&
    period.start_date <= candidateEnd,
  );
}
