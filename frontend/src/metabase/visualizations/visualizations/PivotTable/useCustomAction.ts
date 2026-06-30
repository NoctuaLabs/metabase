import { useCallback, useState } from "react";
import { t } from "ttag";

import { PivotActionApi } from "metabase/services";
import {
  CUSTOM_ACTION_NAME_SETTING,
  CUSTOM_ACTION_RENDER_MODE_SETTING,
  CUSTOM_ACTION_URL_SETTING,
} from "metabase/visualizations/lib/data_grid";
import type { ClickObject } from "metabase/visualizations/types";
import type {
  DatasetColumn,
  Series,
  VisualizationSettings,
} from "metabase-types/api";

import type { RetentionProjectionData } from "./RetentionProjection";
import type { HeaderItem } from "./types";
import { getActivePivotFilters, getRowDataForCustomAction } from "./utils";

export type CustomActionRenderMode = "html" | "retention_projection";

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
  mode: CustomActionRenderMode;
  // Set when mode === "html".
  html: string | null;
  // Set when mode === "retention_projection".
  projection: RetentionProjectionData | null;
  error: string | null;
};

const CLOSED_RESULT: ActionResultState = {
  open: false,
  loading: false,
  mode: "html",
  html: null,
  projection: null,
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
  const renderMode: CustomActionRenderMode =
    (settings[CUSTOM_ACTION_RENDER_MODE_SETTING] as
      | CustomActionRenderMode
      | undefined) === "retention_projection"
      ? "retention_projection"
      : "html";
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
      setResult({
        ...CLOSED_RESULT,
        open: true,
        loading: true,
        mode: renderMode,
      });
      const row = getRowDataForCustomAction(item, pivoted, getColumnTitle);
      // Read live dashboard filter values at click time via getExtraDataForClick
      // (returns {} off-dashboard), falling back to the series parameters.
      const extraData = getExtraDataForClick?.(null);
      const filters = getActivePivotFilters(rawSeries, extraData);
      try {
        // The api layer parses JSON responses to an object and leaves non-JSON
        // (HTML) as a string, so `response` is an object for retention mode and
        // a string for html mode.
        const response: unknown = await PivotActionApi.proxy({
          url: actionUrl,
          payload: { row, filters },
        });
        if (renderMode === "retention_projection") {
          const projection = coerceProjectionData(response);
          if (projection == null) {
            setResult({
              ...CLOSED_RESULT,
              open: true,
              mode: renderMode,
              error: t`The service did not return valid retention projection JSON.`,
            });
            return;
          }
          setResult({
            ...CLOSED_RESULT,
            open: true,
            mode: renderMode,
            projection,
          });
        } else {
          setResult({
            ...CLOSED_RESULT,
            open: true,
            mode: renderMode,
            html: typeof response === "string" ? response : String(response),
          });
        }
      } catch (err) {
        const message =
          (err as { data?: { message?: string } })?.data?.message ??
          (err as { message?: string })?.message ??
          t`The custom action request failed.`;
        setResult({
          ...CLOSED_RESULT,
          open: true,
          mode: renderMode,
          error: message,
        });
      }
    },
    [actionUrl, renderMode, rawSeries, getExtraDataForClick, getColumnTitle],
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

// Normalizes the proxy response into RetentionProjectionData. The api layer
// usually parses JSON to an object, but if it arrived as a string we parse it
// here. Returns null when the payload isn't a usable object.
function coerceProjectionData(
  response: unknown,
): RetentionProjectionData | null {
  let value = response;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value == null || typeof value !== "object") {
    return null;
  }
  return value as RetentionProjectionData;
}
