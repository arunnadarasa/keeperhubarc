import { notFound } from "next/navigation";
import { BillingPage } from "@/keeperhub/components/billing/billing-page";
import { isBillingEnabled } from "@/keeperhub/lib/billing/feature-flag";

export default function BillingRoute(): React.ReactElement {
  if (!isBillingEnabled()) {
    notFound();
  }

  return <BillingPage />;
}
