// =============================================================================
// Prime Tech Gallery – POS Barcode Lookup (Pre‑Sale Verification)
// GET /v1/pos/lookup?barcode=TEST-IMEI-001
// =============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";
import { hashField, decryptField } from "../../../services/encryption.service";
import { fetchProductMetadata } from "../../../business.rules";

interface LookupQuery {
  barcode: string;
}

async function barcodeLookupHandler(
  request: FastifyRequest<{ Querystring: LookupQuery }>,
  reply: FastifyReply,
) {
  const { barcode } = request.query;

  if (!barcode || typeof barcode !== "string" || barcode.trim().length === 0) {
    return reply.status(400).send({
      success: false,
      error: "Barcode query parameter is required.",
    });
  }

  // 1. Hash the scanned barcode
  const barcodeHash = hashField(barcode.trim());

  // 2. Find an AVAILABLE unit
  const unit = await request.server.prisma.inventoryUnit.findFirst({
    where: {
      OR: [
        { imei_1_hash: barcodeHash },
        { imei_2_hash: barcodeHash },
        { serial_hash: barcodeHash },
      ],
      status: "AVAILABLE",
    },
    include: {
      catalog_ref: {
        select: {
          catalog_id: true, // MongoDB _id
          name: true,
          brand: true,
          sku: true,
          retail_mrp: true,
        },
      },
    },
  });

  if (!unit) {
    return reply.status(404).send({
      success: false,
      error: "Barcode not found or item is no longer available.",
    });
  }

  // 3. Decrypt IMEIs/Serials for display (only the matched field is guaranteed, but decrypt all)
  const plainUnit = {
    id: unit.id,
    status: unit.status,
    condition: unit.condition,
    dealer_cost: unit.dealer_cost, // ADMIN / SALESMAN can see cost? Your rules decide.
    retail_mrp: unit.catalog_ref?.retail_mrp,
    imei_1: unit.imei_1 ? decryptField(unit.imei_1) : null,
    imei_2: unit.imei_2 ? decryptField(unit.imei_2) : null,
    serial_number: unit.serial_number ? decryptField(unit.serial_number) : null,
    mac_address: unit.mac_address,
    catalog_ref: unit.catalog_ref,
  };

  // 4. Fetch additional product details from the Catalog Engine
  let catalogProduct = null;
  if (unit.catalog_ref?.catalog_id) {
    catalogProduct = await fetchProductMetadata(unit.catalog_ref.catalog_id);
  }

  // 5. Get available stock count for this product
  const availableStock = await request.server.prisma.inventoryUnit.count({
    where: {
      catalog_ref_id: unit.catalog_ref_id,
      status: "AVAILABLE",
    },
  });

  // 6. Build the response
  return reply.send({
    success: true,
    data: {
      scanned_barcode: barcode,
      matched_field:
        barcodeHash === unit.imei_1_hash
          ? "imei_1"
          : barcodeHash === unit.imei_2_hash
            ? "imei_2"
            : "serial_number",
      inventory_unit: plainUnit,
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
