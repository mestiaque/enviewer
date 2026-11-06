import { create } from "zustand";
import { api } from "../lib/api";

export interface Settings {
  // General
  startup: "home" | "lastFolder" | "defaultLocation";
  defaultLocation: string | null;
  rememberLastFolder: boolean;
  lastFolder: string | null;
  showHidden: boolean;
  confirmTrash: boolean;
  // Appearance
  theme: "dark" | "light" | "glass" | "system";
  accent: string;
  gridSize: "small" | "medium" | "large";
  gridLayout: "grid" | "justified";
  showFilenames: boolean;
  animations: boolean;
  sidebarCollapsed: boolean;
  // Viewer
  defaultZoom: "fit" | "fitLarge" | "actual";
  zoomSpeed: number;
  smoothZoom: boolean;
  minZoom: number; // percent
  maxZoom: number; // percent
  viewerBackground: "black" | "dark" | "gray" | "checker" | "theme";
  /** Look of the image viewer and video player. */
  viewerTheme: "dark" | "light" | "glass";
  wrapNavigation: boolean;
  mouseSideButtons: boolean;
  touchpadSwipe: boolean;
  autoHideControls: boolean;
  pixelatedZoom: boolean;
  livePhotoHover: boolean;
  // Performance
  thumbCacheMb: number;
  memoryCacheMb: number;
  preloadCount: number;
  // Formats
  rawMode: "embedded" | "develop";
  disabledFormats: string[];
  // Privacy
  keepHistory: boolean;
  checkUpdates: boolean;
  showGps: boolean;
  // Slideshow
  slideshowInterval: number;
  slideshowLoop: boolean;
  slideshowRandom: boolean;
  slideshowTransition: "fade" | "slide" | "slideUp" | "zoom" | "blur" | "random" | "none";
}

export const DEFAULT_SETTINGS: Settings = {
  startup: "home",
  defaultLocation: null,
  rememberLastFolder: true,
  lastFolder: null,
  showHidden: false,
  confirmTrash: true,
  theme: "dark",
  accent: "#3b82f6",
  gridSize: "medium",
  gridLayout: "grid",
  showFilenames: true,
  animations: true,
  sidebarCollapsed: false,
  defaultZoom: "fitLarge",
  zoomSpeed: 0.2,
  smoothZoom: true,
  minZoom: 2,
  maxZoom: 3200,
  viewerBackground: "dark",
  viewerTheme: "dark",
  wrapNavigation: true,
  mouseSideButtons: true,
  touchpadSwipe: true,
  autoHideControls: true,
  pixelatedZoom: true,
  livePhotoHover: true,
  thumbCacheMb: 1024,
  memoryCacheMb: 512,
  preloadCount: 2,
  rawMode: "embedded",
  disabledFormats: [],
  keepHistory: true,
  checkUpdates: true,
  showGps: true,
  slideshowInterval: 4,
  slideshowLoop: true,
  slideshowRandom: false,
  slideshowTransition: "fade",
};

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  load(): Promise<void>;
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    try {
      const stored = await api.getSettings();
      const merged = { ...DEFAULT_SETTINGS };
      for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
        if (k in stored && typeof stored[k] === typeof DEFAULT_SETTINGS[k]) (merged as Record<string, unknown>)[k] = stored[k];
        else if (k in stored && DEFAULT_SETTINGS[k] === null) (merged as Record<string, unknown>)[k] = stored[k];
      }
      set({ settings: merged, loaded: true });
    } catch (e) {
      console.error("settings load failed", e);
      set({ loaded: true });
    }
  },
  set(key, value) {
    if (get().settings[key] === value) return;
    set({ settings: { ...get().settings, [key]: value } });
    api.setSetting(key, value).catch((e) => console.error("setting save failed", e));
  },
}));

export const setting = <K extends keyof Settings>(k: K) => useSettings.getState().settings[k];

/** Grid tile target sizes (CSS px). */
export const GRID_SIZES = { small: 120, medium: 180, large: 270 } as const;
