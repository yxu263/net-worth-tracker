import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Net Worth Tracker",
  description: "A private, local-first net worth tracker."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
