"use client";

import { WalletProvider } from "@/lib/hooks";

export function Providers({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
