import { describe, it, expect, beforeAll } from "vitest";

const BASE_URL = "http://localhost:8080";
const CATALOG_URL = "http://localhost:4000";
const API_KEY = "shared-secret-key-change-me"; // must match your Catalog Engine .env

let adminToken: string;
let productId: string; // MongoDB _id

beforeAll(async () => {
  // 1. Login as admin
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

  // 2. Create a fresh test product in Catalog Engine
  const productRes = await fetch(`${CATALOG_URL}/api/products`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      sku: `TEST-INV-${Date.now()}`,
      brand: "Vitest",
      name: "Integration Test Phone",
      category: { primary: "Smartphones" },
      pricing: { retail_mrp: 50000 },
    }),
  });
  const productBody = await productRes.json();
  productId = productBody._id || productBody.id;
  expect(productId).toBeDefined();

  // 3. Sync CatalogRef to Main Core
  await fetch(`${BASE_URL}/v1/admin/catalog-ref/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ catalog_id: productId }),
  });
});

describe("Inventory Flow", () => {
  it("should add inventory units and list them", async () => {
    const ts = Date.now();

    // Add two units with unique IMEIs
    const addRes = await fetch(`${BASE_URL}/v1/admin/inventory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        catalog_id: productId,
        units: [
          {
            dealer_cost: 30000,
            retail_mrp: 50000,
            imei1: `TEST-IMEI-INV-${ts}-001`,
          },
          {
            dealer_cost: 30000,
            retail_mrp: 50000,
            imei1: `TEST-IMEI-INV-${ts}-002`,
            serial: `SN-${ts}-002`,
          },
        ],
      }),
    });
    const addBody = await addRes.json();
    expect(addBody.success).toBe(true);
    expect(addBody.data.units_added).toBe(2);

    // List inventory (admin view – decrypts IMEIs)
    const listRes = await fetch(`${BASE_URL}/v1/admin/inventory`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const listBody = await listRes.json();
    expect(listBody.success).toBe(true);
    const units = listBody.data;
    expect(units.length).toBeGreaterThanOrEqual(2);
    // Check that at least our new units appear (decrypted)
    const ourUnits = units.filter((u: any) =>
      u.imei_1?.startsWith(`TEST-IMEI-INV-${ts}`),
    );
    expect(ourUnits.length).toBe(2);
  });
});
