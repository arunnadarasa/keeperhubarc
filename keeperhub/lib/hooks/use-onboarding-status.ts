"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";

const DISMISSED_KEY = "keeperhub-onboarding-dismissed";

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

export type OnboardingStep = {
  id: string;
  complete: boolean;
};

type OnboardingStatus = {
  steps: OnboardingStep[];
  isLoading: boolean;
  allComplete: boolean;
  completedCount: number;
  refetch: () => void;
  hidden: boolean;
  hide: () => void;
  show: () => void;
};

function isFulfilledArray(result: PromiseSettledResult<unknown>): boolean {
  return (
    result.status === "fulfilled" &&
    Array.isArray(result.value) &&
    (result.value as unknown[]).length > 0
  );
}

export function useOnboardingStatus(): OnboardingStatus {
  const { data: session } = useSession();
  const [steps, setSteps] = useState<OnboardingStep[]>([
    { id: "create-workflow", complete: false },
    { id: "generate-api-key", complete: false },
    { id: "create-wallet", complete: false },
  ]);
  const [isLoading, setIsLoading] = useState(true);
  const [hidden, setHidden] = useState(isDismissed);
  const [refetchKey, setRefetchKey] = useState(0);

  const refetch = useCallback(() => {
    setRefetchKey((k) => k + 1);
  }, []);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetchKey intentionally triggers re-fetch
  useEffect(() => {
    if (!isAuthenticated) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchStatus(): Promise<void> {
      setIsLoading(true);

      const results = await Promise.allSettled([
        fetch("/api/workflows").then((r) => r.json()),
        fetch("/api/keeperhub/keys").then((r) => r.json()),
        fetch("/api/user/wallet").then((r) => r.json()),
      ]);

      if (cancelled) {
        return;
      }

      const [workflowsResult, keysResult, walletResult] = results;

      const hasWallet =
        walletResult.status === "fulfilled" &&
        (walletResult.value as { hasWallet?: boolean } | null)?.hasWallet ===
          true;

      setSteps([
        { id: "create-workflow", complete: isFulfilledArray(workflowsResult) },
        { id: "generate-api-key", complete: isFulfilledArray(keysResult) },
        { id: "create-wallet", complete: hasWallet },
      ]);
      setIsLoading(false);
    }

    fetchStatus();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, refetchKey]);

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
    refetch,
  };
}
