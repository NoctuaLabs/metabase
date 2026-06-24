import {
  COLUMN_HIDDEN,
  COLUMN_SHOW_TOTALS,
  COLUMN_SPLIT_SETTING,
  COLUMN_TOTAL_FORMULA,
  SHOW_HIDDEN_COLUMNS_SETTING,
  computeNativePivotTotals,
  multiLevelPivot,
} from "metabase/visualizations/lib/data_grid";
import { TYPE } from "metabase-lib/v1/types/constants";

// Native columns (no pivot-grouping column => native synthesis path).
const col = (name, base = TYPE.Text) => ({
  name,
  display_name: name,
  base_type: base,
  source: "native",
});

// Mirrors the ROAS screenshot: a cohort_date + network breakdown, with
// rev_d0 and spend_d0 counts and a roas_d0 percent column whose total is a
// custom formula rev_d0 / spend_d0 * 100 (raw ratio; percent formatting then
// multiplies by 100 again for display, but here we assert the raw value).
const COHORT = col("cohort_date");
const NETWORK = col("network");
const REV = col("rev_d0", TYPE.Float);
const SPEND = col("spend_d0", TYPE.Float);
const ROAS = col("roas_d0", TYPE.Float);

function nativeData(rows) {
  return { rows, cols: [COHORT, NETWORK, REV, SPEND, ROAS] };
}

// rev/spend are sums; roas is a percent (weighted by default) but here it gets
// a custom total formula that overrides the aggregation.
function settings({
  formula = "rev_d0 / spend_d0",
  hidden = {},
  showHidden = false,
  collapsedRows = ["1"],
} = {}) {
  return {
    column: (c) => ({
      column: c,
      [COLUMN_SHOW_TOTALS]: true,
      number_style: c.name === "roas_d0" ? "percent" : undefined,
      [COLUMN_TOTAL_FORMULA]: c.name === "roas_d0" ? formula : "",
      [COLUMN_HIDDEN]: hidden[c.name] === true,
    }),
    [COLUMN_SPLIT_SETTING]: {
      rows: ["cohort_date", "network"],
      columns: [],
      values: ["rev_d0", "spend_d0", "roas_d0"],
    },
    [SHOW_HIDDEN_COLUMNS_SETTING]: showHidden,
    "pivot_table.collapsed_rows": { value: collapsedRows },
    "pivot.show_row_totals": true,
    "pivot.show_column_totals": false,
    "pivot.condense_duplicate_totals": true,
    "pivot.subtotals_on_top": true,
  };
}

describe("native pivot custom total formula", () => {
  // One cohort_date with three network cells. The roas per-cell values are
  // deliberately inconsistent with rev/spend so the formula's effect is visible.
  //   rev total   = 219.07 + 155.35 + 17.64 = 392.06
  //   spend total = 242.17 + 198.66 + 12.49 = 453.32
  //   formula roas total = 392.06 / 453.32 = 0.86487...  (=> 86.49% formatted)
  // A plain weighted mean of the per-cell roas would give a different number.
  const data = nativeData([
    ["2026-06-19", "Google Ads ACI", 219.07, 242.17, 0.9046],
    ["2026-06-19", "Applovin", 155.35, 198.66, 0.782],
    ["2026-06-19", "Mintegral", 17.64, 12.49, 1.4122],
  ]);

  it("computes the subtotal roas from aggregated rev/spend totals", () => {
    const result = multiLevelPivot(data, settings());
    expect(result).not.toBeNull();

    const section = result.getRowSection(0, 0);
    const values = section.map((c) => c.value);
    // rev_d0 sum, spend_d0 sum, then formula-driven roas.
    expect(values[0]).toBe("392.06");
    expect(values[1]).toBe("453.32");
    // 392.06 / 453.32 = 0.86487... => 86.49%
    expect(values[2]).toBe("86.49%");
  });

  it("falls back to default aggregation when the formula is empty", () => {
    const result = multiLevelPivot(data, settings({ formula: "" }));
    const values = result.getRowSection(0, 0).map((c) => c.value);
    // With no formula, roas is a weighted mean (weight = first non-percent
    // value column = rev_d0):
    //   (219.07*.9046 + 155.35*.782 + 17.64*1.4122) / (219.07+155.35+17.64)
    const wsum = 219.07 + 155.35 + 17.64;
    const wxsum = 219.07 * 0.9046 + 155.35 * 0.782 + 17.64 * 1.4122;
    const expected = wxsum / wsum;
    const pct = `${(expected * 100).toFixed(2)}%`;
    expect(values[2]).toBe(pct);
  });

  it("ignores a malformed formula and uses default aggregation", () => {
    const result = multiLevelPivot(data, settings({ formula: "rev_d0 /" }));
    // Should not throw; roas falls back to weighted mean (a finite percent).
    const values = result.getRowSection(0, 0).map((c) => c.value);
    expect(values[2]).toMatch(/%$/);
  });
});

