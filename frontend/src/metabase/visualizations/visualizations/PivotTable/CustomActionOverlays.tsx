import { t } from "ttag";

import { Center, Loader, Menu, Modal, Text } from "metabase/ui";

import type { HeaderItem } from "./types";

type ActionMenuState = { x: number; y: number; item: HeaderItem } | null;

type ActionResultState = {
  open: boolean;
  loading: boolean;
  html: string | null;
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
      {menu && (
        <Menu opened onClose={onCloseMenu} position="bottom-start" withinPortal>
          <Menu.Target>
            {/* Zero-size anchor positioned at the cursor so the menu opens
                where the user right-clicked. */}
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
            <Menu.Item onClick={() => onRun(menu.item)}>{actionName}</Menu.Item>
          </Menu.Dropdown>
        </Menu>
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
    return <Text c="error">{result.error}</Text>;
  }
  // The action service is trusted to return display-ready HTML.
  return <div dangerouslySetInnerHTML={{ __html: result.html ?? "" }} />;
}
