export type CreateCheckoutParams = {
  customerId: string;
  priceId: string;
  organizationId: string;
  successUrl: string;
  cancelUrl: string;
};

export type CreateCustomerParams = {
  email: string;
  organizationId: string;
  userId: string;
};

export type BillingWebhookEvent = {
  type:
    | "checkout.completed"
    | "subscription.updated"
    | "subscription.deleted"
    | "invoice.paid"
    | "invoice.payment_failed"
    | "invoice.overdue"
    | "invoice.payment_action_required";
  providerEventId: string;
  data: {
    providerSubscriptionId?: string;
    providerCustomerId?: string;
    organizationId?: string;
    priceId?: string;
    status?: string;
    cancelAtPeriodEnd?: boolean;
    periodStart?: Date;
    periodEnd?: Date | null;
    invoiceUrl?: string;
  };
};

export type InvoiceItem = {
  id: string;
  date: Date;
  amount: number;
  currency: string;
  status: "paid" | "open" | "void" | "draft" | "uncollectible";
  description: string;
  periodStart: Date;
  periodEnd: Date;
  invoiceUrl: string | null;
  pdfUrl: string | null;
};

export type ListInvoicesParams = {
  customerId: string;
  limit: number;
  startingAfter?: string;
};

export type ListInvoicesResult = {
  invoices: InvoiceItem[];
  hasMore: boolean;
};

export type SubscriptionDetails = {
  priceId: string | undefined;
  status: string;
  cancelAtPeriodEnd: boolean;
  periodStart: Date;
  periodEnd: Date | null;
};

export type ProrationPreview = {
  amountDue: number;
  currency: string;
  periodEnd: Date | null;
  lineItems: {
    description: string;
    amount: number;
    proration: boolean;
  }[];
};

export interface BillingProvider {
  readonly name: string;

  createCustomer(params: CreateCustomerParams): Promise<{ customerId: string }>;

  createCheckoutSession(params: CreateCheckoutParams): Promise<{ url: string }>;

  createPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<{ url: string }>;

  verifyWebhook(body: string, signature: string): Promise<BillingWebhookEvent>;

  getSubscriptionDetails(subscriptionId: string): Promise<SubscriptionDetails>;

  listInvoices(params: ListInvoicesParams): Promise<ListInvoicesResult>;

  updateSubscription(
    subscriptionId: string,
    newPriceId: string
  ): Promise<{ subscriptionId: string }>;

  cancelSubscription(
    subscriptionId: string
  ): Promise<{ cancelAtPeriodEnd: boolean; periodEnd: Date | null }>;

  previewProration(
    subscriptionId: string,
    newPriceId: string
  ): Promise<ProrationPreview>;
}
