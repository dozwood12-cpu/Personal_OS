"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  blankTheme,
  slots,
  type ThemeConfig,
  type Preset,
} from "@/lib/personalization";
export type ThemeRows = { presets: Preset[]; rows: Record<string, unknown>[] };
export function configFromRows(rows: Record<string, unknown>[]): ThemeConfig {
  const t = blankTheme();
  for (const slot of slots) {
    const images = rows
      .filter((r) => r.slot === slot)
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    if (images.length) {
      const a = images[0];
      t[slot] = {
        overlay: Number(a.overlay),
        blur: Number(a.blur),
        x: Number(a.x),
        y: Number(a.y),
        zoom: Number(a.zoom),
        opacity: Number(a.opacity),
        animation: a.animation as ThemeConfig[typeof slot]["animation"],
        speed: Number(a.speed),
        intensity: Number(a.intensity),
        images: images.map((r) => ({
          path: String(r.path || ""),
          url: String(r.url),
        })),
      };
    }
  }
  return t;
}
const Context = createContext({
  theme: blankTheme(),
  reload: async () => {},
  catalog: { presets: [], rows: [] } as ThemeRows,
});
export function PersonalizeProvider({
  children,
  authenticated,
}: {
  children: ReactNode;
  authenticated: boolean;
}) {
  const [theme, setTheme] = useState(blankTheme),
    [catalog, setCatalog] = useState<ThemeRows>({ presets: [], rows: [] });
  async function reload() {
    try {
      const r = await fetch(
        authenticated ? "/api/personalize" : "/api/personalize/login",
      );
      if (!r.ok) return;
      const d = await r.json();
      if (authenticated) {
        setCatalog(d);
        setTheme(
          configFromRows(
            d.rows.filter((r: Record<string, unknown>) => r.is_active),
          ),
        );
      } else {
        const rows = d.rows.map((r: Record<string, unknown>) => ({
          ...r,
          slot: "login",
        }));
        setTheme(configFromRows(rows));
      }
    } catch {
      /* black fallback */
    }
  }
  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 45 * 60 * 1000);
    return () => clearInterval(id);
  }, [authenticated]);
  return (
    <Context.Provider value={{ theme, reload, catalog }}>
      {children}
    </Context.Provider>
  );
}
export const usePersonalization = () => useContext(Context);
