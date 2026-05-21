// =============================================================================
// Prime Tech Gallery – Admin Reports Dashboard
// GET /v1/admin/reports/dashboard?period=7d
// =============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DashboardQuery {
  period?: string;
}

interface SalesOverTimeBucket {
  label: string;
  sales_count: number;
  total_revenue: number;
  total_profit: number;
}

// ---------------------------------------------------------------------------
// Period parser (supports: 1h, 6h, 24h, 7d, 30d, 1m, 6m, 1y)
// ---------------------------------------------------------------------------
function parsePeriod(period: string): {
  startDate: Date;
  bucketType: "hour" | "day";
} {
  const now = new Date();
  const match = period.match(/^(\d+)\s*(h|hr|hrs|d|m|y)$/i);
  if (!match) {
    // default: 7 days, daily buckets
    return {
      startDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      bucketType: "day",
    };
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  let milliseconds = 0;
  let bucketType: "hour" | "day" = "day";

  switch (true) {
    case unit === "h" || unit === "hr" || unit === "hrs":
      milliseconds = value * 60 * 60 * 1000;
      bucketType = value <= 48 ? "hour" : "day";
      break;
    case unit === "d":
      milliseconds = value * 24 * 60 * 60 * 1000;
      bucketType = value <= 7 ? "hour" : "day";
      break;
    case unit === "m":
      milliseconds = value * 30.44 * 24 * 60 * 60 * 1000;
      bucketType = "day";
      break;
    case unit === "y":
      milliseconds = value * 365.25 * 24 * 60 * 60 * 1000;
      bucketType = "day";
      break;
  }

  return { startDate: new Date(now.getTime() - milliseconds), bucketType };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
async function dashboardHandler(
  request: FastifyRequest<{ Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const period = request.query.period ?? "7d";
  const { startDate, bucketType } = parsePeriod(period);

  // 1. Fetch all sales in the period with their items
  const sales = await request.server.prisma.sale.findMany({
    where: { created_at: { gte: startDate } },
    include: {
      items: {
        select: {
          sale_price: true,
          profit: true,
          inventory_unit: {
            select: {
              catalog_ref: { select: { name: true } },
              catalog_ref_id: true,
            },
          },
        },
      },
    },
    orderBy: { created_at: "asc" },
  });

  // 2. Summary metrics
  const totalSales = sales.length;
  const totalRevenue = sales.reduce(
    (sum, s) => sum + Number(s.total_amount),
    0,
  );
  const totalProfit = sales.reduce((sum, s) => {
    const itemProfit = s.items.reduce(
      (isum, i) => isum + (i.profit ? Number(i.profit) : 0),
      0,
    );
    return sum + itemProfit;
  }, 0);

  // 3. Top 5 products
  const productSalesMap = new Map<string, { name: string; count: number }>();
  for (const sale of sales) {
    for (const item of sale.items) {
      const refId = item.inventory_unit.catalog_ref_id;
      const name = item.inventory_unit.catalog_ref?.name ?? "Unknown";
      const existing = productSalesMap.get(refId);
      if (existing) {
        existing.count++;
      } else {
        productSalesMap.set(refId, { name, count: 1 });
      }
    }
  }
  const topProducts = [...productSalesMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([catalog_ref_id, data]) => ({
      catalog_ref_id,
      product_name: data.name,
      units_sold: data.count,
    }));

  // 4. Inventory valuation
  const availableUnits = await request.server.prisma.inventoryUnit.findMany({
    where: { status: "AVAILABLE" },
    select: { dealer_cost: true },
  });
  const totalInventoryUnits = availableUnits.length;
  const totalInventoryValuation = availableUnits.reduce(
    (sum, u) => sum + Number(u.dealer_cost),
    0,
  );

  // 5. Sales over time
  const buckets = new Map<string, SalesOverTimeBucket>();
  for (const sale of sales) {
    const date = new Date(sale.created_at);
    let label: string;
    if (bucketType === "hour") {
      label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:00`;
    } else {
      label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    const existing = buckets.get(label);
    const itemProfit = sale.items.reduce(
      (sum, i) => sum + (i.profit ? Number(i.profit) : 0),
      0,
    );

    if (existing) {
      existing.sales_count++;
      existing.total_revenue += Number(sale.total_amount);
      existing.total_profit += itemProfit;
    } else {
      buckets.set(label, {
        label,
        sales_count: 1,
        total_revenue: Number(sale.total_amount),
        total_profit: itemProfit,
      });
    }
  }
  const salesOverTime = [...buckets.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  return reply.send({
    success: true,
    data: {
      period,
      period_hours: Math.round(
        (Date.now() - startDate.getTime()) / (60 * 60 * 1000),
      ),
      start_date: startDate.toISOString(),
      bucket_type: bucketType,
      summary: {
        total_sales: totalSales,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        total_profit: Math.round(totalProfit * 100) / 100,
        avg_order_value:
          totalSales > 0
            ? Math.round((totalRevenue / totalSales) * 100) / 100
            : 0,
      },
      top_products: topProducts,
      inventory_valuation: {
        available_units: totalInventoryUnits,
        total_dealer_cost: Math.round(totalInventoryValuation * 100) / 100,
      },
      sales_over_time: salesOverTime,
    },
  });
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------
export async function reportRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: DashboardQuery }>(
    "/v1/admin/reports/dashboard",
    { preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")] },
    dashboardHandler,
  );
}
