// =============================================================================
// Prime Tech Gallery – Sales Service (POS)
// Handles barcode scanning, atomic sale creation, warranty, and stock sync.
// =============================================================================

import { PrismaClient } from "../generated/prisma/client";
import { hashField } from "./encryption.service";
import {
  fetchProductMetadata,
  syncStockToCatalog,
  calculateProfit,
} from "../business.rules";

interface SaleOptions {
  barcode: string;
  salesmanId: string;
  finalSalePrice: number;
  paymentMethod: string;
  customerInfo?: { name: string; phone: string };
}

export async function processSale(prisma: PrismaClient, options: SaleOptions) {
  const { barcode, salesmanId, finalSalePrice, paymentMethod, customerInfo } =
    options;

  // 1. Hash the scanned barcode
  const barcodeHash = hashField(barcode);

  // 2. Find an AVAILABLE unit
  const unit = await prisma.inventoryUnit.findFirst({
    where: {
      OR: [
        { imei_1_hash: barcodeHash },
        { imei_2_hash: barcodeHash },
        { serial_hash: barcodeHash },
      ],
      status: "AVAILABLE",
    },
    include: {
      catalog_ref: {
        select: { catalog_id: true, name: true, brand: true, retail_mrp: true },
      },
    },
  });

  if (!unit) {
    throw new Error("Barcode not found or item is no longer available.");
  }

  // 3. Fetch warranty metadata from Catalog Engine
  const warrantyMeta = await fetchProductMetadata(unit.catalog_ref.catalog_id);

  // 4. Atomic transaction
  const result = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        salesman_id: salesmanId,
        total_amount: finalSalePrice,
        payment_method: paymentMethod as any,
        source: "POS",
        status: "COMPLETED",
        customer_info: customerInfo || undefined,
        items: {
          create: {
            inventory_unit_id: unit.id,
            unit_price:
              warrantyMeta?.retail_mrp ?? Number(unit.catalog_ref.retail_mrp),
            sale_price: finalSalePrice,
            dealer_cost: unit.dealer_cost,
            profit: calculateProfit(finalSalePrice, Number(unit.dealer_cost)),
          },
        },
      },
      include: {
        items: {
          include: {
            inventory_unit: { select: { id: true, catalog_ref_id: true } },
          },
        },
      },
    });

    // Mark unit as SOLD
    await tx.inventoryUnit.update({
      where: { id: unit.id },
      data: { status: "SOLD" },
    });

    // Create warranty if applicable
    let warranty = null;
    if (warrantyMeta && warrantyMeta.warranty_value > 0) {
      const saleItem = sale.items[0];
      warranty = await tx.warranty.create({
        data: {
          inventory_unit_id: unit.id,
          sale_item_id: saleItem.id,
          duration_months: Math.ceil(warrantyMeta.warranty_value / 30),
          expires_at: new Date(
            Date.now() + warrantyMeta.warranty_value * 24 * 60 * 60 * 1000,
          ),
          warrantor: warrantyMeta.brand || "Prime Tech Gallery",
          status: "ACTIVE",
        },
      });
    }

    return { sale, warranty };
  });

  // 5. Sync stock count to Catalog Engine
  const availableCount = await prisma.inventoryUnit.count({
    where: { catalog_ref_id: unit.catalog_ref_id, status: "AVAILABLE" },
  });
  await syncStockToCatalog(unit.catalog_ref.catalog_id, availableCount);

  return {
    saleId: result.sale.id,
    total: result.sale.total_amount,
    items: result.sale.items.map((item) => ({
      saleItemId: item.id,
      productName: unit.catalog_ref.name,
      soldFor: item.sale_price,
      profit: item.profit,
    })),
    warranty: result.warranty
      ? {
          id: result.warranty.id,
          durationMonths: result.warranty.duration_months,
          expiresAt: result.warranty.expires_at,
          warrantor: result.warranty.warrantor,
        }
      : null,
    customer: customerInfo || null,
    soldBy: salesmanId,
    createdAt: result.sale.created_at,
  };
}
