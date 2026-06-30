import type { PivotTableColumnSplitSetting } from "metabase-types/api";
import { createMockColumn } from "metabase-types/api/mocks";

import {
  CELL_PADDING,
  MAX_HEADER_CELL_WIDTH,
  MIN_HEADER_CELL_WIDTH,
  ROW_TOGGLE_ICON_WIDTH,
} from "./constants";
import type { HeaderItem } from "./types";
import {
  addMissingCardBreakouts,
  checkRenderable,
  getActivePivotFilters,
  getColumnValues,
  getLeftHeaderWidths,
  getRowDataForCustomAction,
  isColumnValid,
  isFormattablePivotColumn,
  leftHeaderCellSizeAndPositionGetter,
  updateValueWithCurrentColumns,
} from "./utils";

describe("Visualizations > Visualizations > PivotTable > utils", () => {
  const cols = [
    createMockColumn({ source: "breakout", name: "field-123" }),
    createMockColumn({ source: "breakout", name: "field-456" }),
    createMockColumn({ source: "breakout", name: "field-789" }),
    createMockColumn({ source: "aggregation", name: "aggregation-1" }),
    createMockColumn({ source: "aggregation", name: "aggregation-2" }),
  ];

  describe("isColumnValid", () => {
    it("should return true if a column is an aggregation", () => {
      const result = isColumnValid(createMockColumn({ source: "aggregation" }));
      expect(result).toBe(true);
    });

    it("should return true if a column is a breakout", () => {
      const result = isColumnValid(createMockColumn({ source: "breakout" }));
      expect(result).toBe(true);
    });

    it("should return true if a column is a pivot grouping", () => {
      const result = isColumnValid(
        createMockColumn({
          source: "fields",
          name: "pivot-grouping",
        }),
      );
      expect(result).toBe(true);
    });

    it("should return false if a column is a field", () => {
      const result = isColumnValid(createMockColumn({ source: "fields" }));
      expect(result).toBe(false);
    });
  });

  describe("isFormattablePivotColumn", () => {
    it("should return true if a column is an aggregation", () => {
      const result = isFormattablePivotColumn(
        createMockColumn({
          source: "aggregation",
        }),
      );
      expect(result).toBe(true);
    });

    it("should return false if a column is a breakout", () => {
      const result = isFormattablePivotColumn(
        createMockColumn({
          source: "breakout",
        }),
      );
      expect(result).toBe(false);
    });
  });

  describe("updateValueWithCurrentColumns", () => {
    it("should not update settings when no columns have changed", () => {
      const pivotSettings: PivotTableColumnSplitSetting = {
        columns: [cols[0].name],
        rows: [cols[1].name, cols[2].name],
        values: [cols[3].name, cols[4].name],
      };

      const result = updateValueWithCurrentColumns(pivotSettings, cols);

      expect(result).toEqual(pivotSettings);
    });

    it("should add a newly-added field to rows", () => {
      const oldPivotSettings: PivotTableColumnSplitSetting = {
        columns: [],
        rows: [cols[0].name, cols[1].name],
        values: [cols[3].name, cols[4].name],
      };

      const newPivotSettings: PivotTableColumnSplitSetting = {
        columns: [],
        rows: [
          cols[0].name,
          cols[1].name,
          cols[2].name, // <-- new column
        ],
        values: [cols[3].name, cols[4].name],
      };

      const result = updateValueWithCurrentColumns(oldPivotSettings, cols);

      expect(result).toEqual(newPivotSettings);
    });

    it("should add a newly-added aggregation to values", () => {
      const oldPivotSettings: PivotTableColumnSplitSetting = {
        columns: [],
        rows: [cols[0].name, cols[1].name, cols[2].name],
        values: [cols[3].name],
      };

      const newPivotSettings: PivotTableColumnSplitSetting = {
        columns: [],
        rows: [cols[0].name, cols[1].name, cols[2].name],
        values: [
          cols[3].name,
          cols[4].name, // <-- new aggregation
        ],
      };

      const result = updateValueWithCurrentColumns(oldPivotSettings, cols);

      expect(result).toEqual(newPivotSettings);
    });

    it("should remove a removed field from rows", () => {
      const oldPivotSettings: PivotTableColumnSplitSetting = {
        columns: [],
        rows: [cols[0].name, cols[1].name, cols[2].name, "removed_column"],
        values: [cols[3].name],
      };

      const newPivotSettings: PivotTableColumnSplitSetting = {
        columns: [],
        rows: [cols[0].name, cols[1].name, cols[2].name],
        values: [cols[3].name, cols[4].name],
      };

      const result = updateValueWithCurrentColumns(oldPivotSettings, cols);

      expect(result).toEqual(newPivotSettings);
    });

    it("should remove a removed aggregation from values", () => {
      const oldPivotSettings: PivotTableColumnSplitSetting = {
        columns: [],
        rows: [cols[0].name, cols[1].name, cols[2].name],
        values: [cols[3].name, cols[4].name, "removed_aggregation"],
      };

      const newPivotSettings: PivotTableColumnSplitSetting = {
        columns: [],
        rows: [cols[0].name, cols[1].name, cols[2].name],
        values: [cols[3].name, cols[4].name],
      };

      const result = updateValueWithCurrentColumns(oldPivotSettings, cols);

      expect(result).toEqual(newPivotSettings);
    });
  });

  describe("addMissingCardBreakouts", () => {
    it("should not mess with pivot settings that aren't missing breakouts", () => {
      const oldPivotSettings: PivotTableColumnSplitSetting = {
        columns: [cols[0].name],
        rows: [cols[1].name, cols[2].name],
        values: [cols[3].name, cols[4].name],
      };

      const result = addMissingCardBreakouts(oldPivotSettings, cols);

      expect(result).toEqual(oldPivotSettings);
    });

    it("should add a missing breakout to pivot settings", () => {
      const oldPivotSettings: PivotTableColumnSplitSetting = {
        columns: [cols[0].name],
        rows: [cols[1].name, cols[2].name],
        values: [cols[3].name, cols[4].name],
      };

      const newColumn = createMockColumn({
        name: "new_breakout",
        source: "breakout",
      });
      const newPivotSettings: PivotTableColumnSplitSetting = {
        columns: [cols[0].name],
        rows: [cols[1].name, cols[2].name, newColumn.name],
        values: [cols[3].name, cols[4].name],
      };

      const result = addMissingCardBreakouts(oldPivotSettings, [
        ...cols,
        newColumn,
      ]);

      expect(result).toEqual(newPivotSettings);
    });
  });

  describe("getLeftHeaderWidths", () => {
    it("should return an array of widths", () => {
      const { leftHeaderWidths } = getLeftHeaderWidths({
        rowIndexes: [0, 1, 2],
        getColumnTitle: () => "test-123",
        font: {},
      });
      // jest-dom thinks all characters are 1px wide, so we get the minimum
      expect(leftHeaderWidths).toEqual([
        MIN_HEADER_CELL_WIDTH,
        MIN_HEADER_CELL_WIDTH,
        MIN_HEADER_CELL_WIDTH,
      ]);
    });

    it("should return the total of all widths", () => {
      const { totalLeftHeaderWidths } = getLeftHeaderWidths({
        rowIndexes: [0, 1, 2],
        getColumnTitle: () => "test-123",
        font: {},
      });
      expect(totalLeftHeaderWidths).toEqual(MIN_HEADER_CELL_WIDTH * 3);
    });

    it("should not exceed the max width", () => {
      const { leftHeaderWidths } = getLeftHeaderWidths({
        rowIndexes: [0, 1, 2],
        // jest-dom thinks characters are 1px wide
        getColumnTitle: () => "x".repeat(MAX_HEADER_CELL_WIDTH),
        font: {},
      });

      expect(leftHeaderWidths).toEqual([
        MAX_HEADER_CELL_WIDTH,
        MAX_HEADER_CELL_WIDTH,
        MAX_HEADER_CELL_WIDTH,
      ]);
    });

    it("should return the wider of the column header or data width", () => {
      const data = [
        { depth: 0, value: "x".repeat(150) },
        { depth: 0, value: "foo2" },
        { depth: 1, value: "bar1" },
        { depth: 1, value: "bar2" },
        { depth: 2, value: "baz1" },
        { depth: 4, value: "boo1" },
      ] as HeaderItem[];

      const { leftHeaderWidths } = getLeftHeaderWidths({
        rowIndexes: [0, 1, 2, 3, 4],
        leftHeaderItems: data,
        getColumnTitle: () => "x".repeat(70),
        font: {},
      });

      expect(leftHeaderWidths).toEqual([
        150 + CELL_PADDING,
        70 + CELL_PADDING + ROW_TOGGLE_ICON_WIDTH,
        70 + CELL_PADDING + ROW_TOGGLE_ICON_WIDTH,
        70 + CELL_PADDING + ROW_TOGGLE_ICON_WIDTH,
        70 + CELL_PADDING + ROW_TOGGLE_ICON_WIDTH,
      ]);
    });

    it("should factor in the toggle icon width for columns with subtotals", () => {
      const data = [
        { depth: 0, value: "x".repeat(100), hasSubtotal: true },
        { depth: 0, value: "foo2" },
        { depth: 1, value: "bar1" },
        { depth: 1, value: "bar2" },
        { depth: 2, value: "baz1" },
        { depth: 4, value: "boo1" },
      ] as HeaderItem[];

      const { leftHeaderWidths } = getLeftHeaderWidths({
        rowIndexes: [0, 1, 2, 3, 4],
        leftHeaderItems: data,
        getColumnTitle: () => "test-123",
        font: {},
      });

      expect(leftHeaderWidths).toEqual([
        100 + CELL_PADDING + ROW_TOGGLE_ICON_WIDTH,
        MIN_HEADER_CELL_WIDTH,
        MIN_HEADER_CELL_WIDTH,
        MIN_HEADER_CELL_WIDTH,
        MIN_HEADER_CELL_WIDTH,
      ]);
    });
  });

  describe("checkRenderable", () => {
    it("should throw when pivot_rows_truncated is set", () => {
      const data = {
        cols: [
          createMockColumn({ source: "breakout", name: "field-1" }),
          createMockColumn({ source: "aggregation", name: "count" }),
        ],
        rows: [],
        pivot_rows_truncated: 100000,
      };
      expect(() => checkRenderable([{ data }] as any, {} as any)).toThrow(
        /Too many rows/,
      );
    });

    it("should not throw when pivot_rows_truncated is not set", () => {
      const data = {
        cols: [
          createMockColumn({ source: "breakout", name: "field-1" }),
          createMockColumn({ source: "aggregation", name: "count" }),
        ],
        rows: [],
      };
      expect(() => checkRenderable([{ data }] as any, {} as any)).not.toThrow();
    });
  });

  describe("getColumnValues", () => {
    it("can collect column values from left header data", () => {
      const data = [
        { depth: 0, value: "foo1" },
        { depth: 0, value: "foo2" },
        { depth: 1, value: "bar1" },
        { depth: 1, value: "bar2" },
        { depth: 2, value: "baz1" },
        { depth: 4, value: "boo1" },
      ] as HeaderItem[];

      const result = getColumnValues(data);

      expect(result).toEqual([
        { values: ["foo1", "foo2"], hasSubtotal: false },
        { values: ["bar1", "bar2"], hasSubtotal: false },
        { values: ["baz1"], hasSubtotal: false },
        undefined, // no depth of 3
        { values: ["boo1"], hasSubtotal: false },
      ]);
    });

    it("detects columns with subtotals", () => {
      const data = [
        { depth: 0, value: "foo1", hasSubtotal: false },
        { depth: 0, value: "foo2", hasSubtotal: true },
        { depth: 1, value: "bar1", hasSubtotal: false },
        { depth: 1, value: "bar2", hasSubtotal: false },
        { depth: 2, value: "baz1", hasSubtotal: true },
      ] as HeaderItem[];

      const result = getColumnValues(data);

      expect(result).toEqual([
        { values: ["foo1", "foo2"], hasSubtotal: true },
        { values: ["bar1", "bar2"], hasSubtotal: false },
        { values: ["baz1"], hasSubtotal: true },
      ]);
    });

    it("handles null values", () => {
      const data = [
        { depth: 0, value: "foo1", hasSubtotal: false },
        { depth: 0, value: null, hasSubtotal: true },
        { depth: 1, value: "bar1", hasSubtotal: false },
        { depth: 1, value: "bar2", hasSubtotal: false },
        { depth: 2, value: "baz1", hasSubtotal: true },
      ] as HeaderItem[];

      const result = getColumnValues(data);

      expect(result).toEqual([
        { values: ["foo1", null], hasSubtotal: true },
        { values: ["bar1", "bar2"], hasSubtotal: false },
        { values: ["baz1"], hasSubtotal: true },
      ]);
    });
  });

  describe("leftHeaderCellSizeAndPositionGetter", () => {
    it("should return the correct width for a subtotal", () => {
      const result = leftHeaderCellSizeAndPositionGetter(
        { depth: 1, maxDepthBelow: 0, isSubtotal: true } as HeaderItem,
        [100, 100, 100],
        [0, 1, 2],
      );
      expect(result.width).toBe(200);
    });

    it("should return the correct width for a non-subtotal", () => {
      const result = leftHeaderCellSizeAndPositionGetter(
        { depth: 1, maxDepthBelow: 1, isSubtotal: false } as HeaderItem,
        [100, 100, 100],
        [0, 1, 2],
      );
      expect(result.width).toBe(100);
    });

    it("non-subtotal widths should not increase when columns are collapsed", () => {
      const result = leftHeaderCellSizeAndPositionGetter(
        { depth: 1, maxDepthBelow: 0, isSubtotal: false } as HeaderItem,
        [100, 100, 100],
        [0, 1, 2],
      );
      expect(result.width).toBe(100);
    });
  });

  describe("getRowDataForCustomAction", () => {
    const country = createMockColumn({ source: "native", name: "country" });
    const users = createMockColumn({ source: "native", name: "new_users" });
    const revenue = createMockColumn({ source: "native", name: "revenue" });
    const columnsWithoutPivotGroup = [country, users, revenue];
    const getColumnTitle = (col: { name: string }) => col.name;

    it("collects the row-header value and visible measure cells", () => {
      const item = {
        offset: 2,
        path: ["Indonesia"],
        value: "Indonesia",
      } as unknown as HeaderItem;

      const pivoted = {
        // single column group -> one section with both measures
        getRowSection: (_col: number, rowIndex: number) =>
          rowIndex === 2
            ? [
                { value: "1,234" } as HeaderItem,
                { value: "$5,678" } as HeaderItem,
              ]
            : [],
        columnCount: 1,
        valueIndexes: [1, 2],
        rowIndexes: [0],
        columnsWithoutPivotGroup,
      };

      expect(getRowDataForCustomAction(item, pivoted, getColumnTitle)).toEqual({
        country: "Indonesia",
        new_users: "1,234",
        revenue: "$5,678",
      });
    });

    it("falls back to the formatted display value when there is no path", () => {
      const item = {
        offset: 0,
        path: [],
        value: "Total",
      } as unknown as HeaderItem;

      const pivoted = {
        getRowSection: () => [{ value: "9" } as HeaderItem],
        columnCount: 1,
        valueIndexes: [1],
        rowIndexes: [0],
        columnsWithoutPivotGroup,
      };

      expect(getRowDataForCustomAction(item, pivoted, getColumnTitle)).toEqual({
        country: "Total",
        new_users: "9",
      });
    });
  });

  describe("getActivePivotFilters", () => {
    it("reads applied parameters from json_query.parameters", () => {
      const rawSeries = [
        {
          json_query: {
            parameters: [
              { name: "Date", slug: "date", value: "2026-01-01~2026-01-31" },
              { name: "Region", slug: "region", value: "APAC" },
            ],
          },
        },
      ] as any;

      expect(getActivePivotFilters(rawSeries)).toEqual({
        Date: "2026-01-01~2026-01-31",
        Region: "APAC",
      });
    });

    it("skips parameters without a value and falls back to slug for the key", () => {
      const rawSeries = [
        {
          json_query: {
            parameters: [
              { slug: "region", value: "APAC" },
              { name: "Unset", slug: "unset", value: null },
            ],
          },
        },
      ] as any;

      expect(getActivePivotFilters(rawSeries)).toEqual({ region: "APAC" });
    });

    it("returns an empty object when there are no parameters", () => {
      expect(getActivePivotFilters(undefined)).toEqual({});
      expect(getActivePivotFilters([{}] as any)).toEqual({});
    });

    it("prefers dashboard parameters over the series parameters", () => {
      const rawSeries = [
        {
          json_query: {
            parameters: [{ name: "FromSeries", slug: "s", value: "series" }],
          },
        },
      ] as any;
      const dashboardParameters = [
        { name: "Game", slug: "game", value: "Hamster Jump" },
        { name: "Empty", slug: "empty", value: null },
      ] as any;

      expect(getActivePivotFilters(rawSeries, dashboardParameters)).toEqual({
        Game: "Hamster Jump",
      });
    });

    it("falls back to series parameters when dashboard parameters have no values", () => {
      const rawSeries = [
        {
          json_query: {
            parameters: [{ name: "FromSeries", slug: "s", value: "series" }],
          },
        },
      ] as any;
      const dashboardParameters = [
        { name: "Unset", slug: "unset", value: null },
      ] as any;

      expect(getActivePivotFilters(rawSeries, dashboardParameters)).toEqual({
        FromSeries: "series",
      });
    });
  });
});
