// =============================================================================
// Prime Tech Gallery — Business Rules Engine
// Cross‑cutting logic for catalog validation, stock sync, profit, etc.
// =============================================================================

import axios from "axios";
import { config } from "./config";

const CATALOG_URL = config.CATALOG_ENGINE_URL || "http://localhost:4000";

const CATALOG_API_KEY = config.CATALOG_API_KEY;
const catalogHeaders = {
  "x-api-key": CATALOG_API_KEY || "",
};

// ---------------------------------------------------------------------------
// Validate that a catalog_id exists in the Catalog Engine
// ---------------------------------------------------------------------------
export async function validateCatalogId(catalogId: string): Promise<boolean> {
  try {
    const { status } = await axios.get(
      `${CATALOG_URL}/api/products/${catalogId}`,
      {
        headers: catalogHeaders,
      },
    );
    return status === 200;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Fetch product metadata (warranty, guarantee, etc.) from Catalog Engine
// ---------------------------------------------------------------------------
export async function fetchProductMetadata(catalogId: string): Promise<{
  warranty_value: number;
  guarantee_value: number;
  warranty_for: string[];
  name: string;
  brand: string;
  category: string;
  retail_mrp: number;
} | null> {
  try {
    const { data } = await axios.get(
      `${CATALOG_URL}/api/products/${catalogId}`,
      {
        headers: catalogHeaders,
      },
    );
    return {
      warranty_value: data.metadata?.warranty_value || 0,
      guarantee_value: data.metadata?.guarantee_value || 0,
      warranty_for: data.metadata?.warranty_for || [],
      name: data.name,
      brand: data.brand,
      category: data.category?.primary || "",
      retail_mrp: data.pricing?.retail_mrp || 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch full catalog product data (for CatalogRef sync)
// ---------------------------------------------------------------------------
export async function fetchCatalogProduct(catalogId: string): Promise<{
  sku: string;
  name: string;
  brand: string;
  category: string;
  retail_mrp: number;
} | null> {
  try {
    const { data } = await axios.get(
      `${CATALOG_URL}/api/products/${catalogId}`,
      {
        headers: catalogHeaders,
      },
    );
    return {
      sku: data.sku || "",
      name: data.name,
      brand: data.brand,
      category: data.category?.primary || "",
      retail_mrp: data.pricing?.retail_mrp || 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Push updated stock count to Catalog Engine
// ---------------------------------------------------------------------------
export async function syncStockToCatalog(
  catalogId: string,
  availableQuantity: number,
): Promise<void> {
  try {
    const stockStatus =
      availableQuantity > 5
        ? "IN_STOCK"
        : availableQuantity > 0
          ? "LOW_STOCK"
          : "OUT_OF_STOCK";

    await axios.put(
      `${CATALOG_URL}/api/products/${catalogId}`,
      {
        inventory: {
          available_quantity: availableQuantity,
          stock_status: stockStatus,
        },
      },
      { headers: catalogHeaders },
    );
  } catch (err) {
    console.error(
      `[business.rules] Failed to sync stock for ${catalogId}:`,
      err,
    );
    // Non‑fatal — inventory count in catalog is a cache, not the source of truth
  }
}

// ---------------------------------------------------------------------------
// Calculate profit for a sale item
// ---------------------------------------------------------------------------
export function calculateProfit(salePrice: number, dealerCost: number): number {
  return salePrice - dealerCost;
}

// ---------------------------------------------------------------------------
// Role‑based permission checks
// ---------------------------------------------------------------------------
export function canAccessInventory(role: string): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export function canViewDealerCost(role: string): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export function canSell(role: string): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN" || role === "SALESMAN";
}
