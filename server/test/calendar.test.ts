import { describe, expect, it } from "vitest";
import {
  bookingWindow,
  businessDaysBetween,
  deskDayStartUtc,
  federalHolidays,
  federalHolidaysNamed,
  holidayName,
  holidaysBetween,
  isBusinessDay,
  nextBusinessDay,
  rollToBusinessDay,
  toIsoDate,
} from "../src/lib/calendar.js";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * Every weekday on which Treasury published no curve, read off the live feed.
 * This is ground truth for the trading calendar, not a guess.
 */
const SKIPPED_WEEKDAYS: Record<number, { from: string; through: string; dates: string[] }> = {
  2024: {
    from: "2024-01-02",
    through: "2024-12-31",
    dates: [
      "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19", "2024-07-04",
      "2024-09-02", "2024-10-14", "2024-11-11", "2024-11-28", "2024-12-25",
    ],
  },
  2025: {
    from: "2025-01-02",
    through: "2025-12-31",
    dates: [
      "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04",
      "2025-09-01", "2025-10-13", "2025-11-11", "2025-11-27", "2025-12-25",
    ],
  },
  2026: {
    from: "2026-01-02",
    through: "2026-09-03",
    dates: ["2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03"],
  },
};

/** Skipped in 2024 and 2025, but Treasury published on Good Friday 2026. */
const GOOD_FRIDAY = new Set(["2024-03-29", "2025-04-18"]);

describe("federal holiday calendar vs. what Treasury actually published", () => {
  for (const [year, { from, through, dates }] of Object.entries(SKIPPED_WEEKDAYS)) {
    const holidays = federalHolidays(Number(year));

    it(`${year}: every weekday Treasury skipped is a modelled holiday (Good Friday aside)`, () => {
      const unexplained = dates.filter((x) => !holidays.has(x) && !GOOD_FRIDAY.has(x));
      expect(unexplained).toEqual([]);
    });

    it(`${year}: every modelled weekday holiday is one Treasury actually skipped`, () => {
      const published = new Set(dates);
      const spurious = [...holidays]
        .filter((x) => x >= from && x <= through)
        .filter((x) => {
          const day = d(x).getUTCDay();
          return day !== 0 && day !== 6; // weekend holidays are unobservable
        })
        .filter((x) => !published.has(x));
      expect(spurious).toEqual([]);
    });
  }

  it("does not model Good Friday, because the source is inconsistent about it", () => {
    // Skipped in 2024/2025, published in 2026 — so it is left out deliberately.
    expect(isBusinessDay(d("2024-03-29"))).toBe(true);
    expect(isBusinessDay(d("2026-04-03"))).toBe(true);
  });
});

describe("weekend observation rules", () => {
  it("moves a Saturday holiday to the Friday before", () => {
    // July 4 2026 is a Saturday; Treasury skipped Friday July 3.
    expect(federalHolidays(2026).has("2026-07-03")).toBe(true);
    expect(isBusinessDay(d("2026-07-03"))).toBe(false);
  });

  it("moves a Sunday holiday to the Monday after", () => {
    // June 19 2022 was a Sunday, observed Monday June 20.
    expect(federalHolidays(2022).has("2022-06-20")).toBe(true);
  });

  it("observes a Saturday New Year's Day on December 31 of the prior year", () => {
    // Jan 1 2022 was a Saturday.
    expect(federalHolidays(2021).has("2021-12-31")).toBe(true);
  });
});

describe("nextBusinessDay", () => {
  it("is the following day midweek", () => {
    expect(toIsoDate(nextBusinessDay(d("2026-09-03")))).toBe("2026-09-04");
  });

  it("skips the weekend", () => {
    expect(toIsoDate(nextBusinessDay(d("2026-09-11")))).toBe("2026-09-14");
  });

  it("skips a weekend and the holiday immediately behind it", () => {
    // Mon 2026-09-07 is Labor Day, so Friday settles on the Tuesday.
    expect(toIsoDate(nextBusinessDay(d("2026-09-04")))).toBe("2026-09-08");
  });

  it("skips a holiday and the weekend behind it", () => {
    // Fri Jul 3 2026 is the observed Independence Day, so Thu Jul 2 settles Mon Jul 6.
    expect(toIsoDate(nextBusinessDay(d("2026-07-02")))).toBe("2026-07-06");
  });

  it("skips Thanksgiving", () => {
    expect(toIsoDate(nextBusinessDay(d("2025-11-26")))).toBe("2025-11-28");
  });
});

describe("rollToBusinessDay", () => {
  it("leaves a business day alone", () => {
    expect(toIsoDate(rollToBusinessDay(d("2026-09-03")))).toBe("2026-09-03");
  });

  it("rolls a weekend maturity forward", () => {
    expect(toIsoDate(rollToBusinessDay(d("2026-09-12")))).toBe("2026-09-14");
  });

  it("rolls past a holiday that follows the weekend", () => {
    expect(toIsoDate(rollToBusinessDay(d("2026-09-05")))).toBe("2026-09-08");
  });

  it("rolls a Christmas maturity forward", () => {
    expect(toIsoDate(rollToBusinessDay(d("2026-12-25")))).toBe("2026-12-28");
  });
});

