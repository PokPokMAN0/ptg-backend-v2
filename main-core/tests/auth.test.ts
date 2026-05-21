import { describe, it, expect } from "vitest";

const BASE_URL = "http://localhost:8080";

describe("Health Check", () => {
  it("should return ok", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
  });
});

describe("Authentication", () => {
  it("should login with admin credentials", async () => {
    const res = await fetch(`${BASE_URL}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "sadnantahmid24@gmail.com",
        password: "Tahmid@24",
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeDefined();
  });

  it("should reject invalid credentials", async () => {
    const res = await fetch(`${BASE_URL}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@prime.com", password: "wrong" }),
    });
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });
});
