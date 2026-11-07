import { create } from "zustand";
import { api, errorMessage, type UpdateInfo } from "../lib/api";
import { toast } from "./ui";


interface UpdateStore {
  available: UpdateInfo | null;
  dialogOpen: boolean;
  checking: boolean;
  /** Ask GitHub for a newer release. Manual checks report "up to date" and errors too. */
  check(manual: boolean): Promise<string>;
  open(): void;
  close(): void;
}

export const useUpdate = create<UpdateStore>((set, get) => ({
  available: null,
  dialogOpen: false,
  checking: false,
  async check(manual) {
    if (get().checking) return "Checking…";
    set({ checking: true });
    try {
      const info = await api.checkUpdate();
      set({ available: info });
      if (!info) return "You have the latest version";
      if (manual) set({ dialogOpen: true });
      else toast({ kind: "info", title: `ENViewer ${info.version} is available`, action: { label: "Update", run: () => get().open() } }, 30000);
      return `ENViewer ${info.version} is available`;
    } catch (e) {
      const msg = "Could not check for updates. Are you online?";
      if (manual) toast({ kind: "error", title: msg, detail: errorMessage(e) });
      return msg;
    } finally {
      set({ checking: false });
    }
  },
  open: () => set({ dialogOpen: true }),
  close: () => set({ dialogOpen: false }),
}));

/** Quiet check a few seconds after every start. */
export function scheduleUpdateCheck(enabled: boolean) {
  if (!enabled) return () => {};
  const t = window.setTimeout(() => void useUpdate.getState().check(false), 8000);
  return () => window.clearTimeout(t);
}
