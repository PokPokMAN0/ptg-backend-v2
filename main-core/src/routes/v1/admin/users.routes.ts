// =============================================================================
// Prime Tech Gallery – Admin User Management Routes
// =============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { requireRole } from "../../../middleware/require-role.middleware";
import { validate } from "../../../middleware/validate";
import { z } from "zod";
import { logAudit } from "../../../services/audit.service";
import { schema } from "../../../lib/schema";

// ---------------------------------------------------------------------------
// GET /v1/admin/users – list all users (paginated)
// ---------------------------------------------------------------------------
async function listUsersHandler(request: FastifyRequest, reply: FastifyReply) {
  const { limit, page } = request.query as any;
  const take = Math.min(parseInt(limit) || 20, 100);
  const skip = ((parseInt(page) || 1) - 1) * take;

  const [users, total] = await Promise.all([
    request.server.prisma.user.findMany({
      where: { is_verified: true }, // hide unverified users
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        image_url: true,
        is_active: true,
        is_verified: true,
        last_login_at: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: { created_at: "desc" },
      skip,
      take,
    }),
    request.server.prisma.user.count({ where: { is_verified: true } }),
  ]);

  return reply.send({
    success: true,
    data: users,
    pagination: {
      page: parseInt(page) || 1,
      limit: take,
      total,
      totalPages: Math.ceil(total / take),
    },
  });
}
// ---------------------------------------------------------------------------
// PUT /v1/admin/users/:id/role – change a user's role
// ---------------------------------------------------------------------------
const ChangeRoleSchema = z.object({
  role: z.enum(["SUPER_ADMIN", "ADMIN", "SALESMAN", "CUSTOMER"]),
});

async function changeRoleHandler(
  request: FastifyRequest<{
    Params: { id: string };
    Body: z.infer<typeof ChangeRoleSchema>;
  }>,
  reply: FastifyReply,
) {
  const actor = request.user as { sub: string; role: string };
  const targetId = request.params.id;
  const { role } = request.body;

  if (actor.sub === targetId) {
    return reply
      .status(400)
      .send({ success: false, error: "You cannot change your own role." });
  }

  const targetUser = await request.server.prisma.user.findUnique({
    where: { id: targetId },
  });

  if (!targetUser) {
    return reply.status(404).send({ success: false, error: "User not found." });
  }

  if (
    (role === "SUPER_ADMIN" ||
      targetUser.role === "SUPER_ADMIN" ||
      targetUser.role === "ADMIN") &&
    actor.role !== "SUPER_ADMIN"
  ) {
    return reply.status(403).send({
      success: false,
      error: "Only SUPER_ADMIN can manage admin roles.",
    });
  }

  const updatedUser = await request.server.prisma.user.update({
    where: { id: targetId },
    data: { role },
    select: { id: true, email: true, name: true, role: true },
  });

  await logAudit(
    actor.sub,
    "USER_ROLE_CHANGED",
    "users",
    targetId,
    {
      old_role: targetUser.role,
      new_role: role,
    },
    request.ip,
  );

  return reply.send({ success: true, data: updatedUser });
}

