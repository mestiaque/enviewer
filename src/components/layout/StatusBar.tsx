import { formatBytes } from "../../lib/format";
import { useLibrary, useVisibleItems } from "../../store/library";
import { useViewer } from "../../store/viewer";
import { Spinner } from "../ui/primitives";

export function StatusBar() {
  const visible = useVisibleItems();
  const { selection, status, summary, probed, items, view, error } = useLibrary();
  const zoom = useViewer((s) => (s.open ? s.zoomPercent : null));
  const total = items.filter((i) => !i.companion).length;
  const images = items.filter((i) => i.kind === "image").length;
  const selectedBytes = selection.size ? items.filter((i) => selection.has(i.path)).reduce((n, i) => n + i.size, 0) : 0;

  let statusText: string | null = null;
  if (status === "listing") statusText = "Scanning folder…";
  else if (status === "probing") statusText = `Reading metadata ${Math.min(probed, images)}/${images}`;
  else if (status === "error") statusText = error;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[11px] text-muted">
      {view.kind !== "home" && (
        <>
          <span>
            {visible.length === total ? `${total.toLocaleString()} items` : `${visible.length.toLocaleString()} of ${total.toLocaleString()} items`}
            {summary && summary.livePhotos > 0 && ` · ${summary.livePhotos} Live Photos`}
          </span>
          {selection.size > 0 && (
            <span className="text-fg">
              {selection.size.toLocaleString()} selected · {formatBytes(selectedBytes)}
            </span>
          )}
        </>
      )}
      {view.kind === "folder" && (
        <span className="min-w-0 flex-1 truncate" title={view.path}>
          {view.path}
        </span>
      )}
      {view.kind !== "folder" && <span className="flex-1" />}
      {statusText && (
        <span className={status === "error" ? "text-danger" : "flex items-center gap-1.5"}>
          {status !== "error" && <Spinner className="h-3 w-3" />}
          {statusText}
        </span>
      )}
      {zoom != null && <span className="tabular-nums">{Math.round(zoom)}%</span>}
    </footer>
  );
}
