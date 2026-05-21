// =============================================================================
// Prime Tech Gallery – POS Sales Route
// =============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";
import { validate } from "../../../middleware/validate";
import { z } from "zod";
import { logAudit } from "../../../services/audit.service";
import { processSale } from "../../../services/sales.service";
import { schema } from "../../../lib/schema";

const CreateSaleSchema = z.object({
  barcode: z.string().min(1),
  customer_name: z.string().min(1),
  customer_phone: z.string().min(1),
  final_sale_price: z.number().min(0),
  payment_method: z
    .enum(["CASH", "CARD", "MOBILE_BANKING", "BANK_TRANSFER"])
    .optional(),
});

interface CreateSaleBody {
  barcode: string;
  customer_name: string;
  customer_phone: string;
  final_sale_price: number;
  payment_method?: "CASH" | "CARD" | "MOBILE_BANKING" | "BANK_TRANSFER";
}

async function createSaleHandler(
  request: FastifyRequest<{ Body: CreateSaleBody }>,
  reply: FastifyReply,
) {
  const {
    barcode,
    customer_name,
    customer_phone,
    final_sale_price,
    payment_method,
  } = request.body;
  const user = request.user as { sub: string; role: string };

  try {
    const result = await processSale(request.server.prisma, {
      barcode,
      salesmanId: user.sub,
      finalSalePrice: final_sale_price,
      paymentMethod: payment_method || "CASH",
      customerInfo: { name: customer_name, phone: customer_phone },
    });

    await logAudit(
      user.sub,
      "SALE_COMPLETED",
      "sales",
      result.saleId,
      {
        barcode,
        finalSalePrice: final_sale_price,
        profit: result.items[0].profit,
      },
      request.ip,
    );

    return reply.status(201).send({ success: true, data: result });
  } catch (err: any) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function posSalesRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: CreateSaleBody }>(
    "/v1/pos/sales",
    {
      ...schema(CreateSaleSchema),
      preHandler: [
        authenticate,
        requireRole("ADMIN", "SUPER_ADMIN", "SALESMAN"),
        validate(CreateSaleSchema),
      ],
    },
    createSaleHandler,
  );
}
