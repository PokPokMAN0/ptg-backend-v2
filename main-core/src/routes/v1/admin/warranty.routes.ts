import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";
import { validate } from "../../../middleware/validate";
import { z } from "zod";
import { logAudit } from "../../../services/audit.service";

const UpdateWarrantySchema = z.object({
  status: z.enum(["ACTIVE", "EXPIRED", "CLAIMED", "VOID"]).optional(),
  notes: z.string().optional(),
});

// GET /v1/admin/warranties?status=ACTIVE&expiring_before=2026-06-01
async function listWarrantiesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { status, expiring_before, limit, page } = request.query as any;
  const where: any = {};
  if (status) where.status = status;
  if (expiring_before) where.expires_at = { lte: new Date(expiring_before) };

  const take = Math.min(parseInt(limit) || 20, 100);
  const skip = ((parseInt(page) || 1) - 1) * take;
  const [warranties, total] = await Promise.all([
    request.server.prisma.warranty.findMany({
      where,
      include: {
        inventory_unit: {
          select: {
            imei_1_hash: true,
            catalog_ref: { select: { name: true } },
          },
        },
        sale_item: { select: { sale: { select: { created_at: true } } } },
      },
      orderBy: { expires_at: "asc" },
      skip,
      take,
    }),
    request.server.prisma.warranty.count({ where }),
  ]);
  return reply.send({
    success: true,
    data: warranties,
    pagination: {
      page: parseInt(page) || 1,
      limit: take,
      total,
      totalPages: Math.ceil(total / take),
    },
  });
}

// PUT /v1/admin/warranties/:id
async function updateWarrantyHandler(
  request: FastifyRequest<{
    Params: { id: string };
    Body: z.infer<typeof UpdateWarrantySchema>;
  }>,
  reply: FastifyReply,
) {
  const { id } = request.params;
  const data = request.body;
  const warranty = await request.server.prisma.warranty.update({
    where: { id },
    data,
  });
  await logAudit(
    (request.user as any).sub,
    "WARRANTY_UPDATED",
    "warranties",
    id,
    data,
    request.ip,
  );
  return reply.send({ success: true, data: warranty });
}

export async function warrantyRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/v1/admin/warranties",
    { preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")] },
    listWarrantiesHandler,
  );

  fastify.put<{
    Params: { id: string };
    Body: z.infer<typeof UpdateWarrantySchema>;
  }>(
    "/v1/admin/warranties/:id",
    {
      preHandler: [
        authenticate,
        requireRole("ADMIN", "SUPER_ADMIN"),
        validate(UpdateWarrantySchema),
      ],
    },
    updateWarrantyHandler,
  );
}
