import { t } from "ttag";
import _ from "underscore";

import { DEFAULT_METABASE_COMPONENT_THEME } from "metabase/embedding-sdk/theme";
import { sumArray } from "metabase/utils/arrays";
import { measureText } from "metabase/utils/measure-text";
import { isPivotGroupColumn } from "metabase/visualizations/lib/data_grid";
import type NativeQuery from "metabase-lib/v1/queries/NativeQuery";
import { migratePivotColumnSplitSetting } from "metabase-lib/v1/queries/utils/pivot";
import type {
  ColumnNameColumnSplitSetting,
  DatasetColumn,
  PivotTableColumnSplitSetting,
  Series,
  VisualizationSettings,
} from "metabase-types/api";

import {
  CELL_HEIGHT,
  CELL_PADDING,
  DEFAULT_CELL_WIDTH,
  LEFT_HEADER_LEFT_SPACING,
  MAX_HEADER_CELL_WIDTH,
  MAX_ROWS_TO_MEASURE,
  MIN_HEADER_CELL_WIDTH,
  ROW_TOGGLE_ICON_WIDTH,
} from "./constants";
import { partitions } from "./partitions";
import type { CustomColumnWidth, HeaderItem } from "./types";

// adds or removes columns from the pivot settings based on the current query
export function updateValueWithCurrentColumns(
  storedValue: PivotTableColumnSplitSetting,
  columns: DatasetColumn[],
): PivotTableColumnSplitSetting {
  const migratedValue = migratePivotColumnSplitSetting(storedValue, columns);
  const currentQueryColumnNames = columns.map((c) => c.name);
  const currentSettingColumnNames = Object.values(migratedValue).flatMap(
    (columnNames) => columnNames ?? [],
  );
  const toAdd = _.difference(
    currentQueryColumnNames,
    currentSettingColumnNames,
  );
  const toRemove = _.difference(
    currentSettingColumnNames,
    currentQueryColumnNames,
  );
  // if there are no modifications, it's important to return the original,
  // potentially legacy settings that use field refs. If the migrated settings
  // are returned here it would make all saved legacy questions become ad-hoc,
  // which we should avoid.
  if (toAdd.length === 0 && toRemove.length === 0) {
    return storedValue;
  }

  // remove toRemove
  const value: ColumnNameColumnSplitSetting = _.mapObject(
    migratedValue,
    (columnNames) =>
      columnNames?.filter((columnName) => !toRemove.includes(columnName)),
  );

  // add toAdd to first partitions where it matches the filter
  for (const columnName of toAdd) {
    for (const { columnFilter: filter, name } of partitions) {
      const column = columns.find((c) => c.name === columnName);
      if (column != null && (filter == null || filter(column))) {
        value[name] = value[name] ?? [];
        value[name].push(column.name);
        break;
      }
    }
  }

  return value;
}

// This is a hack. We need to pass pivot_rows and pivot_cols on each query.
// When a breakout is added to the query, we need to partition it before getting the rows.
// We pretend the breakouts are columns so we can partition the new breakout.
export function addMissingCardBreakouts(
  setting: PivotTableColumnSplitSetting,
  availableColumns: DatasetColumn[],
): PivotTableColumnSplitSetting {
  const { rows = [], columns = [] } = setting;
  const breakoutColumns = availableColumns.filter(
    (column) => column.source === "breakout",
  );
  if (breakoutColumns.length <= columns.length + rows.length) {
    return setting;
  }
  return updateValueWithCurrentColumns(setting, availableColumns);
}

export function isColumnValid(col: DatasetColumn) {
  return (
    col.source === "aggregation" ||
    col.source === "breakout" ||
    col.source === "native" ||
    isPivotGroupColumn(col)
  );
}

// The payload sent to a configured "Custom Action" POST URL: the clicked row's
// visible cells plus the filters currently applied to the query.
export type CustomActionPayload = {
  row: Record<string, unknown>;
  filters: Record<string, unknown>;
};

