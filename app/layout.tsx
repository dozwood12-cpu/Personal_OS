import type { Metadata } from "next";
import "./globals.css";
import localFont from "next/font/local";
const zen = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-zen",
  display: "swap",
});
const mincho = localFont({
  src: "../node_modules/@fontsource/shippori-mincho/files/shippori-mincho-latin-400-normal.woff2",
  variable: "--font-mincho",
  display: "swap",
  weight: "400",
});
export const metadata: Metadata = {
  title: "ORBIT — Personal OS",
  description:
    "Your finances, focus, and future. One personal operating system.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${zen.variable} ${mincho.variable}`}>
      <body>{children}</body>
    </html>
  );
}
