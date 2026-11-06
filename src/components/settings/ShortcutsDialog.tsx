import { useUi } from "../../store/ui";
import { Dialog } from "../ui/overlays";
import { Kbd } from "../ui/primitives";

const groups: [string, [string, string][]][] = [
  [
    "Viewer",
    [
      ["← / →", "Previous / next image"],
      ["Mouse wheel", "Zoom at cursor"],
      ["Drag / middle-drag", "Pan"],
      ["Double-click", "Toggle fit / 100%"],
      ["0 / 1", "Fit / actual size"],
      ["+ / −", "Zoom in / out"],
      ["R / Shift+R", "Rotate right / left"],
      ["H / V", "Flip horizontal / vertical"],
      ["Ctrl+0", "Reset view"],
      ["Space", "Play Live Photo / pause animation"],
      ["F / F11", "Full screen"],
      ["I", "Information"],
      ["E", "Edit"],
      [". or L", "Favorite"],
      ["Delete", "Move to Trash"],
      ["Esc", "Exit full screen / close"],
    ],
  ],
  [
    "Library",
    [
      ["Arrows", "Move focus"],
      ["Enter", "Open"],
      ["Space", "Toggle selection"],
      ["Shift / Ctrl+click", "Range / toggle select"],
      ["Ctrl+A", "Select all"],
      ["F2", "Rename"],
      ["Delete", "Move to Trash"],
      ["Ctrl+C / Ctrl+Shift+C", "Copy image / path"],
      ["Ctrl+F", "Search"],
      ["Alt+← / Alt+→", "Back / forward"],
      ["Alt+↑ / Backspace", "Parent folder"],
      ["F5", "Reload"],
      ["F6", "Slideshow"],
      ["Ctrl+O", "Open folder"],
      ["Ctrl+B", "Toggle sidebar"],
      ["Ctrl+,", "Settings"],
    ],
  ],
];

export function ShortcutsDialog() {
  const open = useUi((s) => s.dialog === "shortcuts");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && useUi.getState().openDialog(null)} title="Keyboard shortcuts" className="w-[min(760px,94vw)]">
      <div className="grid grid-cols-2 gap-8">
        {groups.map(([title, rows]) => (
          <div key={title}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{title}</h3>
            {rows.map(([k, d]) => (
              <div key={k} className="flex items-center justify-between gap-3 py-1 text-[12px]">
                <span className="text-muted">{d}</span>
                <Kbd>{k}</Kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
