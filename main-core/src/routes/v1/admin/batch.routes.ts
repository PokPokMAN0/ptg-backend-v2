import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";
import { validate } from "../../../middleware/validate";
import { z } from "zod";
import { logAudit } from "../../../services/audit.service";
import { schema } from "../../../lib/schema";

// Create batch schema
const CreateBatchSchema = z.object({
  supplier_id: z.string().uuid(),
  invoice_number: z.string().min(1),
  purchase_date: z.string().datetime().optional(),
  total_cost: z.number().min(0).optional(),
  currency: z.string().default("BDT"),
  notes: z.string().optional(),
});

// POST /v1/admin/batches
async function createBatchHandler(
  request: FastifyRequest<{ Body: z.infer<typeof CreateBatchSchema> }>,
  reply: FastifyReply,
) {
  const { supplier_id, ...data } = request.body;
  const batch = await request.server.prisma.inventoryBatch.create({
    data: {
      ...data,
      purchase_date: data.purchase_date
        ? new Date(data.purchase_date)
        : new Date(),
      supplier: { connect: { id: supplier_id } },
      recorded_by: { connect: { id: (request.user as any).sub } },
    },
  });
  await logAudit(
    (request.user as any).sub,
    "BATCH_CREATED",
    "inventory_batches",
    batch.id,
    { supplier_id, invoice_number: data.invoice_number },
    request.ip,
  );
  return reply.status(201).send({ success: true, data: batch });
}

// GET /v1/admin/batches
async function listBatchesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const batches = await request.server.prisma.inventoryBatch.findMany({
    include: {
      supplier: { select: { name: true } },
      _count: { select: { units: true } },
    },
    orderBy: { purchase_date: "desc" },
  });
  return reply.send({ success: true, data: batches });
}

// GET /v1/admin/batches/:id
async function getBatchHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const batch = await request.server.prisma.inventoryBatch.findUnique({
    where: { id: request.params.id },
    include: {
      supplier: true,
      units: {
        select: {
          id: true,
          status: true,
          dealer_cost: true,
          retail_mrp: true,
          condition: true,
        },
      },
    },
  });
  if (!batch)
    return reply.status(404).send({ success: false, error: "Batch not found" });
  return reply.send({ success: true, data: batch });
}

export async function batchRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: z.infer<typeof CreateBatchSchema> }>(
    "/v1/admin/batches",
    {
      ...schema(CreateBatchSchema),
      preHandler: [
        authenticate,
        requireRole("ADMIN", "SUPER_ADMIN"),
        validate(CreateBatchSchema),
      ],
    },
    createBatchHandler,
  );

  fastify.get(
    "/v1/admin/batches",
    { preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")] },
    listBatchesHandler,
  );

  fastify.get<{ Params: { id: string } }>(
    "/v1/admin/batches/:id",
    { preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")] },
    getBatchHandler,
  );
}
