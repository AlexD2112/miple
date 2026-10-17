import * as Calendar from "expo-calendar";
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
 * Finds the first free gap in each lunch/dinner window over the next `days` days.
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
      busy = events
        .filter((e) => !e.allDay && e.availability !== Calendar.Availability.FREE)
        .map((e) => ({ start: new Date(e.startDate).getTime(), end: new Date(e.endDate).getTime() }))
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
        ? firstGap(from, end.getTime(), busy)
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

function firstGap(from: number, to: number, busy: { start: number; end: number }[]) {
  let cursor = from;
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start >= to) break;
    if (b.start - cursor >= MIN_MINUTES * 60_000) return { start: cursor, end: b.start };
    cursor = Math.max(cursor, b.end);
  }
  return to - cursor >= MIN_MINUTES * 60_000 ? { start: cursor, end: to } : null;
}

const roundUpToQuarter = (t: number) => Math.ceil(t / (15 * 60_000)) * 15 * 60_000;

/** "Add to calendar": writes the cooking block and returns the event id. */
export async function addMealToCalendar(title: string, start: Date, end: Date, notes: string): Promise<string | null> {
  const { granted } = await Calendar.requestCalendarPermissions();
  if (!granted) return null;

  const calendar =
    Platform.OS === "ios"
      ? Calendar.getDefaultCalendarSync()
      : (await Calendar.getCalendars()).find((c) => c.allowsModifications && c.isPrimary) ??
        (await Calendar.getCalendars()).find((c) => c.allowsModifications);
  if (!calendar) return null;

  const event = await calendar.createEvent({
    title: `🍳 ${title}`,
    startDate: start,
    endDate: end,
    notes,
    alarms: [{ relativeOffset: -15 }],
  });
  return event.id;
}
