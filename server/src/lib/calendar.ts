/**
 * US settlement calendar.
 *
 * Treasury securities settle regular-way T+1, so booking an order means
 * knowing the next business day. Derived from the eleven US federal holidays
 * with the standard weekend-observation rules.
 *
 * This was checked against the feed rather than assumed: every weekday
 * Treasury skipped in 2024, 2025 and 2026-to-date is a federal holiday under
 * these rules. The one divergence is Good Friday — skipped in 2024 and 2025,
 * but Treasury *did* publish a curve on Good Friday 2026 — so it is
 * deliberately not treated as a holiday here. See calendar.test.ts, which
 * pins that behaviour against the real published dates.
 */

const MS_PER_DAY = 86_400_000;

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utc(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** The nth given weekday of a month, e.g. the 3rd Monday of January. */
function nthWeekday(year: number, monthIndex: number, weekday: number, n: number): Date {
  const first = utc(year, monthIndex, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utc(year, monthIndex, 1 + offset + (n - 1) * 7);
}

/** The last given weekday of a month, e.g. the last Monday of May. */
function lastWeekday(year: number, monthIndex: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return utc(year, monthIndex, last.getUTCDate() - offset);
}

/** Saturday holidays are observed the Friday before, Sunday ones the Monday after. */
function observed(date: Date): Date {
  const day = date.getUTCDay();
  if (day === 6) return addDays(date, -1);
  if (day === 0) return addDays(date, 1);
  return date;
}

const MONDAY = 1;
const THURSDAY = 4;
const holidayCache = new Map<number, Set<string>>();
const namedHolidayCache = new Map<number, NamedHoliday[]>();

export interface NamedHoliday {
  date: string;
  name: string;
}

export function federalHolidaysNamed(year: number): NamedHoliday[] {
  const cached = namedHolidayCache.get(year);
  if (cached) return cached;

  const holidays: Array<{ date: Date; name: string }> = [];

  const add = (date: Date, name: string) => {
    if (date.getUTCFullYear() === year) {
      holidays.push({ date, name });
    }
  };

  add(observed(utc(year, 0, 1)), "New Year's Day");
  add(nthWeekday(year, 0, MONDAY, 3), "Martin Luther King Jr. Day");
  add(nthWeekday(year, 1, MONDAY, 3), "Washington's Birthday");
  add(lastWeekday(year, 4, MONDAY), "Memorial Day");
  add(observed(utc(year, 5, 19)), "Juneteenth");
  add(observed(utc(year, 6, 4)), "Independence Day");
  add(nthWeekday(year, 8, MONDAY, 1), "Labor Day");
  add(nthWeekday(year, 9, MONDAY, 2), "Columbus Day");
  add(observed(utc(year, 10, 11)), "Veterans Day");
  add(nthWeekday(year, 10, THURSDAY, 4), "Thanksgiving");
  add(observed(utc(year, 11, 25)), "Christmas Day");
  // Jan 1 falling on a Saturday is observed on Dec 31 of this year.
  add(observed(utc(year + 1, 0, 1)), "New Year's Day");

  const result = holidays.map(({ date, name }) => ({
    date: toIsoDate(date),
    name,
  }));
  namedHolidayCache.set(year, result);
  return result;
}

export function federalHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const holidays = new Set<string>();
  for (const holiday of federalHolidaysNamed(year)) {
    holidays.add(holiday.date);
  }

  holidayCache.set(year, holidays);
  return holidays;
}

export function holidayName(isoDate: string): string | null {
  const year = Number(isoDate.slice(0, 4));
  const holidays = federalHolidaysNamed(year);
  const holiday = holidays.find((h) => h.date === isoDate);
  return holiday?.name ?? null;
}

export function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !federalHolidays(date.getUTCFullYear()).has(toIsoDate(date));
}

/** The next business day strictly after `date` — T+1 settlement. */
export function nextBusinessDay(date: Date): Date {
  let candidate = addDays(date, 1);
  while (!isBusinessDay(candidate)) candidate = addDays(candidate, 1);
  return candidate;
}

/** `date` itself if it is a business day, otherwise the next one (following convention). */
export function rollToBusinessDay(date: Date): Date {
  let candidate = date;
  while (!isBusinessDay(candidate)) candidate = addDays(candidate, 1);
  return candidate;
}

/* ------------------------------------------------------------------ *
 * Booking window
 *
 * Orders placed after the desk's daily cutoff book on the next business
 * day, which moves settlement out with them. The cutoff shifts the date
 * rather than blocking the order: nothing here executes, so there is no
 * window to actually miss.
 * ------------------------------------------------------------------ */

