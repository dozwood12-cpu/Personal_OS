import type { Metadata } from "next";
import "./globals.css";
import localFont from "next/font/local";
const montserrat = localFont({
  src: [
    {path: "../node_modules/@fontsource/montserrat/files/montserrat-latin-400-normal.woff2", weight: "400", style: "normal"},
    {path: "../node_modules/@fontsource/montserrat/files/montserrat-latin-500-normal.woff2", weight: "500", style: "normal"},
    {path: "../node_modules/@fontsource/montserrat/files/montserrat-latin-600-normal.woff2", weight: "600", style: "normal"},
    {path: "../node_modules/@fontsource/montserrat/files/montserrat-latin-700-normal.woff2", weight: "700", style: "normal"},
  ],
  variable: "--font-montserrat",
  display: "swap",
});
export const metadata: Metadata = {
  title: "ORBIT — Personal OS",
  description:
    "Your finances, focus, and future. One personal operating system.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className={montserrat.variable}>{children}</body>
    </html>
  );
}
