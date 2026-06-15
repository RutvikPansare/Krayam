import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Krayam — Procurement Intelligence for Indian Manufacturers",
  description:
    "Krayam sits on top of SAP and automates the entire purchase cycle — from raising a request to placing an order — while eliminating the duplicate inventory problem that costs manufacturers crores every year.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#0B2239",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body>{children}</body>
    </html>
  );
}
