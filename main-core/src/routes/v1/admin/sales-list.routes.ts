// =============================================================================
// Prime Tech Gallery – Admin Sales List (Drill‑Down)
// GET /v1/admin/reports/sales?period=7d&limit=15&page=1
// =============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";
import { decryptField } from "../../../services/encryption.service";

// ---------------------------------------------------------------------------
// Allowed page sizes
// ---------------------------------------------------------------------------
const ALLOWED_LIMITS = [15, 25, 35, 50];
const DEFAULT_LIMIT = 15;

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------
interface SalesListQuery {
  period?: string;
  limit?: string;
  page?: string;
}

// ---------------------------------------------------------------------------
// Period parser (same logic)
// ---------------------------------------------------------------------------
function parsePeriod(period: string): Date {
  const now = new Date();
  const match = period.match(/^(\d+)\s*(h|hr|hrs|d|m|y)$/i);
  if (!match) return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  let ms = 0;
  if (unit === "h" || unit === "hr" || unit === "hrs")
    ms = value * 60 * 60 * 1000;
  else if (unit === "d") ms = value * 24 * 60 * 60 * 1000;
  else if (unit === "m") ms = value * 30.44 * 24 * 60 * 60 * 1000;
  else if (unit === "y") ms = value * 365.25 * 24 * 60 * 60 * 1000;

  return new Date(now.getTime() - ms);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
async function salesListHandler(
  request: FastifyRequest<{ Querystring: SalesListQuery }>,
  reply: FastifyReply,
) {
  const period = request.query.period ?? "7d";
  const startDate = parsePeriod(period);

  // Pagination
  let limit = DEFAULT_LIMIT;
  if (request.query.limit) {
    const parsed = parseInt(request.query.limit, 10);
    if (ALLOWED_LIMITS.includes(parsed)) limit = parsed;
  }
  let page = 1;
  if (request.query.page) {
    const parsed = parseInt(request.query.page, 10);
    if (parsed > 0) page = parsed;
  }
  const skip = (page - 1) * limit;

  // Total count
  const totalSales = await request.server.prisma.sale.count({
    where: { created_at: { gte: startDate } },
  });

  // Fetch sales with items + inventory unit details
  const sales = await request.server.prisma.sale.findMany({
    where: { created_at: { gte: startDate } },
    include: {
      items: {
        include: {
          inventory_unit: {
            select: {
              id: true,
              imei_1: true,
              imei_2: true,
              serial_number: true,
              dealer_cost: true,
              retail_mrp: true,
              status: true,
              catalog_ref: { select: { name: true, sku: true } },
            },
          },
        },
      },
      salesman: { select: { id: true, name: true, email: true } },
    },
    orderBy: { created_at: "desc" },
    skip,
    take: limit,
  });

  // Decrypt sensitive fields for admin
  const plainSales = sales.map((sale) => ({
    ...sale,
    items: sale.items.map((item) => ({
      ...item,
      inventory_unit: {
        ...item.inventory_unit,
        imei_1: item.inventory_unit.imei_1
          ? decryptField(item.inventory_unit.imei_1)
          : null,
        imei_2: item.inventory_unit.imei_2
          ? decryptField(item.inventory_unit.imei_2)
          : null,
        serial_number: item.inventory_unit.serial_number
          ? decryptField(item.inventory_unit.serial_number)
          : null,
      },
    })),
  }));

  const totalPages = Math.ceil(totalSales / limit);

  return reply.send({
    success: true,
    data: {
      period,
      start_date: startDate.toISOString(),
      sales: plainSales,
    },
    pagination: {
      page,
      limit,
      total_items: totalSales,
      total_pages: totalPages,
      next_page: page < totalPages ? page + 1 : null,
      prev_page: page > 1 ? page - 1 : null,
    },
  });
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------
export async function salesListRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: SalesListQuery }>(
    "/v1/admin/reports/sales",
    { preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")] },
    salesListHandler,
  );
}
