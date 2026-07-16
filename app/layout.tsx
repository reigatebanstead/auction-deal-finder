import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auction Deal Finder",
  description: "Auction sourcing, eBay comparisons and resale intelligence",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
