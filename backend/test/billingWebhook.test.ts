import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { signMockWebhookPayload } from "../src/modules/billing/paymentProvider.js";

const app = createApp();

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

let planId: string;

async function registerOrg() {
  const res = await request(app).post("/auth/register-organization").send({
    organizationName: `Webhook Test Org ${Date.now()}-${Math.random()}`,
    adminName: "Admin",
    email: uniqueEmail("webhook"),
    password: "correct-horse-battery",
  });
  return res.body.accessToken as string;
}

async function createCheckoutFor(accessToken: string) {
  const res = await request(app).post("/billing/checkout").set("Authorization", `Bearer ${accessToken}`).send({ planId });
  expect(res.status).toBe(201);
  return res.body as { providerTransactionId: string; amount: number; currency: string };
}

// Passing the plain object (not a pre-stringified string) to .send() lets
// supertest/superagent do its own JSON.stringify — which, for a simple
// object, produces byte-identical output to calling JSON.stringify(payload)
// ourselves for the signature. Passing an already-stringified string here
// instead double-encodes it (superagent still JSON.stringifies the string
// value), producing different wire bytes than the signature was computed
// over and making every signature check fail.
function post(payload: object, signature: string) {
  return request(app).post("/billing/webhooks/mock").set("x-webhook-signature", signature).send(payload);
}

describe("billing webhook", () => {
  beforeAll(async () => {
    const plan = await prisma.plan.upsert({
      where: { key: "webhook_test_package" },
      create: { key: "webhook_test_package", name: "Webhook Test Package", category: "INDIVIDUAL_PAID", billingInterval: "ONE_TIME", allowancePerPeriod: 10 },
      update: { active: true, allowancePerPeriod: 10 },
    });
    planId = plan.id;
    const existingPricing = await prisma.pricing.findFirst({ where: { planId, currency: "USD", country: null } });
    if (!existingPricing) {
      await prisma.pricing.create({ data: { planId, currency: "USD", amount: 999, country: null } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("grants entitlement on a correctly-signed PAID webhook", async () => {
    const accessToken = await registerOrg();
    const before = await request(app).get("/billing/account").set("Authorization", `Bearer ${accessToken}`);
    const startingBalance = before.body.balance ?? 0;
    const checkout = await createCheckoutFor(accessToken);

    const payload = { providerTransactionId: checkout.providerTransactionId, status: "PAID", amount: checkout.amount, currency: checkout.currency };
    const res = await post(payload, signMockWebhookPayload(JSON.stringify(payload)));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ granted: true, amount: 10 });

    const account = await request(app).get("/billing/account").set("Authorization", `Bearer ${accessToken}`);
    expect(account.body.balance).toBe(startingBalance + 10);
  });

  it("does not grant a second time when the exact same webhook is replayed", async () => {
    const accessToken = await registerOrg();
    const before = await request(app).get("/billing/account").set("Authorization", `Bearer ${accessToken}`);
    const startingBalance = before.body.balance ?? 0;
    const checkout = await createCheckoutFor(accessToken);
    const payload = { providerTransactionId: checkout.providerTransactionId, status: "PAID", amount: checkout.amount, currency: checkout.currency };
    const signature = signMockWebhookPayload(JSON.stringify(payload));

    const first = await post(payload, signature);
    expect(first.status).toBe(200);
    expect(first.body.granted).toBe(true);

    const replay = await post(payload, signature);
    expect(replay.status).toBe(200);
    expect(replay.body.granted).toBe(false);

    const account = await request(app).get("/billing/account").set("Authorization", `Bearer ${accessToken}`);
    expect(account.body.balance).toBe(startingBalance + 10); // not +20
  });

  it("rejects a webhook with an invalid signature", async () => {
    const accessToken = await registerOrg();
    const checkout = await createCheckoutFor(accessToken);
    const payload = { providerTransactionId: checkout.providerTransactionId, status: "PAID", amount: checkout.amount, currency: checkout.currency };
    // Not assumed to be 0 — another test file's free-grant plan may already
    // have granted this org a starting balance; the assertion is that a
    // rejected webhook leaves it unchanged either way.
    const before = await request(app).get("/billing/account").set("Authorization", `Bearer ${accessToken}`);

    const res = await post(payload, "0".repeat(64));
    expect(res.status).toBe(401);

    const after = await request(app).get("/billing/account").set("Authorization", `Bearer ${accessToken}`);
    expect(after.body.balance).toBe(before.body.balance);
  });

  it("rejects a webhook whose amount doesn't match the checkout", async () => {
    const accessToken = await registerOrg();
    const checkout = await createCheckoutFor(accessToken);
    const payload = { providerTransactionId: checkout.providerTransactionId, status: "PAID", amount: checkout.amount + 1, currency: checkout.currency };
    const before = await request(app).get("/billing/account").set("Authorization", `Bearer ${accessToken}`);

    const res = await post(payload, signMockWebhookPayload(JSON.stringify(payload)));
    expect(res.status).toBe(422);

    const after = await request(app).get("/billing/account").set("Authorization", `Bearer ${accessToken}`);
    expect(after.body.balance).toBe(before.body.balance);
  });
});
