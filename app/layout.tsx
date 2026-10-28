import type { Metadata } from "next";
import "./globals.css";
import localFont from "next/font/local";
const inter = localFont({
  src: "../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2",
  variable: "--font-inter",
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
      <body className={inter.variable}>{children}</body>
    </html>
  );
}
