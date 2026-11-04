import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Net Worth Tracker",
  description: "A private, local-first net worth tracker.",
  // Opens full screen with its own name when added to the iPhone home screen.
  appleWebApp: { capable: true, title: "Net Worth", statusBarStyle: "default" }
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
