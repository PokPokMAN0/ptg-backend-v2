// =============================================================================
// Prime Tech Gallery – Admin Inventory Routes
// =============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";
import { validate } from "../../../middleware/validate";
import { z } from "zod";
import { logAudit } from "../../../services/audit.service";
import {
  addInventoryUnits,
  getInventoryUnits,
  getInventoryUnit,
} from "../../../services/inventory.service";
import { schema } from "../../../lib/schema";

// ---------------------------------------------------------------------------
// Zod schema for request body
// ---------------------------------------------------------------------------
const AddInventorySchema = z.object({
  catalog_id: z.string().min(1),
  batch_id: z.string().uuid().optional(),
  units: z
    .array(
      z.object({
        dealer_cost: z.number().min(0),
        imei1: z.string().optional(),
        imei2: z.string().optional(),
        serial: z.string().optional(),
        condition: z.string().optional(),
      }),
    )
    .nonempty(),
});

interface AddInventoryBody {
  catalog_id: string;
  batch_id?: string;
  units: {
    dealer_cost: number;
    retail_mrp: number;
    imei1?: string;
    imei2?: string;
    serial?: string;
    condition?: string;
  }[];
}

// ---------------------------------------------------------------------------
// POST /v1/admin/inventory
// ---------------------------------------------------------------------------
async function addInventoryHandler(
  request: FastifyRequest<{ Body: AddInventoryBody }>,
  reply: FastifyReply,
) {
  const { catalog_id, batch_id, units } = request.body;

  try {
    const { createdUnits, availableCount } = await addInventoryUnits(
      request.server.prisma,
      catalog_id,
      batch_id,
      units,
    );

    // Audit log for the first unit (or all – choose what fits)
    await logAudit(
      (request.user as any).sub,
      "INVENTORY_UNITS_CREATED",
      "inventory_units",
      catalog_id,
      { unitCount: createdUnits.length },
      request.ip,
    );

    return reply.status(201).send({
      success: true,
      data: {
        catalog_id,
        units_added: createdUnits.length,
        total_available: availableCount,
        units: createdUnits,
      },
    });
  } catch (err: any) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /v1/admin/inventory
// ---------------------------------------------------------------------------
async function listInventoryHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { catalog_id, status, limit, page } = request.query as any;
  const take = Math.min(parseInt(limit) || 20, 100);
  const pageNum = parseInt(page) || 1;

  const { units, total } = await getInventoryUnits(
    request.server.prisma,
    { catalogId: catalog_id, status },
    take,
    pageNum,
  );

  return reply.send({
    success: true,
    data: units,
    pagination: {
      page: pageNum,
      limit: take,
      total,
      totalPages: Math.ceil(total / take),
    },
  });
}

// ---------------------------------------------------------------------------
// GET /v1/admin/inventory/:id
// ---------------------------------------------------------------------------
async function getSingleInventoryHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const unit = await getInventoryUnit(request.server.prisma, request.params.id);
  if (!unit) {
    return reply.status(404).send({ success: false, error: "Unit not found." });
  }
  return reply.send({ success: true, data: unit });
}
// ---------------------------------------------------------------------------
// DELETE /v1/admin/inventory/:id – delete a single inventory unit
// ---------------------------------------------------------------------------
async function deleteInventoryHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const unit = await request.server.prisma.inventoryUnit.findUnique({
    where: { id: request.params.id },
  });

  if (!unit) {
    return reply.status(404).send({ success: false, error: "Unit not found." });
  }

  // Only allow deletion if the unit is not SOLD (or allow admin to force‑delete any)
  if (unit.status === "SOLD") {
    return reply.status(409).send({
      success: false,
      error: "Cannot delete a sold unit. This would break the sales record.",
    });
  }

  await request.server.prisma.inventoryUnit.delete({
    where: { id: request.params.id },
  });

  // Optionally re‑sync stock count to Catalog Engine
  // (you can add that later if needed)

  return reply.send({ success: true, data: { message: "Unit deleted." } });
}

// ---------------------------------------------------------------------------
// Zod schema for updating an inventory unit
// ---------------------------------------------------------------------------
const UpdateInventorySchema = z.object({
  dealer_cost: z.number().min(0).optional(),
  status: z
    .enum(["AVAILABLE", "SOLD", "DEFECTIVE", "RETURNED", "RESERVED"])
    .optional(),
  condition: z.enum(["NEW", "OPEN_BOX", "REFURBISHED"]).optional(),
  notes: z.string().optional(),
});

// ---------------------------------------------------------------------------
// PUT /v1/admin/inventory/:id – update an existing inventory unit
// ---------------------------------------------------------------------------
async function updateInventoryHandler(
  request: FastifyRequest<{
    Params: { id: string };
    Body: z.infer<typeof UpdateInventorySchema>;
  }>,
  reply: FastifyReply,
) {
  const { id } = request.params;
  const updates = request.body;

  // Verify the unit exists
  const existing = await request.server.prisma.inventoryUnit.findUnique({
    where: { id },
  });
  if (!existing) {
    return reply.status(404).send({ success: false, error: "Unit not found." });
  }

  const updated = await request.server.prisma.inventoryUnit.update({
    where: { id },
    data: updates,
    select: {
      id: true,
      catalog_ref_id: true,
      status: true,
      condition: true,
      dealer_cost: true,
      notes: true,
      created_at: true,
      updated_at: true,
    },
  });

  return reply.send({ success: true, data: updated });
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------
export async function inventoryRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: AddInventoryBody }>(
    "/v1/admin/inventory",
    {
      ...schema(AddInventorySchema),
      preHandler: [
        authenticate,
        requireRole("ADMIN", "SUPER_ADMIN"),
        validate(AddInventorySchema),
      ],
    },
    addInventoryHandler,
  );

  fastify.get(
    "/v1/admin/inventory",
    { preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")] },
    listInventoryHandler,
  );

  fastify.get<{ Params: { id: string } }>(
    "/v1/admin/inventory/:id",
    { preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")] },
    getSingleInventoryHandler,
  );
  fastify.delete<{ Params: { id: string } }>(
    "/v1/admin/inventory/:id",
    { preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")] },
    deleteInventoryHandler,
  );
  fastify.put<{
    Params: { id: string };
    Body: z.infer<typeof UpdateInventorySchema>;
  }>(
    "/v1/admin/inventory/:id",
    {
      preHandler: [
        authenticate,
        requireRole("ADMIN", "SUPER_ADMIN"),
        validate(UpdateInventorySchema),
      ],
    },
    updateInventoryHandler,
  );
}
