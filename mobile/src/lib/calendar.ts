import * as Calendar from "expo-calendar";
import * as LegacyCalendar from "expo-calendar/legacy";
import { Platform } from "react-native";

export interface FreeWindow {
  start: Date;
  end: Date;
  minutes: number;
  meal: "lunch" | "dinner";
}

// When people are willing to cook. Times are local.
const MEAL_WINDOWS = [
  { meal: "lunch" as const, start: [11, 30], end: [14, 0] },
  { meal: "dinner" as const, start: [17, 30], end: [21, 0] },
];
const MIN_MINUTES = 20;
const MAX_MINUTES = 60;
const FALLBACK_MINUTES = 40;

async function canReadCalendar(): Promise<boolean> {
  const current = await Calendar.getCalendarPermissions();
  if (current.granted) return true;
  return (await Calendar.requestCalendarPermissions()).granted;
}

/**
 * Finds a free gap in each lunch/dinner window over the next `days` days: the first one of at least an hour,
 * otherwise the longest (so a 20-minute squeeze before a meeting doesn't beat a free hour later).
 * Without calendar access, every window is treated as free (so the planner still works).
 */
export async function findFreeMealWindows(days = 3, now = new Date()): Promise<FreeWindow[]> {
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() + days);

  let busy: { start: number; end: number }[] = [];
  let hasCalendar = false;
  try {
    if (await canReadCalendar()) {
      const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
      const events = await Calendar.listEvents(calendars, now, rangeEnd);
      // Busy all-day events (trips, conferences) block meals; ones marked free (holidays, birthdays) don't.
      busy = events
        .filter((e) => e.availability !== Calendar.Availability.FREE)
        .map((e) => ({ start: eventTime(e.startDate, e.allDay), end: eventTime(e.endDate, e.allDay) }))
        .sort((a, b) => a.start - b.start);
      hasCalendar = true;
    }
  } catch (err) {
    console.warn("[calendar] read failed, assuming free", err);
  }

  const windows: FreeWindow[] = [];
  for (let d = 0; d < days; d++) {
    for (const w of MEAL_WINDOWS) {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, w.start[0], w.start[1]);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, w.end[0], w.end[1]);
      const from = Math.max(start.getTime(), roundUpToQuarter(now.getTime()));
      if (end.getTime() - from < MIN_MINUTES * 60_000) continue;

      const gap = hasCalendar
        ? bestGap(from, end.getTime(), busy)
        : { start: from, end: Math.min(end.getTime(), from + FALLBACK_MINUTES * 60_000) };
      if (!gap) continue;

      const minutes = Math.min(MAX_MINUTES, Math.floor((gap.end - gap.start) / 60_000));
      windows.push({
        start: new Date(gap.start),
        end: new Date(gap.start + minutes * 60_000),
        minutes,
        meal: w.meal,
      });
    }
  }
  return windows;
}

function bestGap(from: number, to: number, busy: { start: number; end: number }[]) {
  const gaps: { start: number; end: number }[] = [];
  let cursor = from;
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start >= to) break;
    if (b.start - cursor >= MIN_MINUTES * 60_000) gaps.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (to - cursor >= MIN_MINUTES * 60_000) gaps.push({ start: cursor, end: to });
  const roomy = gaps.find((g) => g.end - g.start >= MAX_MINUTES * 60_000);
  if (roomy) return roomy;
  return gaps.reduce<{ start: number; end: number } | null>(
    (best, g) => (!best || g.end - g.start > best.end - best.start ? g : best),
    null,
  );
}

/** Android stores all-day events at UTC midnight; move them to local midnight so they cover the right day. */
function eventTime(value: string | Date, allDay: boolean): number {
  const d = new Date(value);
  if (!allDay || Platform.OS !== "android") return d.getTime();
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
}

const roundUpToQuarter = (t: number) => Math.ceil(t / (15 * 60_000)) * 15 * 60_000;

async function writableCalendarId(): Promise<string | null> {
  const { granted } = await Calendar.requestCalendarPermissions();
  if (!granted) return null;
  if (Platform.OS === "ios") return Calendar.getDefaultCalendarSync()?.id ?? null;
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  return (
    calendars.find((c) => c.allowsModifications && c.isPrimary)?.id ??
    calendars.find((c) => c.allowsModifications)?.id ??
    null
  );
}

/** Creates or updates an event. A stale id falls through to create. */
export async function upsertCalendarEvent(
  existingId: string | null,
  details: { title: string; start: Date; end: Date; notes: string; alarmMinutes: number },
): Promise<string | null> {
  const calendarId = await writableCalendarId();
  if (!calendarId) return null;
  const event = {
    title: details.title,
    startDate: details.start,
    endDate: details.end,
    notes: details.notes,
    alarms: [{ relativeOffset: -details.alarmMinutes }],
  };
  if (existingId) {
    try {
      await LegacyCalendar.updateEventAsync(existingId, event);
      return existingId;
    } catch (err) {
      console.warn("[calendar] update failed, creating a new event", err);
    }
  }
  return LegacyCalendar.createEventAsync(calendarId, event);
}

/** Writes the cooking block and returns the event id. */
export async function addMealToCalendar(
  title: string,
  start: Date,
  end: Date,
  notes: string,
  existingId: string | null = null,
): Promise<string | null> {
  return upsertCalendarEvent(existingId, { title: `🍳 ${title}`, start, end, notes, alarmMinutes: 15 });
}

/** A shopping block before the meal. */
export async function addShoppingToCalendar(
  mealTitle: string,
  start: Date,
  items: string[],
  existingId: string | null = null,
): Promise<string | null> {
  const end = new Date(start.getTime() + 45 * 60_000);
  return upsertCalendarEvent(existingId, {
    title: `🛒 Shop for ${mealTitle}`,
    start,
    end,
    notes: items.map((item) => `• ${item}`).join("\n"),
    alarmMinutes: 30,
  });
}

/** When the model doesn't name a time, shop two hours before the meal, or the previous morning. */
export function defaultShoppingTime(mealStart: Date, now = new Date()): Date {
  const twoHoursBefore = new Date(mealStart.getTime() - 2 * 60 * 60 * 1000);
  if (twoHoursBefore.getTime() > now.getTime() + 30 * 60_000) return twoHoursBefore;
  const morning = new Date(mealStart);
  morning.setDate(morning.getDate() - 1);
  morning.setHours(10, 0, 0, 0);
  if (morning.getTime() > now.getTime() + 30 * 60_000) return morning;
  return new Date(now.getTime() + 30 * 60_000);
}
