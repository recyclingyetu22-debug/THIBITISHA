import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProvider as PaymentProviderName } from "@prisma/client";

export interface CheckoutRequest {
  planId: string;
  amount: number; // minor units
  currency: string;
}

export interface CheckoutResult {
  checkoutId: string;
  providerTransactionId: string;
  provider: PaymentProviderName;
}

// The capabilities every real provider (Stripe, a regional/mobile-money
// gateway, Play/App Store billing, enterprise invoicing) will eventually
// implement — kept small and provider-agnostic on purpose. Only MockPaymentProvider
// exists this phase; nothing in billing.routes.ts or payment.service.ts
// assumes which provider is behind this interface.
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean;
}

// Fixed dev-only secret — this provider never touches real money, so a
// real secret-management story is Phase C territory (alongside the real
// provider selection).
const MOCK_WEBHOOK_SECRET = "mock-webhook-dev-secret";

export function signMockWebhookPayload(rawBody: string): string {
  return createHmac("sha256", MOCK_WEBHOOK_SECRET).update(rawBody).digest("hex");
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "MOCK" as const;

  async createCheckout(_request: CheckoutRequest): Promise<CheckoutResult> {
    return {
      checkoutId: randomUUID(),
      providerTransactionId: `mock_${randomUUID()}`,
      provider: this.name,
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = signMockWebhookPayload(rawBody);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    // Constant-time compare, and lengths must match first — timingSafeEqual
    // throws on mismatched buffer lengths rather than returning false.
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export function getPaymentProvider(): PaymentProvider {
  return new MockPaymentProvider();
}