// The subset of the processed pivot model (`multiLevelPivot` result) needed to
// read a single row's visible cells. `getRowSection` returns body cells, each at
// least a HeaderItem (we only read `value` and `path`).
type PivotedRowSource = {
  getRowSection: (colIndex: number, rowIndex: number) => HeaderItem[];
  columnCount: number;
  valueIndexes: number[];
  rowIndexes: number[];
  columnsWithoutPivotGroup: DatasetColumn[];
};

// Builds the `{ columnTitle: value }` map of VISIBLE cells for the row whose
// first-column (left-header leaf) cell was clicked. `item.offset` is the body
// grid row index for that leaf row (see metabase.pivot.core/tree-to-array), so
// we read every body section at that row and collect the rendered measure
// values. The row-header dimension value(s) come from the clicked item itself.
// `getColumnTitle` maps a column to its display title (respecting per-column
// `column_title` settings).
export function getRowDataForCustomAction(
  item: HeaderItem,
  pivoted: PivotedRowSource,
  getColumnTitle: (column: DatasetColumn) => string,
): Record<string, unknown> {
  const {
    getRowSection,
    columnCount,
    valueIndexes,
    rowIndexes,
    columnsWithoutPivotGroup,
  } = pivoted;
  const row: Record<string, unknown> = {};

  // Row-header dimension value. `item.path` holds the rawValues from the root to
  // this leaf, one per row dimension; pair each with its column title.
  const path = item.path ?? [];
  rowIndexes.forEach((colIdx, level) => {
    const column = columnsWithoutPivotGroup[colIdx];
    if (column != null && level < path.length) {
      row[getColumnTitle(column)] = path[level];
    }
  });
  // Fall back to the formatted display value if there was no path.
  if (path.length === 0 && rowIndexes.length > 0) {
    const column = columnsWithoutPivotGroup[rowIndexes[0]];
    if (column != null) {
      row[getColumnTitle(column)] = item.value;
    }
  }

  // Measure cells across every column group at this body row.
  for (let colIndex = 0; colIndex < columnCount; colIndex++) {
    const section = getRowSection(colIndex, item.offset) ?? [];
    section.forEach((cell, measureIdx) => {
      const valueColIdx = valueIndexes[measureIdx];
      const column = columnsWithoutPivotGroup[valueColIdx];
      if (column == null) {
        return;
      }
      // When there is more than one column group, disambiguate the key with the
      // column-path label that prefixes the section.
      const baseTitle = getColumnTitle(column);
      const key =
        columnCount > 1 && cell.path != null && cell.path.length > 0
          ? `${cell.path.join(" / ")} / ${baseTitle}`
          : baseTitle;
      row[key] = cell.value;
    });
  }

  return row;
}

type AppliedParameter = { name?: string; slug?: string; value?: unknown };

// The relevant shape of the object returned by the visualization's
// `getExtraDataForClick(null)` (see metabase/dashboard/hooks/use-click-behavior-data).
type ClickExtraData = {
  parameters?: AppliedParameter[];
  parameterValuesBySlug?: Record<string, unknown>;
};

// Collects the filters currently applied to the pivot, as a `{ name | slug:
// value }` map (parameters without a value are skipped).
//
// On a dashboard the live filter values live in the dashboard Redux state, not on
// the card's series. `extraData` comes from the viz's `getExtraDataForClick(null)`
// prop, which the dashboard wires to the store and reads at call time — so it
// reflects the currently-applied dashboard filters. We prefer its `parameters`
// (which carry display names + values), then its slug→value map, and finally fall
// back to the parameters carried on the series (`json_query.parameters`, then
// `data.parameters`) for the query-builder case where there is no dashboard.
export function getActivePivotFilters(
  rawSeries: Series | undefined | null,
  extraData?: ClickExtraData | Record<string, unknown> | null,
): Record<string, unknown> {
  const extra = (extraData ?? {}) as ClickExtraData;

  const fromParameters = collectParameterValues(extra.parameters ?? []);
  if (Object.keys(fromParameters).length > 0) {
    return fromParameters;
  }

  const bySlug = extra.parameterValuesBySlug ?? {};
  const fromSlugMap: Record<string, unknown> = {};
  for (const [slug, value] of Object.entries(bySlug)) {
    if (value != null) {
      fromSlugMap[slug] = value;
    }
  }
  if (Object.keys(fromSlugMap).length > 0) {
    return fromSlugMap;
  }

  const first = rawSeries?.[0] as
    | {
        data?: { parameters?: AppliedParameter[] };
        json_query?: { parameters?: AppliedParameter[] };
      }
    | undefined;
  const seriesParameters =
    first?.json_query?.parameters ?? first?.data?.parameters ?? [];
  return collectParameterValues(seriesParameters);
}

