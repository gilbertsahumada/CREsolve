import type { Metadata } from "next";
import "./globals.css";

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
      <body className="min-h-screen bg-navy-900 text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
