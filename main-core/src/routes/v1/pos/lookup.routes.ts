// =============================================================================
// Prime Tech Gallery – POS Barcode Lookup (Pre‑Sale Verification)
// GET /v1/pos/lookup?barcode=TEST-IMEI-001
// GET /v1/pos/lookup?class_id=SKU-RM-C85-PRO-6-128-PP
// =============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import axios from "axios";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";
import { hashField, decryptField } from "../../../services/encryption.service";
import { fetchProductMetadata } from "../../../business.rules";

const CATALOG_URL = process.env.CATALOG_ENGINE_URL || "http://localhost:4000";
const CATALOG_API_KEY = process.env.CATALOG_API_KEY || "";
const catalogHeaders = { "x-api-key": CATALOG_API_KEY };

// ---------------------------------------------------------------------------
// Query params – barcode or class_id (one of them required)
// ---------------------------------------------------------------------------
interface LookupQuery {
  barcode?: string;
  class_id?: string;
}

async function barcodeLookupHandler(
  request: FastifyRequest<{ Querystring: LookupQuery }>,
  reply: FastifyReply,
) {
  const { barcode, class_id } = request.query;
  const user = request.user as { sub: string; role: string };

  // ─────────────────────────────────────────────────────────────────────────
  // CLASS ID lookup (non‑serialised products)
  // ─────────────────────────────────────────────────────────────────────────
  if (class_id) {
    // Search the Catalog Engine for the SKU or MongoDB _id
    let catalogHit;
    try {
      const res = await axios.get(`${CATALOG_URL}/api/search`, {
        params: { q: class_id, limit: 1 },
        headers: catalogHeaders,
      });
      const hits = res.data?.hits || res.data?.data || [];
      catalogHit = hits[0];
    } catch {
      return reply
        .status(502)
        .send({ success: false, error: "Catalog search failed." });
    }

    if (!catalogHit) {
      return reply.status(404).send({
        success: false,
        error: `No product found for class_id: ${class_id}`,
      });
    }

    // Find the CatalogRef in PostgreSQL
    const catalogRef = await request.server.prisma.catalogRef.findUnique({
      where: { catalog_id: catalogHit.id },
      select: {
        id: true, // ← needed for inventory count
        catalog_id: true,
        name: true,
        brand: true,
        sku: true,
        retail_mrp: true,
      },
    });

    if (!catalogRef) {
      return reply.status(404).send({
        success: false,
        error:
          "Product not synced to inventory. Please sync the CatalogRef first.",
      });
    }

    // Count available stock
    const availableStock = await request.server.prisma.inventoryUnit.count({
      where: {
        catalog_ref_id: catalogRef.id,
        status: "AVAILABLE",
      },
    });

    if (availableStock === 0) {
      return reply.status(404).send({
        success: false,
        error: "No available stock for this product.",
      });
    }

    // Fetch warranty metadata from Catalog Engine
    const catalogProduct = await fetchProductMetadata(catalogHit.id);

    return reply.send({
      success: true,
      data: {
        lookup_type: "class_id",
        catalog_product: {
          catalog_id: catalogRef.catalog_id,
          name: catalogRef.name,
          brand: catalogRef.brand,
          sku: catalogRef.sku,
          retail_mrp: catalogRef.retail_mrp,
        },
        warranty: catalogProduct
          ? {
              warranty_value: catalogProduct.warranty_value,
              guarantee_value: catalogProduct.guarantee_value,
              warranty_for: catalogProduct.warranty_for,
            }
          : null,
        available_stock: availableStock,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BARCODE lookup (existing IMEI/serial flow)
  // ─────────────────────────────────────────────────────────────────────────
  if (!barcode || typeof barcode !== "string" || barcode.trim().length === 0) {
    return reply.status(400).send({
      success: false,
      error:
        "Either barcode (IMEI/serial) or class_id (SKU/catalog ID) query parameter is required.",
    });
  }

  const barcodeHash = hashField(barcode.trim());

  // Find the unit regardless of status (AVAILABLE or SOLD)
  const unit = await request.server.prisma.inventoryUnit.findFirst({
    where: {
      OR: [
        { imei_1_hash: barcodeHash },
        { imei_2_hash: barcodeHash },
        { serial_hash: barcodeHash },
      ],
    },
    include: {
      catalog_ref: {
        select: {
          catalog_id: true,
          name: true,
          brand: true,
          sku: true,
          retail_mrp: true,
        },
      },
      sale_item: {
        select: {
          id: true,
          sale_price: true,
          profit: true,
          sale: {
            select: {
              id: true,
              created_at: true,
              salesman: { select: { id: true, name: true, email: true } },
            },
          },
        },
      },
      warranty: {
        select: {
          id: true,
          status: true,
          warrantor: true,
          duration_months: true,
          starts_at: true,
          expires_at: true,
          notes: true,
        },
      },
    },
  });

  if (!unit) {
    return reply
      .status(404)
      .send({ success: false, error: "Barcode not found." });
  }

  // Build the response
  const plainUnit: {
    id: string;
    status: string;
    condition: string;
    retail_mrp: any;
    imei_1: string | null;
    imei_2: string | null;
    serial_number: string | null;
    mac_address: string | null;
    catalog_ref: any;
    dealer_cost?: any;
  } = {
    id: unit.id,
    status: unit.status,
    condition: unit.condition,
    retail_mrp: unit.catalog_ref?.retail_mrp,
    imei_1: unit.imei_1 ? decryptField(unit.imei_1) : null,
    imei_2: unit.imei_2 ? decryptField(unit.imei_2) : null,
    serial_number: unit.serial_number ? decryptField(unit.serial_number) : null,
    mac_address: unit.mac_address,
    catalog_ref: unit.catalog_ref,
  };

  // Only show dealer_cost to ADMIN/SUPER_ADMIN
  if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
    plainUnit.dealer_cost = unit.dealer_cost;
  }

  // If SOLD, include sale and warranty details
  let saleInfo = null;
  let warrantyInfo = null;
  if (unit.status === "SOLD" && unit.sale_item) {
    saleInfo = {
      sale_id: unit.sale_item.sale?.id,
      sale_price: unit.sale_item.sale_price,
      profit: unit.sale_item.profit,
      sold_at: unit.sale_item.sale?.created_at,
      sold_by: unit.sale_item.sale?.salesman?.name,
    };
    if (unit.warranty) {
      warrantyInfo = {
        id: unit.warranty.id,
        status: unit.warranty.status,
        warrantor: unit.warranty.warrantor,
        duration_months: unit.warranty.duration_months,
        starts_at: unit.warranty.starts_at,
        expires_at: unit.warranty.expires_at,
        notes: unit.warranty.notes,
      };
    }
  }

  // Also fetch additional catalog product info if needed
  let catalogProduct = null;
  if (unit.catalog_ref?.catalog_id) {
    catalogProduct = await fetchProductMetadata(unit.catalog_ref.catalog_id);
  }

  const availableStock = await request.server.prisma.inventoryUnit.count({
    where: {
      catalog_ref_id: unit.catalog_ref_id,
      status: "AVAILABLE",
    },
  });

  return reply.send({
    success: true,
    data: {
      lookup_type: "barcode",
      scanned_barcode: barcode,
      matched_field:
        barcodeHash === unit.imei_1_hash
          ? "imei_1"
          : barcodeHash === unit.imei_2_hash
            ? "imei_2"
            : "serial_number",
      inventory_unit: plainUnit,
      sale_info: saleInfo,
      warranty_info: warrantyInfo,
      catalog_product: catalogProduct,
      available_stock: availableStock,
    },
  });
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------
export async function posLookupRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: LookupQuery }>(
    "/v1/pos/lookup",
    {
      preHandler: [
        authenticate,
        requireRole("ADMIN", "SUPER_ADMIN", "SALESMAN"),
      ],
    },
    barcodeLookupHandler,
  );
}
