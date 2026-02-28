import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "CREsolver Dashboard",
  description:
    "Decentralized prediction market resolution — Chainlink CRE + AI agents on Sepolia",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${GeistSans.variable} ${GeistMono.variable} min-h-screen bg-navy-900 text-slate-200 antialiased font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
