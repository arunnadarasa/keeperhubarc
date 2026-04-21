"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";

export type WalletInfoState = {
  hasWallet: boolean;
  walletAddress: string | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

type WalletResponse = {
  hasWallet?: boolean;
  walletAddress?: string;
};

/**
 * Lightweight hook that tracks whether the active organization has a wallet
 * and exposes the primary address. Safe to mount in shared chrome (toolbar)
 * because it short-circuits for anonymous sessions.
 */
export function useWalletInfo(): WalletInfoState {
  const { data: session } = useSession();
  const [hasWallet, setHasWallet] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const sessionUserId = session?.user?.id;
  const email = session?.user?.email;
  const isAuthed =
    !!sessionUserId &&
    !!email &&
    !email.startsWith("temp-") &&
    session?.user?.emailVerified === true;

  const refresh = useCallback(async (): Promise<void> => {
    if (!isAuthed) {
      setHasWallet(false);
      setWalletAddress(null);
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch("/api/user/wallet");
      if (!response.ok) {
        setHasWallet(false);
        setWalletAddress(null);
        return;
      }
      const data = (await response.json()) as WalletResponse;
      if (data.hasWallet && data.walletAddress) {
        setHasWallet(true);
        setWalletAddress(data.walletAddress);
      } else {
        setHasWallet(false);
        setWalletAddress(null);
      }
    } catch {
      setHasWallet(false);
      setWalletAddress(null);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthed]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { hasWallet, walletAddress, isLoading, refresh };
}
