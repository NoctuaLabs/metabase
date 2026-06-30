import { useCallback, useState } from "react";
import { t } from "ttag";

import { PivotActionApi } from "metabase/services";
import {
  CUSTOM_ACTION_NAME_SETTING,
  CUSTOM_ACTION_URL_SETTING,
} from "metabase/visualizations/lib/data_grid";
import type { ClickObject } from "metabase/visualizations/types";
import type {
  DatasetColumn,
  Series,
  VisualizationSettings,
} from "metabase-types/api";

import type { HeaderItem } from "./types";
import { getActivePivotFilters, getRowDataForCustomAction } from "./utils";

// Matches the `getExtraDataForClick` prop from VisualizationProps. On a dashboard
// it returns the live applied filter values; off-dashboard it defaults to {}.
type GetExtraDataForClick = (
  clicked: ClickObject | null,
) => Record<string, unknown>;

type PivotedRowSource = {
  getRowSection: (colIndex: number, rowIndex: number) => HeaderItem[];
  columnCount: number;
  valueIndexes: number[];
  rowIndexes: number[];
  columnsWithoutPivotGroup: DatasetColumn[];
};

type ActionMenuState = { x: number; y: number; item: HeaderItem } | null;

type ActionResultState = {
  open: boolean;
  loading: boolean;
  html: string | null;
  error: string | null;
};

const CLOSED_RESULT: ActionResultState = {
  open: false,
  loading: false,
  html: null,
  error: null,
};

/**
 * Encapsulates the pivot "Custom Action" feature: the configured action name /
 * URL, the cursor-anchored context menu state, the result-modal state, and the
 * handlers that gather a row's data and POST it through the backend proxy.
 * Extracted from PivotTable to keep the main component's complexity in check.
 */
export function useCustomAction(
  settings: VisualizationSettings,
  rawSeries: Series | undefined | null,
  getExtraDataForClick: GetExtraDataForClick | undefined,
  getColumnTitle: (column: DatasetColumn) => string,
) {
  const actionName = (
    (settings[CUSTOM_ACTION_NAME_SETTING] as string | undefined) ?? ""
  ).trim();
  const actionUrl = (
    (settings[CUSTOM_ACTION_URL_SETTING] as string | undefined) ?? ""
  ).trim();
  const enabled = actionName !== "" && actionUrl !== "";

  const [menu, setMenu] = useState<ActionMenuState>(null);
  const [result, setResult] = useState<ActionResultState>(CLOSED_RESULT);

  const openMenu = useCallback(
    (e: React.MouseEvent, item: HeaderItem) => {
      if (!enabled) {
        return;
      }
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, item });
    },
    [enabled],
  );

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeResult = useCallback(() => setResult(CLOSED_RESULT), []);

  const run = useCallback(
    async (item: HeaderItem, pivoted: PivotedRowSource) => {
      setMenu(null);
      setResult({ open: true, loading: true, html: null, error: null });
      const row = getRowDataForCustomAction(item, pivoted, getColumnTitle);
      // Read live dashboard filter values at click time via getExtraDataForClick
      // (returns {} off-dashboard), falling back to the series parameters.
      const extraData = getExtraDataForClick?.(null);
      const filters = getActivePivotFilters(rawSeries, extraData);
      try {
        const html: string = await PivotActionApi.proxy({
          url: actionUrl,
          payload: { row, filters },
        });
        setResult({ open: true, loading: false, html, error: null });
      } catch (err) {
        const message =
          (err as { data?: { message?: string } })?.data?.message ??
          (err as { message?: string })?.message ??
          t`The custom action request failed.`;
        setResult({ open: true, loading: false, html: null, error: message });
      }
    },
    [actionUrl, rawSeries, getExtraDataForClick, getColumnTitle],
  );

  return {
    actionName,
    enabled,
    menu,
    result,
    openMenu,
    closeMenu,
    closeResult,
    run,
  };
}
