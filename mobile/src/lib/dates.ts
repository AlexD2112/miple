const DAY = 24 * 60 * 60 * 1000;

/** Local calendar date as YYYY-MM-DD. */
export function localIsoDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Whole days from today until an ISO date (negative if past). */
export function daysUntil(isoDate: string, now = new Date()): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / DAY);
}

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return localIsoDate(new Date(y, m - 1, d + days));
}

export function startOfWeek(now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = (d.getDay() + 6) % 7; // Monday
  d.setDate(d.getDate() - offset);
  return d;
}

export function expiryLabel(isoDate: string): string {
  const n = daysUntil(isoDate);
  if (n < 0) return "expired";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return `${n} days`;
}

export function timeRange(startIso: string, endIso: string): string {
  const fmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const start = new Date(startIso);
  const day = start.toLocaleDateString(undefined, { weekday: "short" });
  return `${day} ${start.toLocaleTimeString(undefined, fmt)}–${new Date(endIso).toLocaleTimeString(undefined, fmt)}`;
}
