"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BILLING_ALERTS, BILLING_API } from "@/keeperhub/lib/billing/constants";
import {
  PLANS,
  type PlanName,
  type TierKey,
} from "@/keeperhub/lib/billing/plans";

type SubscriptionData = {
  subscription: {
    plan: string;
    tier: string | null;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    billingAlert: string | null;
    billingAlertUrl: string | null;
  };
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  trialing: "secondary",
  past_due: "destructive",
  canceled: "destructive",
  unpaid: "destructive",
  paused: "outline",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

function getRenewalMessage(
  status: string,
  cancelAtPeriodEnd: boolean,
  periodEnd: string | null
): { text: string; className: string } | null {
  if (!periodEnd) {
    return null;
  }

  const formattedDate = dateFormatter.format(new Date(periodEnd));

  if (status === "canceled") {
    return {
      text: `Your subscription was canceled. Access expired on ${formattedDate}.`,
      className: "text-destructive",
    };
  }

  if (status === "paused") {
    return {
      text: "Your subscription is paused. Resume it from the billing portal to restore access.",
      className: "text-yellow-500",
    };
  }

  if (cancelAtPeriodEnd) {
    return {
      text: `Your plan ends on ${formattedDate}. You will not be charged again.`,
      className: "text-muted-foreground",
    };
  }

  if (status === "trialing") {
    return {
      text: `Your trial ends on ${formattedDate}. After that, your subscription will begin.`,
      className: "text-muted-foreground",
    };
  }

  if (status === "past_due") {
    return {
      text: `Payment is past due. Please update your payment method before ${formattedDate} to avoid service interruption.`,
      className: "text-destructive",
    };
  }

  if (status === "active") {
    return {
      text: `Your subscription will auto-renew on ${formattedDate}.`,
      className: "text-muted-foreground",
    };
  }

  return null;
}

function BillingAlertBanner({
  alert,
  alertUrl,
  onManageBilling,
  portalLoading,
}: {
  alert: string;
  alertUrl: string | null;
  onManageBilling: () => void;
  portalLoading: boolean;
}): React.ReactElement | null {
  if (alert === BILLING_ALERTS.PAYMENT_ACTION_REQUIRED) {
    return (
      <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-600 dark:text-yellow-400">
        <p className="font-medium">Action required to complete your payment.</p>
        {alertUrl && (
          <a
            className="mt-1 inline-block underline underline-offset-2"
            href={alertUrl}
            rel="noopener"
            target="_blank"
          >
            Complete payment
          </a>
        )}
      </div>
    );
  }

  if (alert === BILLING_ALERTS.OVERDUE) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <p className="font-medium">
          Your invoice is overdue. Please update your payment method.
        </p>
        <Button
          className="mt-2"
          disabled={portalLoading}
          onClick={onManageBilling}
          size="sm"
          variant="destructive"
        >
          {portalLoading ? "Opening..." : "Manage Billing"}
        </Button>
      </div>
    );
  }

  if (alert === BILLING_ALERTS.PAYMENT_FAILED) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <p className="font-medium">
          Payment failed. Please update your payment method.
        </p>
        <Button
          className="mt-2"
          disabled={portalLoading}
          onClick={onManageBilling}
          size="sm"
          variant="destructive"
        >
          {portalLoading ? "Opening..." : "Manage Billing"}
        </Button>
      </div>
    );
  }

  return null;
}

export function BillingStatus(): React.ReactElement {
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    async function fetchSubscription(): Promise<void> {
      try {
        const response = await fetch(BILLING_API.SUBSCRIPTION);
        if (response.ok) {
          const result = (await response.json()) as SubscriptionData;
          setData(result);
        }
      } catch {
        // Silently fail - will show loading state
      } finally {
        setLoading(false);
      }
    }
    fetchSubscription().catch(() => undefined);
  }, []);

  async function handleManageBilling(): Promise<void> {
    setPortalLoading(true);
    try {
      const response = await fetch(BILLING_API.PORTAL, {
        method: "POST",
      });
      const result = (await response.json()) as {
        url?: string;
        error?: string;
      };

      if (!response.ok) {
        toast.error(result.error ?? "Failed to open billing portal");
        return;
      }

      if (result.url) {
        window.location.href = result.url;
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setPortalLoading(false);
    }
  }

  if (loading) {
    return (
      <Card className="bg-sidebar">
        <CardHeader>
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-8 w-28" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-5 w-36 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-72" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-24" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-16" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const sub = data?.subscription;
  const plan = (sub?.plan ?? "free") as PlanName;
  const planDef = PLANS[plan];
  const tier = sub?.tier as TierKey | null;
  const activeTier = tier ? planDef.tiers.find((t) => t.key === tier) : null;

  const renewalMessage = getRenewalMessage(
    sub?.status ?? "active",
    sub?.cancelAtPeriodEnd ?? false,
    sub?.currentPeriodEnd ?? null
  );

  const statusVariant = STATUS_VARIANT[sub?.status ?? "active"] ?? "outline";

  return (
    <Card className="bg-sidebar">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Current Plan</CardTitle>
          {plan !== "free" && (
            <Button
              disabled={portalLoading}
              onClick={handleManageBilling}
              size="sm"
              variant="outline"
            >
              {portalLoading ? "Opening..." : "Manage Billing"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {sub?.billingAlert && (
          <BillingAlertBanner
            alert={sub.billingAlert}
            alertUrl={sub.billingAlertUrl ?? null}
            onManageBilling={handleManageBilling}
            portalLoading={portalLoading}
          />
        )}

        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold">{planDef.name}</span>
          {activeTier && (
            <Badge variant="outline">
              {activeTier.executions.toLocaleString()} executions
            </Badge>
          )}
          <Badge variant={statusVariant}>{sub?.status ?? "active"}</Badge>
        </div>

        {renewalMessage && (
          <p className={`text-sm ${renewalMessage.className}`}>
            {renewalMessage.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