const DESK_TIMEZONE = process.env.DESK_TIMEZONE ?? "America/New_York";
const CUTOFF_HOUR = Number(process.env.CUTOFF_HOUR ?? 15);
const CUTOFF_MINUTE = Number(process.env.CUTOFF_MINUTE ?? 0);

interface DeskClock {
  date: string;
  minutesOfDay: number;
  zoneLabel: string;
}

/** Wall-clock date and time at the desk, for a given instant. */
function deskClock(instant: Date): DeskClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: DESK_TIMEZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
    zoneLabel: parts.timeZoneName ?? "",
  };
}

export function cutoffLabel(instant: Date = new Date()): string {
  const hour12 = CUTOFF_HOUR % 12 === 0 ? 12 : CUTOFF_HOUR % 12;
  const meridiem = CUTOFF_HOUR < 12 ? "AM" : "PM";
  const minute = String(CUTOFF_MINUTE).padStart(2, "0");
  return `${hour12}:${minute} ${meridiem} ${deskClock(instant).zoneLabel}`;
}

/**
 * Why an order books when it does.
 *
 * These are separate facts and must not be collapsed into one boolean: on a
 * Saturday morning the order rolls to Tuesday, but not because a cutoff
 * passed — there is no cutoff on a day the market never opened.
 */
export type BookingReason =
  /** A business day, before the cutoff. Books today. */
  | "open"
  /** A business day, but the cutoff has passed. Rolls to the next one. */
  | "after-cutoff"
  /** Weekend or market holiday. There is no cutoff today at all. */
  | "market-closed";

export function holidaysBetween(fromIso: string, toIso: string): NamedHoliday[] {
  const fromDate = new Date(`${fromIso}T00:00:00Z`);
  const toDate = new Date(`${toIso}T00:00:00Z`);

  // Get years that might have holidays in the range
  const fromYear = fromDate.getUTCFullYear();
  const toYear = toDate.getUTCFullYear();

  const result: NamedHoliday[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    const holidays = federalHolidaysNamed(year);
    for (const holiday of holidays) {
      const holidayDate = new Date(`${holiday.date}T00:00:00Z`);
      // Strictly after fromDate and up to and including toDate
      if (holidayDate > fromDate && holidayDate <= toDate) {
        result.push(holiday);
      }
    }
  }

  // Sort by date
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

export interface BookingWindow {
  /** Today's date at the desk. */
  deskDate: string;
  /** Business date the order actually books on. */
  bookingDate: string;
  reason: BookingReason;
  cutoffLabel: string;
  /** Holidays skipped between today and the booking date. */
  skippedHolidays: NamedHoliday[];
}

export function bookingWindow(instant: Date = new Date()): BookingWindow {
  const clock = deskClock(instant);
  const today = new Date(`${clock.date}T00:00:00Z`);
  const beforeCutoff = clock.minutesOfDay < CUTOFF_HOUR * 60 + CUTOFF_MINUTE;
  const openToday = isBusinessDay(today);

  const reason: BookingReason = !openToday
    ? "market-closed"
    : beforeCutoff
      ? "open"
      : "after-cutoff";

  const bookingDate = reason === "open" ? today : nextBusinessDay(today);
  const skippedHolidays = holidaysBetween(clock.date, toIsoDate(bookingDate));

  return {
    deskDate: clock.date,
    bookingDate: toIsoDate(bookingDate),
    reason,
    cutoffLabel: cutoffLabel(instant),
    skippedHolidays,
  };
}

/** How many business days separate two dates — used for staleness. */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  let count = 0;
  let cursor = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  while (cursor < end) {
    cursor = nextBusinessDay(cursor);
    if (cursor <= end) count += 1;
  }
  return count;
}

/** The UTC instant at which a desk-local day begins. Used for "today's orders". */
export function deskDayStartUtc(deskDate: string): Date {
  const midnightUtc = Date.parse(`${deskDate}T00:00:00Z`);
  // Sweep plausible UTC offsets (including the half-hour zones) and keep the
  // instant that reads as midnight on that date at the desk.
  for (let offsetHours = -14; offsetHours <= 14; offsetHours += 0.5) {
    const candidate = new Date(midnightUtc + offsetHours * 3_600_000);
    const clock = deskClock(candidate);
    if (clock.date === deskDate && clock.minutesOfDay === 0) return candidate;
  }
  return new Date(midnightUtc);
}
