import { describe, it, expect, beforeAll } from "vitest";

const BASE_URL = "http://localhost:8080";

let adminToken: string;
let testBarcode: string;

beforeAll(async () => {
  // Login
  const loginRes = await fetch(`${BASE_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "sadnantahmid24@gmail.com",
      password: "Tahmid@24",
    }),
  });
  const loginBody = await loginRes.json();
  expect(loginBody.success).toBe(true);
  adminToken = loginBody.data.accessToken ?? loginBody.data.access_token;

  // Find an available IMEI from inventory
  const invRes = await fetch(
    `${BASE_URL}/v1/admin/inventory?status=AVAILABLE`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
    },
  );
  const invBody = await invRes.json();
  expect(invBody.success).toBe(true);
  const availableUnits = invBody.data;
  expect(availableUnits.length).toBeGreaterThan(0);
  testBarcode = availableUnits[0].imei_1;
  expect(testBarcode).toBeTruthy();
});

describe("POS Flow", () => {
  it("should lookup a barcode", async () => {
    const res = await fetch(
      `${BASE_URL}/v1/pos/lookup?barcode=${testBarcode}`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.inventory_unit.imei_1).toBe(testBarcode);
  });

  it("should complete a sale", async () => {
    const res = await fetch(`${BASE_URL}/v1/pos/sales`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        barcode: testBarcode,
        customer_name: "Vitest Buyer",
        customer_phone: "01700000000",
        final_sale_price: 45000,
        payment_method: "CASH",
      }),
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.items[0].profit).toBeDefined();
  });

  it("should reject duplicate sale", async () => {
    const res = await fetch(`${BASE_URL}/v1/pos/sales`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        barcode: testBarcode,
        customer_name: "Vitest Repeat",
        customer_phone: "01700000001",
        final_sale_price: 45000,
        payment_method: "CASH",
      }),
    });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/Barcode not found|no longer available/);
  });
});
