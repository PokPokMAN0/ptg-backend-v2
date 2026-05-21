// =============================================================================
// Prime Tech Gallery — Catalog Reference Sync
// POST /v1/admin/catalog-ref/sync
// =============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";
import { fetchCatalogProduct } from "../../../business.rules";
import { schema } from "../../../lib/schema";
import { validate } from "../../../middleware/validate";
import { z } from "zod";
import { logAudit } from "../../../services/audit.service";
interface SyncBody {
  catalog_id: string; // MongoDB _id from Catalog Engine
}

async function syncCatalogRefHandler(
  request: FastifyRequest<{ Body: SyncBody }>,
  reply: FastifyReply,
) {
  const { catalog_id } = request.body;

  if (!catalog_id || typeof catalog_id !== "string") {
    return reply.status(400).send({
      success: false,
      error: "catalog_id is required and must be a string.",
    });
  }

  // 1. Fetch product data from Catalog Engine
  const catalogProduct = await fetchCatalogProduct(catalog_id);
  if (!catalogProduct) {
    return reply.status(404).send({
      success: false,
      error: `Product not found in Catalog Engine for id: ${catalog_id}`,
    });
  }

  // 2. Upsert into CatalogRef table
  const catalogRef = await request.server.prisma.catalogRef.upsert({
    where: { catalog_id },
    update: {
      sku: catalogProduct.sku,
      name: catalogProduct.name,
      brand: catalogProduct.brand,
      category: catalogProduct.category,
      retail_mrp: catalogProduct.retail_mrp,
    },
    create: {
      catalog_id,
      sku: catalogProduct.sku,
      name: catalogProduct.name,
      brand: catalogProduct.brand,
      category: catalogProduct.category,
      retail_mrp: catalogProduct.retail_mrp,
    },
  });

  await logAudit(
    (request.user as any).sub,
    "CATALOG_REF_SYNCED",
    "catalog_refs",
    catalogRef.id,
    { catalog_id },
    request.ip,
  );

  return reply.status(200).send({
    success: true,
    data: catalogRef,
  });
}

const SyncBodySchema = z.object({
  catalog_id: z.string().min(1),
});

export async function catalogSyncRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: SyncBody }>(
    "/v1/admin/catalog-ref/sync",
    {
      ...schema(SyncBodySchema),
      preHandler: [
        authenticate,
        requireRole("ADMIN", "SUPER_ADMIN"),
        validate(SyncBodySchema),
      ],
    },
    syncCatalogRefHandler,
  );
  // ---------------------------------------------------------------------------
  // POST /v1/admin/catalog-ref/auto-sync – called automatically by the Catalog Engine
  // No admin token required; protected by x-api-key.
  // ---------------------------------------------------------------------------
  fastify.post("/v1/admin/catalog-ref/auto-sync", async (request, reply) => {
    const apiKey = request.headers["x-api-key"];
    if (!apiKey || apiKey !== process.env.CATALOG_API_KEY) {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }

    const { catalog_id, sku, name, brand, category, retail_mrp } =
      request.body as any;

    if (!catalog_id || !name) {
      return reply
        .status(400)
        .send({ success: false, error: "Missing required fields." });
    }

    const catalogRef = await request.server.prisma.catalogRef.upsert({
      where: { catalog_id },
      update: { sku, name, brand, category, retail_mrp },
      create: { catalog_id, sku, name, brand, category, retail_mrp },
    });

    return reply.send({ success: true, data: catalogRef });
  });
}
