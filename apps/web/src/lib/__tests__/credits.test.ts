import { describe, it, expect } from "vitest";
import {
  calculateCredits,
  formatCreditsUsed,
  hasEnough,
  isZero,
  type ReservationCredits,
} from "@/lib/credits";

// These tests cover the pure-logic surface of src/lib/credits.ts. The
// async path (tryConsumeCredits) hits the database and is exercised by
// the integration suite in a later batch.

const ZERO: ReservationCredits = {
  daycare_full_day: 0,
  daycare_half_day: 0,
  boarding_nights: 0,
};

function res(opts: {
  module?: string | null;
  duration_type?: string | null;
  start_at?: string;
  end_at?: string;
  checked_in_at?: string | null;
}) {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    start_at: opts.start_at ?? "2026-04-26T14:00:00Z",
    end_at: opts.end_at ?? "2026-04-26T22:00:00Z",
    checked_in_at: opts.checked_in_at ?? null,
    primary_owner_id: null,
    services: opts.module
      ? { module: opts.module, duration_type: opts.duration_type ?? null }
      : null,
  };
}

describe("calculateCredits", () => {
  describe("daycare", () => {
    it("full_day returns one full-day credit", () => {
      const c = calculateCredits(res({ module: "daycare", duration_type: "full_day" }));
      expect(c).toEqual({ ...ZERO, daycare_full_day: 1 });
    });

    it("half_day with no check-in returns one half-day credit", () => {
      const c = calculateCredits(res({ module: "daycare", duration_type: "half_day" }));
      expect(c).toEqual({ ...ZERO, daycare_half_day: 1 });
    });

    it("half_day with a stay under 5 hours stays a half-day credit", () => {
      const checkIn = "2026-04-26T14:00:00Z";
      const now = new Date("2026-04-26T18:00:00Z"); // 4 hours later
      const c = calculateCredits(
        res({ module: "daycare", duration_type: "half_day", checked_in_at: checkIn }),
        now,
      );
      expect(c).toEqual({ ...ZERO, daycare_half_day: 1 });
    });

    it("half_day with a stay over 5 hours converts to a full-day credit", () => {
      const checkIn = "2026-04-26T14:00:00Z";
      const now = new Date("2026-04-26T20:00:00Z"); // 6 hours later
      const c = calculateCredits(
        res({ module: "daycare", duration_type: "half_day", checked_in_at: checkIn }),
        now,
      );
      expect(c).toEqual({ ...ZERO, daycare_full_day: 1 });
    });

    it("half_day at exactly 5 hours stays a half-day credit (boundary uses strict greater than)", () => {
      const checkIn = "2026-04-26T14:00:00Z";
      const now = new Date("2026-04-26T19:00:00Z"); // exactly 5 hours
      const c = calculateCredits(
        res({ module: "daycare", duration_type: "half_day", checked_in_at: checkIn }),
        now,
      );
      expect(c).toEqual({ ...ZERO, daycare_half_day: 1 });
    });

    it("unknown duration_type defaults to full-day credit", () => {
      const c = calculateCredits(res({ module: "daycare", duration_type: null }));
      expect(c).toEqual({ ...ZERO, daycare_full_day: 1 });
    });
  });

  describe("boarding", () => {
    it("single overnight returns 1 night", () => {
      const c = calculateCredits(
        res({
          module: "boarding",
          start_at: "2026-04-25T22:00:00Z",
          end_at: "2026-04-26T16:00:00Z",
        }),
        new Date("2026-04-26T16:00:00Z"),
      );
      expect(c).toEqual({ ...ZERO, boarding_nights: 1 });
    });

    it("multi-night returns the correct night count by midnights crossed", () => {
      const c = calculateCredits(
        res({
          module: "boarding",
          start_at: "2026-04-23T22:00:00Z",
          end_at: "2026-04-27T16:00:00Z",
        }),
        new Date("2026-04-27T16:00:00Z"),
      );
      expect(c).toEqual({ ...ZERO, boarding_nights: 4 });
    });

    it("counts at least 1 night even if the stay was inside one calendar day", () => {
      const c = calculateCredits(
        res({
          module: "boarding",
          start_at: "2026-04-26T08:00:00Z",
          end_at: "2026-04-26T20:00:00Z",
        }),
        new Date("2026-04-26T20:00:00Z"),
      );
      expect(c).toEqual({ ...ZERO, boarding_nights: 1 });
    });

    it("uses checked_in_at over scheduled start when available", () => {
      // Scheduled start is two days ago, but actual check-in was today, so the
      // night count should reflect the actual stay, not the booking window.
      const c = calculateCredits(
        res({
          module: "boarding",
          start_at: "2026-04-24T22:00:00Z",
          end_at: "2026-04-26T16:00:00Z",
          checked_in_at: "2026-04-26T08:00:00Z",
        }),
        new Date("2026-04-26T16:00:00Z"),
      );
      expect(c).toEqual({ ...ZERO, boarding_nights: 1 });
    });
  });

  describe("services that do not consume credits", () => {
    it("grooming returns zero", () => {
      const c = calculateCredits(res({ module: "grooming", duration_type: "hourly" }));
      expect(c).toEqual(ZERO);
    });

    it("training returns zero", () => {
      const c = calculateCredits(res({ module: "training", duration_type: "hourly" }));
      expect(c).toEqual(ZERO);
    });

    it("retail returns zero", () => {
      const c = calculateCredits(res({ module: "retail" }));
      expect(c).toEqual(ZERO);
    });

    it("missing service returns zero", () => {
      const c = calculateCredits(res({ module: null }));
      expect(c).toEqual(ZERO);
    });
  });
});

