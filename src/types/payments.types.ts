export type StripeSessionDetails = {
  id: string;
  amount_total?: number | null;
  currency?: string | null;
  customer_email?: string | null;
  payment_status?: string | null;
  subscription?: unknown;
  payment_intent?: unknown;
  customer?: unknown;
  metadata?: Record<string, unknown> | null;
  status?: string | null;
  url?: string | null;
  error?: string;
};

export type PayPalDetails = {
  id?: string;
  status?: string;
  plan_id?: string;
  subscriber?: {
    email_address?: string;
    payer_id?: string;
    name?: { given_name?: string; surname?: string };
    [key: string]: unknown;
  };
  create_time?: string;
  update_time?: string;
  custom_id?: string;
  beneficiary_name?: string;
  [key: string]: unknown;
};

export type StripeStatus = {
  provider: "stripe";
  status: "success" | "error";
  message: string;
  details?: StripeSessionDetails;
};

export type PayPalStatus = {
  provider: "paypal";
  status: "success" | "error";
  message: string;
  details?: PayPalDetails;
};

export type PaymentStatus =
  | StripeStatus
  | PayPalStatus
  | { provider: "unknown"; status: "error"; message: string };
