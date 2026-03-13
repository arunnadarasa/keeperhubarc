import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BillingPage } from "@/components/billing/billing-page";
import { isBillingEnabled } from "@/lib/billing/feature-flag";

export default function BillingRoute(): React.ReactElement {
  if (!isBillingEnabled()) {
    notFound();
  }

  return (
    <Suspense>
      <BillingPage />
    </Suspense>
  );
}
