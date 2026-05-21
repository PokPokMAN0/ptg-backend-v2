import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";
import { validate } from "../../../middleware/validate";
import { z } from "zod";
import { logAudit } from "../../../services/audit.service";
import { schema } from "../../../lib/schema";

const CreateSupplierSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  company_name: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

const UpdateSupplierSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  company_name: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  is_active: z.boolean().optional(),
});

type CreateSupplierBody = z.infer<typeof CreateSupplierSchema>;
type UpdateSupplierBody = z.infer<typeof UpdateSupplierSchema>;

async function createSupplierHandler(
  request: FastifyRequest<{ Body: CreateSupplierBody }>,
  reply: FastifyReply,
) {
  const supplier = await request.server.prisma.supplier.create({
    data: request.body,
  });
  await logAudit(
    (request.user as any).sub,
    "SUPPLIER_CREATED",
    "suppliers",
    supplier.id,
    { name: request.body.name },
    request.ip,
  );
  return reply.status(201).send({ success: true, data: supplier });
}

async function listSuppliersHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const suppliers = await request.server.prisma.supplier.findMany({
    include: { _count: { select: { batches: true } } },
    orderBy: { name: "asc" },
  });
  return reply.send({ success: true, data: suppliers });
}

async function updateSupplierHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateSupplierBody }>,
  reply: FastifyReply,
) {
  const { id } = request.params;
  const supplier = await request.server.prisma.supplier.update({
    where: { id },
    data: request.body,
  });
  await logAudit(
    (request.user as any).sub,
    "SUPPLIER_UPDATED",
    "suppliers",
    id,
    request.body,
    request.ip,
  );
  return reply.send({ success: true, data: supplier });
}

async function deleteSupplierHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  await request.server.prisma.supplier.delete({
    where: { id: request.params.id },
  });
  await logAudit(
    (request.user as any).sub,
    "SUPPLIER_DELETED",
    "suppliers",
    request.params.id,
    null,
    request.ip,
  );
  return reply.send({ success: true, message: "Supplier deleted" });
}

export async function supplierRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: CreateSupplierBody }>(
    "/v1/admin/suppliers",
    {
      ...schema(CreateSupplierSchema),
      preHandler: [
        authenticate,
        requireRole("ADMIN", "SUPER_ADMIN"),
        validate(CreateSupplierSchema),
      ],
    },
    createSupplierHandler,
  );
  fastify.get(
    "/v1/admin/suppliers",
    { preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")] },
    listSuppliersHandler,
  );
  fastify.put<{ Params: { id: string }; Body: UpdateSupplierBody }>(
    "/v1/admin/suppliers/:id",
    {
      ...schema(UpdateSupplierSchema),
      preHandler: [
        authenticate,
        requireRole("ADMIN", "SUPER_ADMIN"),
        validate(UpdateSupplierSchema),
      ],
    },
    updateSupplierHandler,
  );
  fastify.delete<{ Params: { id: string } }>(
    "/v1/admin/suppliers/:id",
    { preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")] },
    deleteSupplierHandler,
  );
}
