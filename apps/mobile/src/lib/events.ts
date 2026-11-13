import { db } from "./supabase";
import { monthRange, validateEventDraft } from "./eventUtils";
import type { EventDraft, EventType } from "./eventUtils";
import type { IconName } from "../components/AppIcon";

export type { EventDraft, EventType } from "./eventUtils";
export type CoupleEvent = {
  id: string;
  couple_id: string;
  title: string;
  event_date: string;
  end_date: string | null;
  event_type: EventType;
  icon_key: IconName | null;
  is_yearly: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};
export async function loadEventsForMonth(coupleId: string, month: string) {
  const { firstDate, lastDate } = monthRange(month);
  const result = await db()
    .from("couple_events")
    .select("*")
    .eq("couple_id", coupleId)
    .lte("event_date", lastDate)
    .or(`event_date.gte.${firstDate},end_date.gte.${firstDate},is_yearly.eq.true`)
    .order("event_date", { ascending: true })
    .order("id", { ascending: true });
  if (result.error) throw result.error;
  return result.data as CoupleEvent[];
}

export async function loadUpcomingEvents(coupleId: string, today: string) {
  const result = await db()
    .from("couple_events")
    .select("*")
    .eq("couple_id", coupleId)
    .order("event_date", { ascending: true })
    .order("id", { ascending: true })
  if (result.error) throw result.error;
  return result.data as CoupleEvent[];
}

export async function createEvent(coupleId: string, draft: EventDraft) {
  const input = validateEventDraft(draft);
  const payload = {
    couple_id: coupleId,
    title: input.title,
    event_date: input.event_date,
    end_date: input.end_date ?? null,
    event_type: input.event_type,
    icon_key: input.icon_key,
    ...(input.is_yearly ? { is_yearly: true } : {}),
  };
  const result = await db()
    .from("couple_events")
    .insert(payload)
    .select("*")
    .single();
  if (result.error) throw result.error;
  return result.data as CoupleEvent;
}

export async function updateEvent(
  coupleId: string,
  event: CoupleEvent,
  draft: EventDraft,
) {
  const input = validateEventDraft(draft);
  const payload = {
    title: input.title,
    event_date: input.event_date,
    end_date: input.end_date ?? null,
    event_type: input.event_type,
    icon_key: input.icon_key,
    ...(input.is_yearly || event.is_yearly ? { is_yearly: input.is_yearly } : {}),
  };
  const result = await db()
    .from("couple_events")
    .update(payload)
    .eq("id", event.id)
    .eq("couple_id", coupleId)
    .eq("version", event.version)
    .select("*")
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("conflict");
  return result.data as CoupleEvent;
}

export async function deleteEvent(coupleId: string, event: CoupleEvent) {
  const result = await db()
    .from("couple_events")
    .delete()
    .eq("id", event.id)
    .eq("couple_id", coupleId)
    .eq("version", event.version)
    .select("id");
  if (result.error) throw result.error;
  if (!result.data.length) throw new Error("conflict");
}
