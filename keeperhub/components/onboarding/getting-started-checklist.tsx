"use client";

import { Check, Info, KeyRound, Wallet, Workflow } from "lucide-react";
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
import { isAnonymousUser } from "@/keeperhub/lib/is-anonymous";
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

type StepRowProps = {
  config: StepConfig;
  isComplete: boolean;
  onAction: () => void;
};

function StepRow({
  config,
  isComplete,
  onAction,
}: StepRowProps): React.ReactElement {
  const Icon = config.icon;

  const handleClick = (e: React.MouseEvent): void => {
    if ((e.target as Element).closest("[data-checklist-tooltip]")) {
      return;
    }
    onAction();
  };

  return (
    <button
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden transition-colors select-none hover:bg-accent hover:text-accent-foreground",
        isComplete && "opacity-50"
      )}
      onClick={handleClick}
      type="button"
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          isComplete ? "text-emerald-500" : "text-muted-foreground"
        )}
      />
      <span className={cn(isComplete && "line-through")}>{config.title}</span>
      {config.extra ? (
        <span data-checklist-tooltip="">{config.extra}</span>
      ) : null}
      {isComplete && (
        <Check className="ml-auto size-3.5 shrink-0 text-emerald-500" />
      )}
    </button>
  );
}

function SkeletonRows(): React.ReactElement {
  return (
    <div className="space-y-0.5 p-1">
      {Array.from({ length: 3 }, (_, i) => (
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

export function GettingStartedChecklist({
  onCreateWorkflow,
}: GettingStartedChecklistProps): React.ReactElement | null {
  const {
    steps,
    isLoading,
    allComplete,
    completedCount,
    hidden,
    hide,
    show,
    refetch,
  } = useOnboardingStatus();
  const { open: openOverlay } = useOverlay();
  const { data: session } = useSession();
  const authTriggerRef = useRef<HTMLButtonElement>(null);

  const isAnonymous = isAnonymousUser(session?.user);

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
      action: () =>
        openOverlay(ApiKeysOverlay, undefined, { onClose: refetch }),
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
              Non-custodial wallet powered by{" "}
              <a
                className="underline"
                href="https://www.getpara.com/"
                rel="noopener noreferrer"
                target="_blank"
              >
                Para
              </a>
              . Works across multiple networks.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
      action: () => openOverlay(WalletOverlay, undefined, { onClose: refetch }),
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
                const action =
                  isAnonymous && config.requiresAuth
                    ? promptSignIn
                    : config.action;

                return (
                  <StepRow
                    config={config}
                    isComplete={isComplete}
                    key={config.id}
                    onAction={action}
                  />
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

      <p className="mt-1.5 text-center text-base tracking-wide text-muted-foreground/40">
        Read{" "}
        <a
          className="underline decoration-muted-foreground/20 underline-offset-2 transition-colors hover:text-muted-foreground hover:decoration-muted-foreground/40"
          href="https://docs.keeperhub.com/"
          rel="noopener noreferrer"
          target="_blank"
        >
          docs
        </a>
      </p>
    </div>
  );
}
