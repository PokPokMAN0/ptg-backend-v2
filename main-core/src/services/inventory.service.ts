// =============================================================================
// Prime Tech Gallery – Inventory Service
// Handles inventory unit creation, listing, and decryption.
// =============================================================================

import { PrismaClient } from "../generated/prisma/client";
import { prepareInventoryFields, decryptField } from "./encryption.service";
import { fetchCatalogProduct, syncStockToCatalog } from "../business.rules";

// ---------------------------------------------------------------------------
// addInventoryUnits – creates one or more inventory units for a product.
// Returns the created units (safe fields only) and the new total available count.
// ---------------------------------------------------------------------------
export async function addInventoryUnits(
  prisma: PrismaClient,
  catalogId: string,
  batchId: string | undefined,
  units: {
    dealer_cost: number;
    imei1?: string;
    imei2?: string;
    serial?: string;
    condition?: string;
  }[],
) {
  // 1. Ensure CatalogRef exists (auto‑sync if needed)
  let catalogRef = await prisma.catalogRef.findUnique({
    where: { catalog_id: catalogId },
  });

  if (!catalogRef) {
    const catalogProduct = await fetchCatalogProduct(catalogId);
    if (!catalogProduct) {
      throw new Error(
        `Product not found in Catalog Engine for id: ${catalogId}`,
      );
    }
    catalogRef = await prisma.catalogRef.create({
      data: {
        catalog_id: catalogId,
        sku: catalogProduct.sku,
        name: catalogProduct.name,
        brand: catalogProduct.brand,
        category: catalogProduct.category,
        retail_mrp: catalogProduct.retail_mrp,
      },
    });
  }

  // 2. If a batch_id is provided, verify it exists
  if (batchId) {
    const batch = await prisma.inventoryBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }
  }

  // 3. Create all units with encryption
  const createdUnits = [];
  for (const unit of units) {
    const secureFields = prepareInventoryFields({
      imei1: unit.imei1,
      imei2: unit.imei2,
      serial: unit.serial,
    });

    const createData: any = {
      catalog_ref: { connect: { id: catalogRef.id } },
      dealer_cost: unit.dealer_cost,
      condition: unit.condition || "NEW",
    };
    if (batchId) createData.batch = { connect: { id: batchId } };
    if (secureFields.imei_1) createData.imei_1 = secureFields.imei_1;
    if (secureFields.imei_1_hash)
      createData.imei_1_hash = secureFields.imei_1_hash;
    if (secureFields.imei_2) createData.imei_2 = secureFields.imei_2;
    if (secureFields.imei_2_hash)
      createData.imei_2_hash = secureFields.imei_2_hash;
    if (secureFields.serial_number)
      createData.serial_number = secureFields.serial_number;
    if (secureFields.serial_hash)
      createData.serial_hash = secureFields.serial_hash;

    const created = await prisma.inventoryUnit.create({
      data: createData,
      select: {
        id: true,
        catalog_ref_id: true,
        status: true,
        condition: true,
        created_at: true,
      },
    });
    createdUnits.push(created);
  }
  // 4. Push updated stock count to Catalog Engine
  const availableCount = await prisma.inventoryUnit.count({
    where: { catalog_ref_id: catalogRef.id, status: "AVAILABLE" },
  });
  await syncStockToCatalog(catalogId, availableCount);

  return { createdUnits, availableCount };
}

// ---------------------------------------------------------------------------
// getInventoryUnits – list inventory units with decrypted fields.
// ---------------------------------------------------------------------------
export async function getInventoryUnits(
  prisma: PrismaClient,
  filters: { catalogId?: string; status?: string },
  limit: number,
  page: number,
) {
  const where: any = {};
  if (filters.catalogId) {
    const catalogRef = await prisma.catalogRef.findUnique({
      where: { catalog_id: filters.catalogId },
    });
    if (catalogRef) where.catalog_ref_id = catalogRef.id;
  }
  if (filters.status) where.status = filters.status;

  const skip = (page - 1) * limit;
  const [units, total] = await Promise.all([
    prisma.inventoryUnit.findMany({
      where,
      include: {
        catalog_ref: {
          select: { catalog_id: true, name: true, sku: true, retail_mrp: true },
        },
        batch: { select: { id: true, invoice_number: true } },
      },
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
    }),
    prisma.inventoryUnit.count({ where }),
  ]);

  // Decrypt sensitive fields for admin view
  const plainUnits = units.map((unit) => ({
    ...unit,
    imei_1: unit.imei_1 ? decryptField(unit.imei_1) : null,
    imei_2: unit.imei_2 ? decryptField(unit.imei_2) : null,
    serial_number: unit.serial_number ? decryptField(unit.serial_number) : null,
    retail_mrp: unit.catalog_ref?.retail_mrp,
  }));

  return { units: plainUnits, total, page, limit };
}

// ---------------------------------------------------------------------------
// getInventoryUnit – single unit with decrypted fields.
// ---------------------------------------------------------------------------
export async function getInventoryUnit(prisma: PrismaClient, id: string) {
  const unit = await prisma.inventoryUnit.findUnique({
    where: { id },
    include: {
      catalog_ref: {
        select: { catalog_id: true, name: true, sku: true, retail_mrp: true },
      },
      batch: { select: { id: true, invoice_number: true } },
    },
  });

  if (!unit) return null;

  return {
    ...unit,
    imei_1: unit.imei_1 ? decryptField(unit.imei_1) : null,
    imei_2: unit.imei_2 ? decryptField(unit.imei_2) : null,
    serial_number: unit.serial_number ? decryptField(unit.serial_number) : null,
    retail_mrp: unit.catalog_ref?.retail_mrp,
  };
}