describe("isZero", () => {
  it("recognizes the zero record", () => {
    expect(isZero(ZERO)).toBe(true);
  });

  it("returns false when any bucket is non-zero", () => {
    expect(isZero({ ...ZERO, daycare_full_day: 1 })).toBe(false);
    expect(isZero({ ...ZERO, daycare_half_day: 1 })).toBe(false);
    expect(isZero({ ...ZERO, boarding_nights: 1 })).toBe(false);
  });
});

describe("hasEnough", () => {
  const balance = {
    id: "owner-test",
    daycare_full_day_credits: 5,
    daycare_half_day_credits: 3,
    boarding_night_credits: 7,
  };

  it("passes when every needed bucket is covered", () => {
    expect(hasEnough({ daycare_full_day: 2, daycare_half_day: 1, boarding_nights: 4 }, balance))
      .toBe(true);
  });

  it("passes at exact equality", () => {
    expect(hasEnough({ daycare_full_day: 5, daycare_half_day: 3, boarding_nights: 7 }, balance))
      .toBe(true);
  });

  it("fails when full-day bucket is short", () => {
    expect(hasEnough({ daycare_full_day: 6, daycare_half_day: 0, boarding_nights: 0 }, balance))
      .toBe(false);
  });

  it("fails when half-day bucket is short", () => {
    expect(hasEnough({ daycare_full_day: 0, daycare_half_day: 4, boarding_nights: 0 }, balance))
      .toBe(false);
  });

  it("fails when nights bucket is short", () => {
    expect(hasEnough({ daycare_full_day: 0, daycare_half_day: 0, boarding_nights: 8 }, balance))
      .toBe(false);
  });
});

describe("formatCreditsUsed", () => {
  it("renders a single bucket with correct pluralization", () => {
    expect(formatCreditsUsed({ ...ZERO, daycare_full_day: 1 })).toBe("1 full day");
    expect(formatCreditsUsed({ ...ZERO, daycare_full_day: 2 })).toBe("2 full days");
    expect(formatCreditsUsed({ ...ZERO, daycare_half_day: 1 })).toBe("1 half day");
    expect(formatCreditsUsed({ ...ZERO, daycare_half_day: 2 })).toBe("2 half days");
    expect(formatCreditsUsed({ ...ZERO, boarding_nights: 1 })).toBe("1 night");
    expect(formatCreditsUsed({ ...ZERO, boarding_nights: 3 })).toBe("3 nights");
  });

  it("joins multiple buckets with plus", () => {
    expect(
      formatCreditsUsed({ daycare_full_day: 1, daycare_half_day: 0, boarding_nights: 2 }),
    ).toBe("1 full day + 2 nights");
  });

  it("returns an empty string for the zero record", () => {
    expect(formatCreditsUsed(ZERO)).toBe("");
  });
});
