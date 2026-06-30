import { createPortal } from "react-dom";
import { t } from "ttag";

import { Center, Loader, Menu, Modal, Text } from "metabase/ui";

import {
  RetentionProjection,
  type RetentionProjectionData,
} from "./RetentionProjection";
import type { HeaderItem } from "./types";
import type { CustomActionRenderMode } from "./useCustomAction";

type ActionMenuState = { x: number; y: number; item: HeaderItem } | null;

type ActionResultState = {
  open: boolean;
  loading: boolean;
  mode: CustomActionRenderMode;
  html: string | null;
  projection: RetentionProjectionData | null;
  error: string | null;
};

interface CustomActionOverlaysProps {
  actionName: string;
  menu: ActionMenuState;
  result: ActionResultState;
  onCloseMenu: () => void;
  onCloseResult: () => void;
  onRun: (item: HeaderItem) => void;
}

/**
 * The cursor-anchored action menu and the result modal for the pivot "Custom
 * Action" feature. Kept separate from PivotTable so the main component stays
 * within its complexity budget.
 */
export function CustomActionOverlays({
  actionName,
  menu,
  result,
  onCloseMenu,
  onCloseResult,
  onRun,
}: CustomActionOverlaysProps) {
  return (
    <>
      {menu &&
        // Render the menu through a body-level portal with a zero-size anchor at
        // the exact cursor position. Portaling to document.body (rather than
        // inline) keeps `position: fixed` relative to the viewport — the pivot
        // table lives inside transformed/scrolled containers, which would
        // otherwise shift a fixed anchor away from the click point.
        createPortal(
          <Menu
            opened
            onClose={onCloseMenu}
            position="bottom-start"
            offset={0}
            withinPortal
          >
            <Menu.Target>
              <div
                style={{
                  position: "fixed",
                  left: menu.x,
                  top: menu.y,
                  width: 0,
                  height: 0,
                }}
              />
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => onRun(menu.item)}>
                {actionName}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>,
          document.body,
        )}
      <Modal
        opened={result.open}
        onClose={onCloseResult}
        title={actionName || t`Custom action`}
        // Near-fullscreen: leave ~30px of margin around the modal on every side
        // so large HTML results have room. The body fills the remaining height
        // and scrolls.
        size="calc(100vw - 60px)"
        styles={{
          content: {
            height: "calc(100vh - 60px)",
            display: "flex",
            flexDirection: "column",
          },
          body: { flex: 1, overflow: "auto" },
        }}
        data-testid="pivot-custom-action-modal"
      >
        <CustomActionResult result={result} />
      </Modal>
    </>
  );
}

function CustomActionResult({ result }: { result: ActionResultState }) {
  if (result.loading) {
    return (
      <Center p="xl">
        <Loader />
      </Center>
    );
  }
  if (result.error) {
    return (
      <Text
        c="error"
        component="pre"
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          margin: 0,
          fontFamily: "var(--mb-default-monospace-font-family, monospace)",
        }}
        data-testid="pivot-custom-action-error"
      >
        {result.error}
      </Text>
    );
  }
  if (result.mode === "retention_projection") {
    return result.projection ? (
      <RetentionProjection data={result.projection} />
    ) : null;
  }
  // The action service is trusted to return display-ready HTML.
  return <div dangerouslySetInnerHTML={{ __html: result.html ?? "" }} />;
}