// ---------------------------------------------------------------------------
// DELETE /v1/admin/users/:id – delete a user and all their related data
// ---------------------------------------------------------------------------
async function deleteUserHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const actor = request.user as { sub: string; role: string };
  const targetId = request.params.id;

  // 1. Self‑deletion is only allowed for CUSTOMER accounts
  if (actor.sub === targetId) {
    if (actor.role !== "CUSTOMER") {
      return reply.status(403).send({
        success: false,
        error:
          "Only customers can delete their own account. Admins and salesmen cannot self‑delete.",
      });
    }
    // For customers, we let them pass — the actual deletion will happen through the customer endpoint.
    // But this admin route is meant for managing *other* users, so a customer shouldn't reach it
    // because they can't call admin routes anyway. We'll simply return an error suggesting
    // they use the customer endpoint.
    return reply.status(400).send({
      success: false,
      error:
        "Please use the customer account deletion endpoint to delete your own account.",
    });
  }

  // 2. Find the target user
  const targetUser = await request.server.prisma.user.findUnique({
    where: { id: targetId },
  });
  if (!targetUser) {
    return reply.status(404).send({ success: false, error: "User not found." });
  }

  // 3. Role‑based restrictions for deleting others
  if (actor.role === "ADMIN") {
    // Admin can only delete SALESMAN and CUSTOMER
    if (targetUser.role === "ADMIN" || targetUser.role === "SUPER_ADMIN") {
      return reply.status(403).send({
        success: false,
        error: "Admins can only delete salesmen and customer accounts.",
      });
    }
  } else if (actor.role === "SUPER_ADMIN") {
    // Super admin can delete anyone (including other admins)
  } else {
    // Salesman or customer should not be here because the route requires ADMIN/SUPER_ADMIN
    return reply
      .status(403)
      .send({ success: false, error: "Insufficient permissions." });
  }

  // 4. Wipe all related records inside a transaction
  await request.server.prisma.$transaction(async (tx) => {
    await tx.sale.updateMany({
      where: { salesman_id: targetId },
      data: { salesman_id: null } as any,
    });
    await tx.sale.updateMany({
      where: { buyer_id: targetId },
      data: { buyer_id: null } as any,
    });
    await tx.inventoryBatch.updateMany({
      where: { recorded_by_id: targetId },
      data: { recorded_by_id: actor.sub } as any,
    });
    await tx.otpCode.deleteMany({ where: { user_id: targetId } });
    await tx.refreshToken.deleteMany({ where: { user_id: targetId } });
    await tx.auditLog.deleteMany({ where: { actor_id: targetId } });
    await tx.cartItem.deleteMany({ where: { user_id: targetId } });
    await tx.wishlistItem.deleteMany({ where: { user_id: targetId } });
    await tx.address.deleteMany({ where: { user_id: targetId } });
    await tx.user.delete({ where: { id: targetId } });
  });

  await logAudit(
    actor.sub,
    "USER_DELETED",
    "users",
    targetId,
    {
      email: targetUser.email,
      role: targetUser.role,
    },
    request.ip,
  );

  return reply.send({ success: true, message: "User deleted." });
}

// PUT /v1/admin/users/:id/profile – update another user's name/phone/image
const AdminUpdateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  image_url: z.string().url().optional().nullable(),
  email: z.string().email().optional(),
});

async function adminUpdateProfileHandler(
  request: FastifyRequest<{
    Params: { id: string };
    Body: z.infer<typeof AdminUpdateProfileSchema>;
  }>,
  reply: FastifyReply,
) {
  const actor = request.user as { sub: string };
  const targetId = request.params.id;
  const allowedFields: any = { ...request.body };

  const updatedUser = await request.server.prisma.user.update({
    where: { id: targetId },
    data: allowedFields,
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      image_url: true,
      role: true,
    },
  });

  await logAudit(
    actor.sub,
    "USER_PROFILE_UPDATED_BY_ADMIN",
    "users",
    targetId,
    allowedFields,
    request.ip,
  );

  return reply.send({ success: true, data: updatedUser });
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------
export async function userManagementRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/v1/admin/users",
    { preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")] },
    listUsersHandler,
  );

  fastify.put<{
    Params: { id: string };
    Body: z.infer<typeof ChangeRoleSchema>;
  }>(
    "/v1/admin/users/:id/role",
    {
      ...schema(ChangeRoleSchema),
      preHandler: [
        authenticate,
        requireRole("SUPER_ADMIN"),
        validate(ChangeRoleSchema),
      ],
    },
    changeRoleHandler,
  );

  fastify.delete<{ Params: { id: string } }>(
    "/v1/admin/users/:id",
    { preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")] },
    deleteUserHandler,
  );

  fastify.put<{
    Params: { id: string };
    Body: z.infer<typeof AdminUpdateProfileSchema>;
  }>(
    "/v1/admin/users/:id/profile",
    {
      ...schema(ChangeRoleSchema),
      preHandler: [
        authenticate,
        requireRole("ADMIN", "SUPER_ADMIN"),
        validate(AdminUpdateProfileSchema),
      ],
    },
    adminUpdateProfileHandler,
  );
}
