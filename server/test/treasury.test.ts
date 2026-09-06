import { describe, expect, it } from "vitest";
import { parseYieldCurveXml } from "../src/lib/treasury.js";
import { addMonths } from "../src/lib/tenors.js";
import { percentToBps, simpleInterestMinor, unitsToMinor } from "../src/lib/units.js";

/** Two entries: a modern record, and an older one missing 1.5M/4M. */
const FIXTURE = `<?xml version="1.0" encoding="utf-8" standalone="yes" ?>
<feed xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"
      xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"
      xmlns="http://www.w3.org/2005/Atom">
  <entry><content type="application/xml"><m:properties>
    <d:NEW_DATE m:type="Edm.DateTime">2026-09-03T00:00:00</d:NEW_DATE>
    <d:BC_1MONTH m:type="Edm.Double">3.83</d:BC_1MONTH>
    <d:BC_1_5MONTH m:type="Edm.Double">3.82</d:BC_1_5MONTH>
    <d:BC_3MONTH m:type="Edm.Double">3.89</d:BC_3MONTH>
    <d:BC_2YEAR m:type="Edm.Double">4.34</d:BC_2YEAR>
    <d:BC_10YEAR m:type="Edm.Double">4.77</d:BC_10YEAR>
    <d:BC_30YEAR m:type="Edm.Double">5.25</d:BC_30YEAR>
  </m:properties></content></entry>
  <entry><content type="application/xml"><m:properties>
    <d:NEW_DATE m:type="Edm.DateTime">2026-09-02T00:00:00</d:NEW_DATE>
    <d:BC_1MONTH m:type="Edm.Double">3.80</d:BC_1MONTH>
    <d:BC_3MONTH m:type="Edm.Double">3.86</d:BC_3MONTH>
    <d:BC_2YEAR m:type="Edm.Double">4.30</d:BC_2YEAR>
    <d:BC_10YEAR m:type="Edm.Double">4.70</d:BC_10YEAR>
    <d:BC_20YEAR m:type="Edm.Double"></d:BC_20YEAR>
  </m:properties></content></entry>
</feed>`;

describe("parseYieldCurveXml", () => {
  const curves = parseYieldCurveXml(FIXTURE);

  it("returns curves sorted oldest first", () => {
    expect(curves.map((c) => c.asOfDate)).toEqual(["2026-09-02", "2026-09-03"]);
  });

  it("converts percent to integer basis points", () => {
    const tenY = curves[1]!.points.find((p) => p.tenorKey === "10Y");
    expect(tenY).toEqual({ tenorKey: "10Y", yieldBps: 477 });
  });

  it("omits tenors the record does not publish rather than zero-filling", () => {
    const keys = curves[0]!.points.map((p) => p.tenorKey);
    expect(keys).not.toContain("1.5M");
    expect(keys).not.toContain("20Y"); // present but blank
    expect(keys).toEqual(["1M", "3M", "2Y", "10Y"]);
  });

  it("keeps tenors in ascending term order", () => {
    expect(curves[1]!.points.map((p) => p.tenorKey)).toEqual(["1M", "1.5M", "3M", "2Y", "10Y", "30Y"]);
  });

  it("returns an empty list for a feed with no entries", () => {
    expect(parseYieldCurveXml(`<?xml version="1.0"?><feed></feed>`)).toEqual([]);
  });
});

describe("integer units", () => {
  it("rounds percent to whole basis points", () => {
    expect(percentToBps(4.77)).toBe(477);
    expect(percentToBps(3.8)).toBe(380);
    // 0.1 + 0.02 is 0.12000000000000001 in IEEE 754.
    expect(percentToBps(0.1 + 0.02)).toBe(12);
  });

  it("converts dollars to minor units", () => {
    expect(unitsToMinor(25_000_000)).toBe(2_500_000_000);
  });

  it("computes a year of interest exactly", () => {
    // $25,000,000 at 4.77% for 12 months = $1,192,500.
    expect(simpleInterestMinor(2_500_000_000, 477, 12)).toBe(119_250_000);
  });

  it("computes interest to a ten-year maturity exactly", () => {
    expect(simpleInterestMinor(2_500_000_000, 477, 120)).toBe(1_192_500_000);
  });

  it("stays exact on amounts that would drift as floats", () => {
    // 0.1 + 0.2 style drift can't arise: every input is already an integer.
    expect(simpleInterestMinor(10_000_000_003, 383, 1)).toBe(
      Math.round((10_000_000_003 * 383 * 1) / (10_000 * 12)),
    );
  });
});

describe("addMonths", () => {
  it("adds whole months", () => {
    expect(addMonths(new Date("2026-09-03T00:00:00Z"), 24).toISOString().slice(0, 10)).toBe(
      "2028-09-03",
    );
  });

  it("clamps to month end instead of rolling over", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe(
      "2026-02-28",
    );
  });

  it("handles the 1.5-month bill", () => {
    expect(addMonths(new Date("2026-09-03T00:00:00Z"), 1.5).toISOString().slice(0, 10)).toBe(
      "2026-10-18",
    );
  });
});
