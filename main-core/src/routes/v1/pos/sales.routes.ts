// =============================================================================
// Prime Tech Gallery – POS Sales Route (multi‑item, auto‑customer, receipt)
// =============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";
import { validate } from "../../../middleware/validate";
import { z } from "zod";
import { logAudit } from "../../../services/audit.service";
import { processMultiItemSale } from "../../../services/sales.service";
import { schema } from "../../../lib/schema";

// ------------------------------------------------------------------
// Single sale item
// ------------------------------------------------------------------
const SaleItemSchema = z.object({
  barcode: z.string().optional(),
  class_id: z.string().optional(),
  final_sale_price: z.number().min(0),
});

// ------------------------------------------------------------------
// Full request body – customer_address is optional
// ------------------------------------------------------------------
const CreateSaleSchema = z.object({
  items: z.array(SaleItemSchema).min(1),
  customer_name: z.string().min(1),
  customer_phone: z.string().min(1),
  customer_address: z.string().optional(), // 🆕
  payment_method: z
    .enum(["CASH", "CARD", "MOBILE_BANKING", "BANK_TRANSFER"])
    .optional(),
});

interface CreateSaleBody {
  items: {
    barcode?: string;
    class_id?: string;
    final_sale_price: number;
  }[];
  customer_name: string;
  customer_phone: string;
  customer_address?: string;
  payment_method?: "CASH" | "CARD" | "MOBILE_BANKING" | "BANK_TRANSFER";
}

// ------------------------------------------------------------------
// Handler
// ------------------------------------------------------------------
async function createSaleHandler(
  request: FastifyRequest<{ Body: CreateSaleBody }>,
  reply: FastifyReply,
) {
  const {
    items,
    customer_name,
    customer_phone,
    customer_address,
    payment_method,
  } = request.body;
  const user = request.user as { sub: string; role: string };

  // Validate each item has exactly one identifier
  for (const item of items) {
    if ((item.barcode && item.class_id) || (!item.barcode && !item.class_id)) {
      return reply.status(400).send({
        success: false,
        error:
          "Each item must have either a barcode (IMEI/serial) or a class_id (SKU), but not both.",
      });
    }
  }

  try {
    const result = await processMultiItemSale(request.server.prisma, {
      items,
      salesmanId: user.sub,
      paymentMethod: payment_method || "CASH",
      customerName: customer_name,
      customerPhone: customer_phone,
      customerAddress: customer_address, // 🆕
    });

    await logAudit(
      user.sub,
      "SALE_COMPLETED",
      "sales",
      result.saleId,
      {
        itemCount: items.length,
        total: result.total,
        totalProfit: result.totalProfit,
      },
      request.ip,
    );

    return reply.status(201).send({ success: true, data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sale failed";
    return reply.status(400).send({ success: false, error: message });
  }
}

// ------------------------------------------------------------------
// Route plugin
// ------------------------------------------------------------------
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
