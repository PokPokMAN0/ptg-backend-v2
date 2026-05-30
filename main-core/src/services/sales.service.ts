// =============================================================================
// Prime Tech Gallery – Sales Service (POS)
// Single‑item & multi‑item sales, auto‑customer, receipt output.
// =============================================================================

import { PrismaClient } from "../generated/prisma/client";
import { randomBytes } from "node:crypto";
import { hashField, hashPassword } from "./encryption.service";
import {
  fetchProductMetadata,
  syncStockToCatalog,
  calculateProfit,
} from "../business.rules";

// ── Single‑item options (unchanged) ──────────────────────────────────
interface SaleOptions {
  barcode?: string;
  classId?: string;
  salesmanId: string;
  finalSalePrice: number;
  paymentMethod: string;
  customerInfo?: { name: string; phone: string };
}

// ── Multi‑item options (updated) ─────────────────────────────────────
interface MultiItemSaleOptions {
  items: {
    barcode?: string;
    class_id?: string;
    final_sale_price: number;
  }[];
  salesmanId: string;
  paymentMethod: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
}

// ======================================================================
// Single‑item sale (unchanged)
// ======================================================================
export async function processSale(prisma: PrismaClient, options: SaleOptions) {
  const {
    barcode,
    classId,
    salesmanId,
    finalSalePrice,
    paymentMethod,
    customerInfo,
  } = options;

  let unit;

  if (classId) {
    const catalogRef = await prisma.catalogRef.findFirst({
      where: { OR: [{ catalog_id: classId }, { sku: classId }] },
    });
    if (!catalogRef)
      throw new Error("Product not found for the given class_id.");
    unit = await prisma.inventoryUnit.findFirst({
      where: { catalog_ref_id: catalogRef.id, status: "AVAILABLE" },
      include: {
        catalog_ref: {
          select: {
            catalog_id: true,
            name: true,
            brand: true,
            retail_mrp: true,
          },
        },
      },
    });
    if (!unit) throw new Error("No available stock for this product.");
  }

  if (barcode) {
    const barcodeHash = hashField(barcode);
    unit = await prisma.inventoryUnit.findFirst({
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
          select: {
            catalog_id: true,
            name: true,
            brand: true,
            retail_mrp: true,
          },
        },
      },
    });
    if (!unit)
      throw new Error("Barcode not found or item is no longer available.");
  }

  if (!unit) throw new Error("Either barcode or class_id must be provided.");

  const warrantyMeta = await fetchProductMetadata(unit.catalog_ref.catalog_id);

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

    await tx.inventoryUnit.update({
      where: { id: unit.id },
      data: { status: "SOLD" },
    });

    let warranty = null;
    if (warrantyMeta && warrantyMeta.warranty_value > 0) {
      const saleItem = sale.items[0];
      warranty = await tx.warranty.create({
        data: {
          inventory_unit_id: unit.id,
          sale_item_id: saleItem.id,
          duration_months: Math.round(warrantyMeta.warranty_value / 30.44),
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

// ======================================================================
// Multi‑item sale (auto‑customer, address, receipt output)
// ======================================================================
export async function processMultiItemSale(
  prisma: PrismaClient,
  options: MultiItemSaleOptions,
) {
  const {
    items,
    salesmanId,
    paymentMethod,
    customerName,
    customerPhone,
    customerAddress,
  } = options;

  // ── 0. Auto‑create / lookup customer ──────────────────────────────
  let buyer = await prisma.user.findUnique({ where: { phone: customerPhone } });

  if (!buyer) {
    const randomPwd = randomBytes(16).toString("hex");
    const password_hash = await hashPassword(randomPwd);

    buyer = await prisma.user.create({
      data: {
        name: customerName,
        phone: customerPhone,
        email: `pos-${Date.now()}@pos.local`,
        password_hash,
        role: "CUSTOMER",
        is_verified: true,
        is_active: true,
      },
    });
  }

  if (customerAddress) {
    await prisma.address.create({
      data: {
        user_id: buyer.id,
        type: "SHIPPING",
        label: "POS Sale",
        recipient: customerName,
        phone: customerPhone,
        line_1: customerAddress,
        city: "",
        district: "",
        is_default: true,
      },
    });
  }

  // ── 1. Resolve all inventory units ────────────────────────────────
  const resolvedUnits: Array<{ unit: any; finalPrice: number }> = [];

  for (const item of items) {
    let unit;

    if (item.class_id) {
      const catalogRef = await prisma.catalogRef.findFirst({
        where: { OR: [{ catalog_id: item.class_id }, { sku: item.class_id }] },
      });
      if (!catalogRef)
        throw new Error(`Product not found for class_id: ${item.class_id}`);

      unit = (await prisma.inventoryUnit.findFirst({
        where: { catalog_ref_id: catalogRef.id, status: "AVAILABLE" },
        include: {
          catalog_ref: {
            select: {
              catalog_id: true,
              name: true,
              brand: true,
              retail_mrp: true,
            },
          },
        },
      })) as any;
    } else if (item.barcode) {
      const barcodeHash = hashField(item.barcode);
      unit = (await prisma.inventoryUnit.findFirst({
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
            select: {
              catalog_id: true,
              name: true,
              brand: true,
              retail_mrp: true,
            },
          },
        },
      })) as any;
    }

    if (!unit) {
      const identifier = item.barcode || item.class_id;
      throw new Error(`No available stock for: ${identifier}`);
    }

    resolvedUnits.push({ unit: unit!, finalPrice: item.final_sale_price });
  }

  const totalAmount = resolvedUnits.reduce((sum, r) => sum + r.finalPrice, 0);

  // ── 2. Atomic transaction ─────────────────────────────────────────
  const saleResult = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        salesman_id: salesmanId,
        buyer_id: buyer.id,
        total_amount: totalAmount,
        payment_method: paymentMethod as any,
        source: "POS",
        status: "COMPLETED",
        customer_info: { name: customerName, phone: customerPhone },
        items: {
          create: resolvedUnits.map((r) => ({
            inventory_unit_id: r.unit!.id,
            unit_price: Number(r.unit!.catalog_ref.retail_mrp),
            sale_price: r.finalPrice,
            dealer_cost: r.unit!.dealer_cost,
            profit: calculateProfit(r.finalPrice, Number(r.unit!.dealer_cost)),
          })),
        },
      },
      include: {
        items: {
          include: {
            inventory_unit: {
              select: {
                id: true,
                catalog_ref: { select: { name: true } },
                warranty: {
                  select: {
                    duration_months: true,
                    warrantor: true,
                    expires_at: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    for (const r of resolvedUnits) {
      await tx.inventoryUnit.update({
        where: { id: r.unit!.id },
        data: { status: "SOLD" },
      });
    }

    return sale;
  });

  // ── 3. Sync stock ─────────────────────────────────────────────────
  const distinctCatalogIds = new Set(
    resolvedUnits.map((r) => r.unit!.catalog_ref.catalog_id),
  );
  for (const catalogId of distinctCatalogIds) {
    const availableCount = await prisma.inventoryUnit.count({
      where: { catalog_ref: { catalog_id: catalogId }, status: "AVAILABLE" },
    });
    await syncStockToCatalog(catalogId, availableCount);
  }

  // ── 4. Build receipt‑ready response (no profit in public output) ───
  return {
    saleId: saleResult.id,
    total: saleResult.total_amount,
    payment_method: paymentMethod,
    customer: {
      name: customerName,
      phone: customerPhone,
      address: customerAddress || null,
    },
    items: saleResult.items.map((item) => ({
      saleItemId: item.id,
      productName: item.inventory_unit.catalog_ref?.name ?? "—",
      sale_price: item.sale_price,
      warranty: item.inventory_unit.warranty
        ? {
            duration_months: item.inventory_unit.warranty.duration_months,
            warrantor: item.inventory_unit.warranty.warrantor,
            expires_at: item.inventory_unit.warranty.expires_at,
          }
        : null,
    })),
    soldBy: salesmanId,
    createdAt: saleResult.created_at,
    totalProfit: saleResult.items.reduce(
      (sum, item) => sum + (Number(item.profit) || 0),
      0,
    ),
  };
}
