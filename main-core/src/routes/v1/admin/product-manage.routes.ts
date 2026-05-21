import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";
import { validate } from "../../../middleware/validate";
import { z } from "zod";
import axios from "axios";
import { logAudit } from "../../../services/audit.service";

const CATALOG_URL = process.env.CATALOG_ENGINE_URL || "http://localhost:4000";
const CATALOG_API_KEY = process.env.CATALOG_API_KEY || "";
const headers = { "x-api-key": CATALOG_API_KEY };

const UpdateProductSchema = z.object({
  name: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  base_price: z.number().min(0).optional(),
  description: z.string().optional(),
  specs: z.record(z.string(), z.any()).optional(),
  is_active: z.boolean().optional(),
});

type UpdateProductBody = z.infer<typeof UpdateProductSchema>;

// PUT
async function updateProductHandler(
  request: FastifyRequest<{
    Params: { catalog_id: string };
    Body: UpdateProductBody;
  }>,
  reply: FastifyReply,
) {
  const { catalog_id } = request.params;
  try {
    const { data } = await axios.put(
      `${CATALOG_URL}/api/products/${catalog_id}`,
      request.body,
      { headers },
    );
    await logAudit(
      (request.user as any).sub,
      "PRODUCT_UPDATED",
      "catalog_engine",
      catalog_id,
      request.body,
      request.ip,
    );
    return reply.send({ success: true, data });
  } catch (err: any) {
    if (err.response?.status === 404)
      return reply
        .status(404)
        .send({ success: false, error: "Product not found" });
    throw err;
  }
}

// DELETE
async function deleteProductHandler(
  request: FastifyRequest<{ Params: { catalog_id: string } }>,
  reply: FastifyReply,
) {
  const { catalog_id } = request.params;
  const catalogRef = await request.server.prisma.catalogRef.findUnique({
    where: { catalog_id },
    include: { inventory_units: { where: { status: "AVAILABLE" } } },
  });
  if (catalogRef && catalogRef.inventory_units.length > 0) {
    return reply
      .status(409)
      .send({
        success: false,
        error: "Cannot delete product with active inventory units.",
      });
  }
  try {
    await axios.put(
      `${CATALOG_URL}/api/products/${catalog_id}`,
      { is_active: false },
      { headers },
    );
    await logAudit(
      (request.user as any).sub,
      "PRODUCT_SOFT_DELETED",
      "catalog_engine",
      catalog_id,
      null,
      request.ip,
    );
    return reply.send({ success: true, message: "Product deactivated" });
  } catch (err: any) {
    if (err.response?.status === 404)
      return reply
        .status(404)
        .send({ success: false, error: "Product not found" });
    throw err;
  }
}

export async function productManageRoutes(fastify: FastifyInstance) {
  fastify.put<{ Params: { catalog_id: string }; Body: UpdateProductBody }>(
    "/v1/admin/products/:catalog_id",
    {
      preHandler: [
        authenticate,
        requireRole("ADMIN", "SUPER_ADMIN"),
        validate(UpdateProductSchema),
      ],
    },
    updateProductHandler,
  );
  fastify.delete<{ Params: { catalog_id: string } }>(
    "/v1/admin/products/:catalog_id",
    { preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")] },
    deleteProductHandler,
  );
}
