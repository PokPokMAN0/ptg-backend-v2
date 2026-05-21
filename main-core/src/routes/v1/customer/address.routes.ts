// =============================================================================
// Prime Tech Gallery – Customer Address Routes
// =============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { validate } from "../../../middleware/validate";
import { z } from "zod";
import { schema } from "../../../lib/schema";

// ---------- Schemas ----------
const CreateAddressSchema = z.object({
  type: z.enum(["SHIPPING", "BILLING"]).optional(),
  label: z.string().optional(),
  recipient: z.string().min(1),
  phone: z.string().min(1),
  line_1: z.string().min(1),
  line_2: z.string().optional(),
  city: z.string().min(1),
  district: z.string().min(1),
  division: z.string().optional(),
  postal_code: z.string().optional(),
  is_default: z.boolean().optional(),
});

// Update schema – all fields optional
const UpdateAddressSchema = z.object({
  type: z.enum(["SHIPPING", "BILLING"]).optional(),
  label: z.string().optional(),
  recipient: z.string().optional(),
  phone: z.string().optional(),
  line_1: z.string().optional(),
  line_2: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  division: z.string().optional(),
  postal_code: z.string().optional(),
  is_default: z.boolean().optional(),
});

// ---------- GET /v1/customer/addresses ----------
async function getAddressesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const userId = (request.user as { sub: string }).sub;
  const addresses = await request.server.prisma.address.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
  });
  return reply.send({ success: true, data: addresses });
}

// ---------- POST /v1/customer/addresses ----------
async function createAddressHandler(
  request: FastifyRequest<{ Body: z.infer<typeof CreateAddressSchema> }>,
  reply: FastifyReply,
) {
  const userId = (request.user as { sub: string }).sub;
  const data = request.body;

  if (data.is_default) {
    await request.server.prisma.address.updateMany({
      where: {
        user_id: userId,
        type: data.type || "SHIPPING",
        is_default: true,
      },
      data: { is_default: false },
    });
  }

  const address = await request.server.prisma.address.create({
    data: { ...data, user_id: userId },
  });
  return reply.status(201).send({ success: true, data: address });
}

// ---------- PUT /v1/customer/addresses/:id ----------
async function updateAddressHandler(
  request: FastifyRequest<{
    Params: { id: string };
    Body: z.infer<typeof UpdateAddressSchema>;
  }>,
  reply: FastifyReply,
) {
  const userId = (request.user as { sub: string }).sub;
  const { id } = request.params;
  const data = request.body;

  if (data.is_default) {
    const existing = await request.server.prisma.address.findUnique({
      where: { id },
    });
    if (existing) {
      await request.server.prisma.address.updateMany({
        where: { user_id: userId, type: existing.type, is_default: true },
        data: { is_default: false },
      });
    }
  }

  const address = await request.server.prisma.address.update({
    where: { id },
    data,
  });
  return reply.send({ success: true, data: address });
}

// ---------- DELETE /v1/customer/addresses/:id ----------
async function deleteAddressHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const userId = (request.user as { sub: string }).sub;
  await request.server.prisma.address.deleteMany({
    where: { id: request.params.id, user_id: userId },
  });
  return reply.send({ success: true, message: "Address deleted" });
}

// ---------- Route plugin ----------
export async function addressRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/v1/customer/addresses",
    { preHandler: [authenticate] },
    getAddressesHandler,
  );

  fastify.post<{ Body: z.infer<typeof CreateAddressSchema> }>(
    "/v1/customer/addresses",
    {
      ...schema(CreateAddressSchema),
      preHandler: [authenticate, validate(CreateAddressSchema)],
    },
    createAddressHandler,
  );

  fastify.put<{
    Params: { id: string };
    Body: z.infer<typeof UpdateAddressSchema>;
  }>(
    "/v1/customer/addresses/:id",
    {
      ...schema(UpdateAddressSchema),
      preHandler: [authenticate, validate(UpdateAddressSchema)],
    },
    updateAddressHandler,
  );

  fastify.delete<{ Params: { id: string } }>(
    "/v1/customer/addresses/:id",
    { preHandler: [authenticate] },
    deleteAddressHandler,
  );
}
