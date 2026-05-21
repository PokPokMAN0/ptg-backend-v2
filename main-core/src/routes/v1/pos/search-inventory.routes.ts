// =============================================================================
// Prime Tech Gallery – POS Search Inventory (manual IMEI selection)
// GET /v1/pos/search-inventory?q=iphone+pro+max+512GB&limit=10
// =============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";
import { decryptField } from "../../../services/encryption.service";
import axios from "axios";

const CATALOG_URL = process.env.CATALOG_ENGINE_URL || "http://localhost:4000";
const CATALOG_API_KEY = process.env.CATALOG_API_KEY || "";
const catalogHeaders = { "x-api-key": CATALOG_API_KEY };

interface SearchQuery {
  q: string;
  limit?: string;
}

async function searchInventoryHandler(
  request: FastifyRequest<{ Querystring: SearchQuery }>,
  reply: FastifyReply,
) {
  const { q, limit } = request.query;
  if (!q || q.trim().length === 0) {
    return reply
      .status(400)
      .send({ success: false, error: "Search query required." });
  }

  // 1. Search the Catalog Engine
  let catalogResults;
  try {
    const res = await axios.get(`${CATALOG_URL}/api/search`, {
      params: { q, limit: limit ? parseInt(limit) : 15 },
      headers: catalogHeaders,
    });
    catalogResults = res.data;
    console.log(
      "DEBUG: Meilisearch totalHits:",
      catalogResults.totalHits || catalogResults.estimatedTotalHits,
    );
  } catch (err: any) {
    console.error("DEBUG: Meilisearch search failed:", err.message);
    return reply
      .status(502)
      .send({ success: false, error: "Catalog search failed." });
  }

  const hits = catalogResults.hits || catalogResults.data || [];
  console.log("DEBUG: Hits count:", hits.length);
  if (hits.length === 0) {
    return reply.send({
      success: true,
      data: [],
      message: "No products found.",
    });
  }

  // 2. For each hit, ensure a CatalogRef exists (auto‑sync if missing)
  const catalogIds = hits.map((p: any) => p.id);
  console.log("DEBUG: Catalog IDs:", JSON.stringify(catalogIds));

  for (const hit of hits) {
    const existingRef = await request.server.prisma.catalogRef.findUnique({
      where: { catalog_id: hit.id },
    });
    if (!existingRef) {
      console.log(
        "DEBUG: Missing CatalogRef for",
        hit.id,
        "- attempting auto‑sync...",
      );
      try {
        const payload = {
          catalog_id: hit.id,
          name: hit.name,
          brand: hit.brand,
          category: hit.category?.primary || hit.category || "",
          retail_mrp: hit.pricing?.retail_mrp || hit.retail_mrp || 0,
          sku: hit.sku || "",
        };
        const syncRes = await axios.post(
          "http://localhost:8080/v1/admin/catalog-ref/auto-sync",
          payload,
          { headers: { "x-api-key": process.env.CATALOG_API_KEY || "" } },
        );
        console.log("DEBUG: Auto‑sync response:", JSON.stringify(syncRes.data));
      } catch (err: any) {
        console.error("DEBUG: Auto‑sync FAILED:", err.message);
        if (err.response) {
          console.error("DEBUG: Response status:", err.response.status);
          console.error(
            "DEBUG: Response data:",
            JSON.stringify(err.response.data),
          );
        }
      }
    } else {
      console.log("DEBUG: CatalogRef already exists for", hit.id);
    }
  }

  // 3. Now fetch CatalogRefs again (they may have just been created)
  const catalogRefs = await request.server.prisma.catalogRef.findMany({
    where: { catalog_id: { in: catalogIds } },
  });
  const catalogRefIds = catalogRefs.map((r) => r.id);
  console.log("DEBUG: CatalogRef IDs found:", catalogRefIds.length);

  if (catalogRefIds.length === 0) {
    console.warn(
      "DEBUG: No CatalogRef IDs found after auto‑sync. Returning empty.",
    );
    return reply.send({ success: true, data: [] });
  }

  // 4. Fetch available inventory units for those products
  const inventoryUnits = await request.server.prisma.inventoryUnit.findMany({
    where: {
      catalog_ref_id: { in: catalogRefIds },
      status: "AVAILABLE",
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
    },
    orderBy: { created_at: "desc" },
  });
  console.log("DEBUG: Inventory units found:", inventoryUnits.length);

  // 5. Decrypt and return
  const result = inventoryUnits.map((unit) => ({
    inventory_id: unit.id,
    status: unit.status,
    condition: unit.condition,
    retail_mrp: unit.catalog_ref?.retail_mrp,
    dealer_cost: unit.dealer_cost,
    imei_1: unit.imei_1 ? decryptField(unit.imei_1) : null,
    imei_2: unit.imei_2 ? decryptField(unit.imei_2) : null,
    serial_number: unit.serial_number ? decryptField(unit.serial_number) : null,
    catalog_name: unit.catalog_ref?.name,
    catalog_brand: unit.catalog_ref?.brand,
    catalog_sku: unit.catalog_ref?.sku,
    catalog_id: unit.catalog_ref?.catalog_id,
  }));

  return reply.send({ success: true, data: result });
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------
export async function posSearchInventoryRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: SearchQuery }>(
    "/v1/pos/search-inventory",
    {
      preHandler: [
        authenticate,
        requireRole("ADMIN", "SUPER_ADMIN", "SALESMAN"),
      ],
    },
    searchInventoryHandler,
  );
}
