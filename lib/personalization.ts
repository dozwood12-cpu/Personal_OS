import { z } from "zod";
export const slots = [
  "login",
  "dashboard",
  "journal",
  "projects",
  "documents",
  "avatar",
  "sidebar",
] as const;
export type Slot = (typeof slots)[number];
export const slotInfo: Record<
  Slot,
  { name: string; size: string; ratio: string; max: number }
> = {
  login: {
    name: "Latar login",
    size: "1920 × 1080 px",
    ratio: "16 / 9",
    max: 5,
  },
  dashboard: {
    name: "Banner dashboard",
    size: "1600 × 400 px",
    ratio: "4 / 1",
    max: 5,
  },
  journal: {
    name: "Banner Jurnal Keuangan",
    size: "1600 × 400 px",
    ratio: "4 / 1",
    max: 5,
  },
  projects: {
    name: "Banner Project & MWBs",
    size: "1600 × 400 px",
    ratio: "4 / 1",
    max: 5,
  },
  documents: {
    name: "Banner Arsip Dokumen",
    size: "1600 × 400 px",
    ratio: "4 / 1",
    max: 5,
  },
  avatar: {
    name: "Avatar profil",
    size: "512 × 512 px",
    ratio: "1 / 1",
    max: 1,
  },
  sidebar: {
    name: "Latar sidebar",
    size: "480 × 1600 px",
    ratio: "3 / 10",
    max: 1,
  },
};
export const animationOptions = [
  "none",
  "kenburns",
  "crossfade",
  "parallax",
  "drift",
  "glow",
  "entrance",
] as const;
export const visualSchema = z.object({
  overlay: z.number().min(0).max(0.95),
  blur: z.number().min(0).max(20),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  zoom: z.number().min(1).max(2.5),
  opacity: z.number().min(0).max(1),
  animation: z.enum(animationOptions),
  speed: z.number().min(3).max(30),
  intensity: z.number().min(0).max(1),
});
export type Visual = z.infer<typeof visualSchema>;
export type Picture = { path: string; url: string };
export type SlotConfig = Visual & { images: Picture[] };
export type ThemeConfig = Record<Slot, SlotConfig>;
export type Preset = { id: string; name: string; is_active: boolean };
export const defaultVisual: Visual = {
  overlay: 0.5,
  blur: 0,
  x: 50,
  y: 50,
  zoom: 1,
  opacity: 1,
  animation: "none",
  speed: 8,
  intensity: 0.3,
};
export function blankTheme(): ThemeConfig {
  return Object.fromEntries(
    slots.map((slot) => [
      slot,
      {
        ...defaultVisual,
        overlay: slot === "avatar" ? 0 : slot === "login" ? 0.6 : 0.4,
        images: [],
      },
    ]),
  ) as unknown as ThemeConfig;
}
export const themeSchema = z.object(
  Object.fromEntries(
    slots.map((s) => [
      s,
      visualSchema.extend({
        images: z
          .array(
            z.object({
              path: z.string().regex(/^[a-f0-9-]+\.webp$/),
              url: z.string().default(""),
            }),
          )
          .max(slotInfo[s].max),
      }),
    ]),
  ),
) as unknown as z.ZodType<ThemeConfig>;