describe("native pivot hidden column", () => {
  const data = nativeData([
    ["2026-06-19", "Google Ads ACI", 219.07, 242.17, 0.9046],
    ["2026-06-19", "Applovin", 155.35, 198.66, 0.782],
  ]);

  it("drops a hidden value column from the rendered measures but keeps it for formulas", () => {
    // Hide spend_d0; the formula rev_d0 / spend_d0 must STILL work.
    const result = multiLevelPivot(
      data,
      settings({ hidden: { spend_d0: true } }),
    );
    expect(result).not.toBeNull();

    // Only rev_d0 and roas_d0 are rendered (spend_d0 hidden).
    const section = result.getRowSection(0, 0);
    expect(section).toHaveLength(2);
    const values = section.map((c) => c.value);
    // rev sum = 374.42, spend sum = 440.83 (hidden), roas = 374.42/440.83.
    expect(values[0]).toBe("374.42");
    const expected = (219.07 + 155.35) / (242.17 + 198.66);
    expect(values[1]).toBe(`${(expected * 100).toFixed(2)}%`);
  });

  it("renders the hidden column when SHOW_HIDDEN_COLUMNS_SETTING is on", () => {
    // Same hidden spend_d0, but the toolbar override reveals it: all three
    // measures render again, without clearing the per-column hide flag.
    const result = multiLevelPivot(
      data,
      settings({ hidden: { spend_d0: true }, showHidden: true }),
    );
    const section = result.getRowSection(0, 0);
    expect(section).toHaveLength(3);
    const values = section.map((c) => c.value);
    expect(values[0]).toBe("374.42"); // rev_d0
    expect(values[1]).toBe("440.83"); // spend_d0 now visible
  });
});

describe("computeNativePivotTotals with custom formula", () => {
  const cols = [COHORT, NETWORK, REV, SPEND, ROAS];
  const getColumnSetting = (c) => ({
    number_style: c.name === "roas_d0" ? "percent" : undefined,
    [COLUMN_TOTAL_FORMULA]: c.name === "roas_d0" ? "rev_d0 / spend_d0" : "",
  });
  const columnSplit = {
    rows: ["cohort_date", "network"],
    columns: [],
    values: ["rev_d0", "spend_d0", "roas_d0"],
  };

  it("applies the formula to the grand total for the chart/heatmap", () => {
    const data = {
      cols,
      rows: [
        ["2026-06-19", "Google Ads ACI", 219.07, 242.17, 0.9046],
        ["2026-06-19", "Applovin", 155.35, 198.66, 0.782],
      ],
    };
    const totals = computeNativePivotTotals(
      data,
      columnSplit,
      getColumnSetting,
    );
    expect(totals).toHaveLength(3);
    const roas = totals.find((t) => t.name === "roas_d0");
    const expected = (219.07 + 155.35) / (242.17 + 198.66);
    expect(roas.value).toBeCloseTo(expected, 10);
  });
});