function collectParameterValues(
  parameters: AppliedParameter[],
): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  for (const param of parameters) {
    if (param == null || param.value == null) {
      continue;
    }
    const key = param.name || param.slug;
    if (key) {
      filters[key] = param.value;
    }
  }
  return filters;
}

export function isFormattablePivotColumn(column: DatasetColumn) {
  return column.source === "aggregation" || column.source === "native";
}

interface GetLeftHeaderWidthsProps {
  rowIndexes: number[];
  getColumnTitle: (columnIndex: number) => string;
  leftHeaderItems?: HeaderItem[];
  font: { fontFamily?: string; fontSize?: string };
}

export function getLeftHeaderWidths({
  rowIndexes,
  getColumnTitle,
  leftHeaderItems = [],
  font,
}: GetLeftHeaderWidthsProps) {
  const {
    fontFamily = "var(--mb-default-font-family)",
    fontSize = DEFAULT_METABASE_COMPONENT_THEME.pivotTable.cell.fontSize,
  } = font ?? {};

  const cellValues = getColumnValues(leftHeaderItems);

  const widths = rowIndexes.map((rowIndex, depthIndex) => {
    const computedHeaderWidth = Math.ceil(
      measureText(getColumnTitle(rowIndex), {
        weight: "bold",
        family: fontFamily,
        size: fontSize,
      }).width + ROW_TOGGLE_ICON_WIDTH,
    );

    const computedCellWidth = Math.ceil(
      Math.max(
        // we need to use the depth index because the data is in depth order, not row index order
        ...(cellValues[depthIndex]?.values?.map(
          (value) =>
            measureText(value, {
              weight: "normal",
              family: fontFamily,
              size: fontSize,
            }).width +
            (cellValues[rowIndex]?.hasSubtotal ? ROW_TOGGLE_ICON_WIDTH : 0),
        ) ?? [0]),
      ),
    );

    const computedWidth =
      Math.max(computedHeaderWidth, computedCellWidth) + CELL_PADDING;

    if (computedWidth > MAX_HEADER_CELL_WIDTH) {
      return MAX_HEADER_CELL_WIDTH;
    }

    if (computedWidth < MIN_HEADER_CELL_WIDTH) {
      return MIN_HEADER_CELL_WIDTH;
    }

    return computedWidth;
  });

  const total = sumArray(widths);

  return { leftHeaderWidths: widths, totalLeftHeaderWidths: total };
}

type ColumnValueInfo = {
  values: string[];
  hasSubtotal: boolean;
};

export function getColumnValues(leftHeaderItems: HeaderItem[]) {
  const columnValues: ColumnValueInfo[] = [];

  leftHeaderItems
    .slice(0, MAX_ROWS_TO_MEASURE)
    .forEach((leftHeaderItem: HeaderItem) => {
      const { value, depth, isSubtotal, isGrandTotal, hasSubtotal } =
        leftHeaderItem;

      // don't size based on subtotals or grand totals
      if (!isSubtotal && !isGrandTotal) {
        if (!columnValues[depth]) {
          columnValues[depth] = {
            values: [value],
            hasSubtotal: false,
          };
        } else {
          columnValues[depth].values.push(value);
        }

        // we need to track whether the column has a subtotal to size for the row expand icon
        if (hasSubtotal) {
          columnValues[depth].hasSubtotal = true;
        }
      }
    });

  return columnValues;
}

