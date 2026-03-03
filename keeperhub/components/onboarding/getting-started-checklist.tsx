"use client";

import { Check, Coins, Info, KeyRound, Wallet, Workflow } from "lucide-react";
import { useRef } from "react";
import { AuthDialog } from "@/components/auth/dialog";
import { ApiKeysOverlay } from "@/components/overlays/api-keys-overlay";
import { useOverlay } from "@/components/overlays/overlay-provider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WalletOverlay } from "@/keeperhub/components/overlays/wallet-overlay";
import { useOnboardingStatus } from "@/keeperhub/lib/hooks/use-onboarding-status";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type StepConfig = {
  id: string;
  icon: typeof Workflow;
  title: string;
  extra?: React.ReactNode;
  requiresAuth: boolean;
  action: () => void;
};

type GettingStartedChecklistProps = {
  onCreateWorkflow?: () => void;
};

function ProgressBar({
  completed,
  total,
}: {
  completed: number;
  total: number;
}): React.ReactElement {
  const percentage = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="h-1 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-emerald-500 transition-all duration-500"
        style={{ width: `${Math.max(8, percentage)}%` }}
      />
    </div>
  );
}

function SkeletonRows(): React.ReactElement {
  return (
    <div className="space-y-0.5 p-1">
      {Array.from({ length: 4 }, (_, i) => (
        <div
          className="flex items-center gap-2 rounded-sm px-2 py-1.5"
          key={`skeleton-${String(i)}`}
        >
          <div className="size-4 animate-pulse rounded bg-muted" />
          <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function isAnonymousSession(
  user: {
    name?: string | null;
    email?: string | null;
  } | null
): boolean {
  if (!user) {
    return true;
  }
  return (
    user.name === "Anonymous" ||
    Boolean(user.email?.includes("@http://")) ||
    Boolean(user.email?.includes("@https://")) ||
    Boolean(user.email?.startsWith("temp-"))
  );
}

export function GettingStartedChecklist({
  onCreateWorkflow,
}: GettingStartedChecklistProps): React.ReactElement | null {
  const { steps, isLoading, allComplete, completedCount, hidden, hide, show } =
    useOnboardingStatus();
  const { open: openOverlay } = useOverlay();
  const { data: session } = useSession();
  const authTriggerRef = useRef<HTMLButtonElement>(null);

  const isAnonymous = isAnonymousSession(session?.user ?? null);

  if (allComplete) {
    return null;
  }

  const promptSignIn = (): void => {
    authTriggerRef.current?.click();
  };

  const stepConfigs: StepConfig[] = [
    {
      id: "create-workflow",
      icon: Workflow,
      title: "Create a Workflow",
      requiresAuth: false,
      action: () => onCreateWorkflow?.(),
    },
    {
      id: "generate-api-key",
      icon: KeyRound,
      title: "Generate API Key",
      requiresAuth: true,
      extra: (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="size-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="text-xs" side="top">
              See{" "}
              <a
                className="underline"
                href="https://docs.keeperhub.com/ai-tools/mcp-server"
                rel="noopener noreferrer"
                target="_blank"
              >
                MCP docs
              </a>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
      action: () => openOverlay(ApiKeysOverlay),
    },
    {
      id: "create-wallet",
      icon: Wallet,
      title: "Create Wallet",
      requiresAuth: true,
      extra: (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="size-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64 text-xs" side="top">
              Powered by{" "}
              <a
                className="underline"
                href="https://www.getpara.com/"
                rel="noopener noreferrer"
                target="_blank"
              >
                Para
              </a>
              , enterprise-grade MPC wallet infrastructure
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
      action: () => openOverlay(WalletOverlay),
    },
    {
      id: "fund-wallet",
      icon: Coins,
      title: "Fund Wallet",
      requiresAuth: true,
      extra: (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="size-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="text-xs" side="top">
              Your wallet works across multiple networks
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
      action: () => openOverlay(WalletOverlay),
    },
  ];

  return (
    <div className="w-full min-w-[14rem] max-w-[16rem]">
      {hidden ? (
        <button
          className="flex w-full items-center gap-2 px-3 py-1.5 transition-opacity hover:opacity-80"
          onClick={show}
          type="button"
        >
          <div className="h-px flex-1 bg-border/40" />
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Setup Guide
          </span>
          <div className="h-px flex-1 bg-border/40" />
        </button>
      ) : (
        <div className="rounded-md border bg-popover p-1 shadow-md">
          <AuthDialog>
            <button className="hidden" ref={authTriggerRef} type="button" />
          </AuthDialog>

          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="font-medium text-sm">Setup Guide</span>
            <button
              className="text-muted-foreground text-xs transition-colors hover:text-foreground"
              onClick={hide}
              type="button"
            >
              Hide
            </button>
          </div>

          <div className="-mx-1 my-1 h-px bg-border" />

          {isLoading ? (
            <SkeletonRows />
          ) : (
            <div>
              {stepConfigs.map((config) => {
                const step = steps.find((s) => s.id === config.id);
                const isComplete = step?.complete ?? false;
                const Icon = config.icon;
                const handleClick =
                  isAnonymous && config.requiresAuth
                    ? promptSignIn
                    : config.action;

                return (
                  <button
                    className={cn(
                      "relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden transition-colors select-none hover:bg-accent hover:text-accent-foreground",
                      isComplete && "opacity-50"
                    )}
                    key={config.id}
                    onClick={handleClick}
                    type="button"
                  >
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        isComplete
                          ? "text-emerald-500"
                          : "text-muted-foreground"
                      )}
                    />
                    <span className={cn(isComplete && "line-through")}>
                      {config.title}
                    </span>
                    {config.extra}
                    {isComplete && (
                      <Check className="ml-auto size-3.5 shrink-0 text-emerald-500" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="-mx-1 my-1 h-px bg-border" />

          <div className="px-2 py-1.5">
            {isLoading ? (
              <div className="h-1 w-full animate-pulse rounded-full bg-muted" />
            ) : (
              <ProgressBar completed={completedCount} total={steps.length} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
