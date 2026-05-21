import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { validate } from "../../../middleware/validate";
import { z } from "zod";
import { logAudit } from "../../../services/audit.service";
import { schema } from "../../../lib/schema";

const PlaceWebOrderSchema = z.object({
  items: z
    .array(
      z.object({
        catalog_ref_id: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .nonempty(),
  shipping_address_id: z.string().uuid().optional(),
  payment_method: z.enum(["CARD", "MOBILE_BANKING", "BANK_TRANSFER"]),
});

type PlaceWebOrderBody = z.infer<typeof PlaceWebOrderSchema>;

async function placeWebOrderHandler(
  request: FastifyRequest<{ Body: PlaceWebOrderBody }>,
  reply: FastifyReply,
) {
  const userId = (request.user as any).sub;
  const { items, shipping_address_id, payment_method } = request.body;

  for (const item of items) {
    const exists = await request.server.prisma.catalogRef.findUnique({
      where: { id: item.catalog_ref_id },
    });
    if (!exists)
      return reply.status(400).send({
        success: false,
        error: `Catalog item not found: ${item.catalog_ref_id}`,
      });
  }

  let total = 0;
  for (const item of items) {
    const ref = await request.server.prisma.catalogRef.findUnique({
      where: { id: item.catalog_ref_id },
      select: { retail_mrp: true },
    });
    total += Number(ref!.retail_mrp) * item.quantity;
  }

  const sale = await request.server.prisma.sale.create({
    data: {
      buyer_id: userId,
      total_amount: total,
      payment_method,
      source: "WEB",
      status: "PENDING",
      shipping_address_id: shipping_address_id || null,
    },
  });

  await logAudit(
    userId,
    "WEB_ORDER_PLACED",
    "sales",
    sale.id,
    { items },
    request.ip,
  );

  // FIXED: Wrapped sale and message inside a data object for consistent API envelope
  return reply.status(201).send({
    success: true,
    data: {
      sale,
      message: "Order placed. Complete payment to confirm.",
    },
  });
}

export async function webOrderRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: PlaceWebOrderBody }>(
    "/v1/checkout/web",
    {
      ...schema(PlaceWebOrderSchema),
      preHandler: [authenticate, validate(PlaceWebOrderSchema)],
    },
    placeWebOrderHandler,
  );
}
