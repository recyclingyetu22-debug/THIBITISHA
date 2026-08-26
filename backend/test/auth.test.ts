import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";

const app = createApp();

function uniqueEmail() {
  return `admin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

describe("auth", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("registers a new organization + admin user and returns tokens", async () => {
    const email = uniqueEmail();
    const res = await request(app).post("/auth/register-organization").send({
      organizationName: "Acme University",
      adminName: "Ada Admin",
      email,
      password: "correct-horse-battery",
    });

    expect(res.status).toBe(201);
    expect(res.body.organization.name).toBe("Acme University");
    expect(res.body.user.roles).toEqual(["ORG_ADMIN"]);
    expect(res.body.accessToken).toBeTypeOf("string");
    expect(res.body.refreshToken).toBeTypeOf("string");
  });

  it("rejects registering the same email twice", async () => {
    const email = uniqueEmail();
    await request(app).post("/auth/register-organization").send({
      organizationName: "Acme University",
      adminName: "Ada Admin",
      email,
      password: "correct-horse-battery",
    });

    const res = await request(app).post("/auth/register-organization").send({
      organizationName: "Other Org",
      adminName: "Bob Admin",
      email,
      password: "correct-horse-battery",
    });

    expect(res.status).toBe(409);
  });

  it("logs in with correct credentials and rejects wrong password", async () => {
    const email = uniqueEmail();
    await request(app).post("/auth/register-organization").send({
      organizationName: "Acme University",
      adminName: "Ada Admin",
      email,
      password: "correct-horse-battery",
    });

    const goodLogin = await request(app).post("/auth/login").send({ email, password: "correct-horse-battery" });
    expect(goodLogin.status).toBe(200);
    expect(goodLogin.body.accessToken).toBeTypeOf("string");

    const badLogin = await request(app).post("/auth/login").send({ email, password: "wrong-password" });
    expect(badLogin.status).toBe(401);
  });

  it("rejects login for an unknown email without leaking which field was wrong", async () => {
    const res = await request(app).post("/auth/login").send({ email: uniqueEmail(), password: "whatever123" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });
});