describe("booking window", () => {
  // 2026-09-04 is a Friday; EDT is UTC-4. Cutoff defaults to 3:00 PM ET.
  it("books same day before the cutoff", () => {
    const w = bookingWindow(new Date("2026-09-04T18:00:00Z")); // 2:00 PM ET
    expect(w).toMatchObject({ deskDate: "2026-09-04", bookingDate: "2026-09-04", reason: "open" });
  });

  it("rolls to the next business day after the cutoff", () => {
    // 4:00 PM ET Friday. Monday 2026-09-07 is Labor Day, so it books Tuesday.
    const w = bookingWindow(new Date("2026-09-04T20:00:00Z"));
    expect(w).toMatchObject({
      deskDate: "2026-09-04",
      bookingDate: "2026-09-08",
      reason: "after-cutoff",
    });
  });

  it("reports a weekend as closed, not as a passed cutoff", () => {
    // 1:30 PM ET Saturday — well before 3pm, but there is no cutoff on a
    // Saturday. Saying "past today's cutoff" here would be wrong twice over.
    const w = bookingWindow(new Date("2026-09-05T17:30:00Z"));
    expect(w).toMatchObject({
      deskDate: "2026-09-05",
      bookingDate: "2026-09-08",
      reason: "market-closed",
    });
  });

  it("reports a market holiday as closed even in the morning", () => {
    // Labor Day, 10:00 AM ET.
    const w = bookingWindow(new Date("2026-09-07T14:00:00Z"));
    expect(w).toMatchObject({
      deskDate: "2026-09-07",
      bookingDate: "2026-09-08",
      reason: "market-closed",
    });
  });

  it("still reports after-cutoff on a business day even when the next day is a holiday", () => {
    // Friday 4pm before Labor Day weekend: the cutoff is the reason, not closure.
    expect(bookingWindow(new Date("2026-09-04T20:00:00Z")).reason).toBe("after-cutoff");
  });

  it("labels the cutoff in the desk timezone", () => {
    expect(bookingWindow(new Date("2026-09-04T18:00:00Z")).cutoffLabel).toBe("3:00 PM EDT");
    // Same wall-clock cutoff, standard time in January.
    expect(bookingWindow(new Date("2026-01-14T18:00:00Z")).cutoffLabel).toBe("3:00 PM EST");
  });
});

describe("deskDayStartUtc", () => {
  it("resolves midnight at the desk to the right UTC instant", () => {
    // Midnight ET on 2026-09-04 during EDT is 04:00Z.
    expect(deskDayStartUtc("2026-09-04").toISOString()).toBe("2026-09-04T04:00:00.000Z");
  });

  it("accounts for standard time", () => {
    expect(deskDayStartUtc("2026-01-14").toISOString()).toBe("2026-01-14T05:00:00.000Z");
  });
});

describe("businessDaysBetween", () => {
  it("counts one for consecutive business days", () => {
    expect(businessDaysBetween("2026-09-03", "2026-09-04")).toBe(1);
  });

  it("treats a weekend as no distance", () => {
    expect(businessDaysBetween("2026-09-11", "2026-09-14")).toBe(1);
  });

  it("counts two across a skipped day", () => {
    expect(businessDaysBetween("2026-09-02", "2026-09-04")).toBe(2);
  });
});

describe("holiday names", () => {
  it("returns the name of a holiday by date", () => {
    expect(holidayName("2026-09-07")).toBe("Labor Day");
  });

  it("returns null for non-holiday dates", () => {
    expect(holidayName("2026-09-08")).toBe(null);
  });

  it("returns the name for an observed holiday", () => {
    // July 4 2026 is a Saturday, observed Friday July 3
    expect(holidayName("2026-07-03")).toBe("Independence Day");
  });

  it("federalHolidaysNamed returns exactly 11 holidays in 2026", () => {
    const holidays = federalHolidaysNamed(2026);
    expect(holidays).toHaveLength(11);
  });

  it("federalHolidaysNamed has unique dates", () => {
    const holidays = federalHolidaysNamed(2026);
    const dates = holidays.map((h) => h.date);
    const uniqueDates = new Set(dates);
    expect(uniqueDates.size).toBe(dates.length);
  });
});

describe("holidaysBetween", () => {
  it("returns holidays strictly after from and up to and including to", () => {
    const holidays = holidaysBetween("2026-09-04", "2026-09-08");
    expect(holidays).toHaveLength(1);
    expect(holidays[0]).toEqual({ date: "2026-09-07", name: "Labor Day" });
  });

  it("returns empty when there are no holidays in the range", () => {
    const holidays = holidaysBetween("2026-09-08", "2026-09-09");
    expect(holidays).toEqual([]);
  });
});

describe("booking window with skipped holidays", () => {
  it("includes Labor Day when booking from Saturday", () => {
    // Saturday 1:30 PM ET — books on the following Tuesday because of Labor Day on Monday
    const w = bookingWindow(new Date("2026-09-05T17:30:00Z"));
    expect(w.skippedHolidays).toHaveLength(1);
    expect(w.skippedHolidays[0]).toEqual({
      date: "2026-09-07",
      name: "Labor Day",
    });
  });

  it("has empty skipped holidays when booking same day before cutoff", () => {
    // Friday 2 PM ET, before cutoff — books same day
    const w = bookingWindow(new Date("2026-09-04T18:00:00Z"));
    expect(w.skippedHolidays).toEqual([]);
  });
});