function databaseSupportsPivotTables(query: NativeQuery | null | undefined) {
  if (!query) {
    return true;
  }

  const question = query.question();
  const database = question.database();

  if (!database) {
    // if we don't have metadata, we can't check this
    return true;
  }

  return database.supportsPivots();
}

export function isSensible({ cols }: { cols: DatasetColumn[] }) {
  return cols.length >= 2 && cols.every(isColumnValid);
}

export function checkRenderable(
  [{ data }]: Series,
  settings: VisualizationSettings,
  query?: NativeQuery | null,
) {
  const isNativeQuery = data.cols.some((col) => col.source === "native");
  if (
    !isNativeQuery &&
    (data.cols.length < 2 || !data.cols.every(isColumnValid))
  ) {
    throw new Error(t`Pivot tables can only be used with aggregated queries.`);
  }
  if (data.cols.length < 2) {
    throw new Error(t`Pivot tables require at least 2 columns.`);
  }
  if (!databaseSupportsPivotTables(query)) {
    throw new Error(t`This database does not support pivot tables.`);
  }
  if (data.pivot_rows_truncated != null) {
    throw new Error(
      t`Too many rows for a pivot table. Please add a filter or remove breakouts to reduce the number of rows.`,
    );
  }
}

export const leftHeaderCellSizeAndPositionGetter = (
  item: HeaderItem,
  leftHeaderWidths: number[],
  rowIndexes: number[],
) => {
  const { offset, span, depth, maxDepthBelow, isSubtotal } = item;

  const columnsToSpan = rowIndexes.length - depth - maxDepthBelow;

  // for subtotals, add up all the widths of the columns, other than itself, that this cell spans
  const spanWidth = isSubtotal
    ? sumArray(leftHeaderWidths.slice(depth + 1, depth + columnsToSpan))
    : 0;
  const columnPadding = depth === 0 ? LEFT_HEADER_LEFT_SPACING : 0;
  const columnWidth = leftHeaderWidths[depth];

  return {
    height: span * CELL_HEIGHT,
    width: columnWidth + spanWidth + columnPadding,
    x:
      sumArray(leftHeaderWidths.slice(0, depth)) +
      (depth > 0 ? LEFT_HEADER_LEFT_SPACING : 0),
    y: offset * CELL_HEIGHT,
  };
};

export const topHeaderCellSizeAndPositionGetter = (
  item: HeaderItem,
  topHeaderRows: number,
  valueHeaderWidths: CustomColumnWidth,
) => {
  const { offset, span, maxDepthBelow } = item;

  const leftOffset = getWidthForRange(valueHeaderWidths, 0, offset);
  const width = getWidthForRange(valueHeaderWidths, offset, offset + span);

  return {
    height: CELL_HEIGHT,
    width,
    x: leftOffset,
    y: (topHeaderRows - maxDepthBelow - 1) * CELL_HEIGHT,
  };
};

export const getWidthForRange = (
  widths: CustomColumnWidth,
  start?: number,
  end?: number,
) => {
  let total = 0;
  for (let i = start ?? 0; i < (end ?? Object.keys(widths).length); i++) {
    total += widths[i] ?? DEFAULT_CELL_WIDTH;
  }
  return total;
};

export const getCellWidthsForSection = (
  valueHeaderWidths: CustomColumnWidth,
  valueIndexes: number[],
  startIndex: number,
) => {
  const widths = [];
  const startCol = startIndex * valueIndexes.length;
  const endCol = startIndex * valueIndexes.length + valueIndexes.length;
  for (let i = startCol; i < endCol; i++) {
    widths.push(valueHeaderWidths[i] ?? DEFAULT_CELL_WIDTH);
  }
  return widths;
};
