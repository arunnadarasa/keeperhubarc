"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";

const DISMISSED_KEY = "keeperhub-onboarding-dismissed";

export type OnboardingStep = {
  id: string;
  complete: boolean;
};

type OnboardingStatus = {
  steps: OnboardingStep[];
  isLoading: boolean;
  allComplete: boolean;
  completedCount: number;
  hidden: boolean;
  hide: () => void;
  show: () => void;
};

function isDismissed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return localStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

function isFulfilledArray(result: PromiseSettledResult<unknown>): boolean {
  return (
    result.status === "fulfilled" &&
    Array.isArray(result.value) &&
    (result.value as unknown[]).length > 0
  );
}

type ChainBalanceData = {
  nativeBalance?: string;
  tokens?: { balance?: string }[];
};

function chainHasFunds(chain: ChainBalanceData): boolean {
  if (chain.nativeBalance && chain.nativeBalance !== "0") {
    return true;
  }
  if (!Array.isArray(chain.tokens)) {
    return false;
  }
  return chain.tokens.some((t) => t.balance && t.balance !== "0");
}

function hasNonZeroBalance(result: PromiseSettledResult<unknown>): boolean {
  if (result.status !== "fulfilled" || !Array.isArray(result.value)) {
    return false;
  }
  return (result.value as ChainBalanceData[]).some(chainHasFunds);
}

export function useOnboardingStatus(): OnboardingStatus {
  const { data: session } = useSession();
  const [steps, setSteps] = useState<OnboardingStep[]>([
    { id: "create-workflow", complete: false },
    { id: "generate-api-key", complete: false },
    { id: "create-wallet", complete: false },
    { id: "fund-wallet", complete: false },
  ]);
  const [isLoading, setIsLoading] = useState(true);
  const [hidden, setHidden] = useState(isDismissed);

  const isAuthenticated = Boolean(session?.user);

  const hide = useCallback(() => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // localStorage unavailable
    }
  }, []);

  const show = useCallback(() => {
    setHidden(false);
    try {
      localStorage.removeItem(DISMISSED_KEY);
    } catch {
      // localStorage unavailable
    }
  }, []);

  useEffect(() => {
    if (hidden) {
      setIsLoading(false);
      return;
    }

    if (!isAuthenticated) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchStatus(): Promise<void> {
      setIsLoading(true);

      const results = await Promise.allSettled([
        fetch("/api/workflows").then((r) => r.json()),
        fetch("/api/api-keys").then((r) => r.json()),
        fetch("/api/user/wallet").then((r) => r.json()),
        fetch("/api/user/wallet/balances").then((r) => r.json()),
      ]);

      if (cancelled) {
        return;
      }

      const [workflowsResult, keysResult, walletResult, balancesResult] =
        results;

      const hasWallet =
        walletResult.status === "fulfilled" &&
        (walletResult.value as { hasWallet?: boolean } | null)?.hasWallet ===
          true;

      setSteps([
        { id: "create-workflow", complete: isFulfilledArray(workflowsResult) },
        { id: "generate-api-key", complete: isFulfilledArray(keysResult) },
        { id: "create-wallet", complete: hasWallet },
        { id: "fund-wallet", complete: hasNonZeroBalance(balancesResult) },
      ]);
      setIsLoading(false);
    }

    fetchStatus();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, hidden]);

  const completedCount = steps.filter((s) => s.complete).length;
  const allComplete = completedCount === steps.length;

  return {
    steps,
    isLoading,
    allComplete,
    completedCount,
    hidden,
    hide,
    show,
  };
}
