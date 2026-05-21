// =============================================================================
// Prime Tech Gallery – Customer Account Management
// DELETE /v1/customer/account         – delete own account
// PUT   /v1/customer/account          – update own profile (name, phone, image)
// PUT   /v1/customer/account/password – change own password
// =============================================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";
import { validate } from "../../../middleware/validate";
import { z } from "zod";
import {
  hashPassword,
  verifyPassword,
} from "../../../services/encryption.service";
import { logAudit } from "../../../services/audit.service";
import { schema } from "../../../lib/schema";

// ---------------------------------------------------------------------------
// DELETE own account (already exists – kept for completeness)
// ---------------------------------------------------------------------------
async function deleteOwnAccountHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const actor = request.user as { sub: string; role: string; email: string };

  if (actor.role !== "CUSTOMER") {
    return reply.status(403).send({
      success: false,
      error:
        "Only customer accounts can be self‑deleted. Please contact an administrator.",
    });
  }

  const targetId = actor.sub;

  await request.server.prisma.$transaction(async (tx) => {
    await tx.sale.updateMany({
      where: { buyer_id: targetId },
      data: { buyer_id: null } as any,
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
    "USER_SELF_DELETED",
    "users",
    targetId,
    {
      email: actor.email,
      role: actor.role,
    },
    request.ip,
  );

  reply.clearCookie("refresh_token", { path: "/v1/auth" });

  // FIXED: Correct success message wrapped in data envelope
  return reply.send({
    success: true,
    data: { message: "Your account has been permanently deleted." },
  });
}

// ---------------------------------------------------------------------------
// Update own profile
// ---------------------------------------------------------------------------
const UpdateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  image_url: z.string().url().optional().nullable(),
  email: z.string().email().optional(), // optional – changing email may require re‑verification
});

async function updateProfileHandler(
  request: FastifyRequest<{ Body: z.infer<typeof UpdateProfileSchema> }>,
  reply: FastifyReply,
) {
  const { sub } = request.user as { sub: string };
  const allowedFields: any = {};

  if (request.body.name !== undefined) allowedFields.name = request.body.name;
  if (request.body.phone !== undefined)
    allowedFields.phone = request.body.phone;
  if (request.body.image_url !== undefined)
    allowedFields.image_url = request.body.image_url;
  // Email change – be cautious; you might want to trigger re‑verification
  if (request.body.email !== undefined)
    allowedFields.email = request.body.email;

  const updatedUser = await request.server.prisma.user.update({
    where: { id: sub },
    data: allowedFields,
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      image_url: true,
      role: true,
      updated_at: true,
    },
  });

  await logAudit(
    sub,
    "USER_PROFILE_UPDATED",
    "users",
    sub,
    allowedFields,
    request.ip,
  );

  return reply.send({ success: true, data: updatedUser });
}

// ---------------------------------------------------------------------------
// Change own password (requires current password)
// ---------------------------------------------------------------------------
const ChangePasswordSchema = z.object({
  current_password: z.string(),
  new_password: z
    .string()
    .min(8)
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[0-9]/, "Must contain a digit"),
});

async function changePasswordHandler(
  request: FastifyRequest<{ Body: z.infer<typeof ChangePasswordSchema> }>,
  reply: FastifyReply,
) {
  const { sub } = request.user as { sub: string };
  const { current_password, new_password } = request.body;

  // Fetch current user with password hash
  const user = await request.server.prisma.user.findUnique({
    where: { id: sub },
    select: { password_hash: true },
  });

  if (!user) {
    return reply.status(404).send({ success: false, error: "User not found." });
  }

  // Verify current password
  const valid = await verifyPassword(user.password_hash, current_password);
  if (!valid) {
    return reply
      .status(400)
      .send({ success: false, error: "Current password is incorrect." });
  }

  // Hash new password
  const newHash = await hashPassword(new_password);
  await request.server.prisma.user.update({
    where: { id: sub },
    data: { password_hash: newHash },
  });

  await logAudit(sub, "USER_PASSWORD_CHANGED", "users", sub, null, request.ip);

  // FIXED: Wrapped the message inside a data object for consistent API envelope
  return reply.send({
    success: true,
    data: { message: "Password changed successfully." },
  });
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------
export async function customerAccountRoutes(fastify: FastifyInstance) {
  fastify.delete(
    "/v1/customer/account",
    { preHandler: [authenticate] },
    deleteOwnAccountHandler,
  );

  fastify.put<{ Body: z.infer<typeof UpdateProfileSchema> }>(
    "/v1/customer/account",
    {
      ...schema(UpdateProfileSchema),
      preHandler: [authenticate, validate(UpdateProfileSchema)],
    },
    updateProfileHandler,
  );

  fastify.put<{ Body: z.infer<typeof ChangePasswordSchema> }>(
    "/v1/customer/account/password",
    {
      ...schema(ChangePasswordSchema),
      preHandler: [authenticate, validate(ChangePasswordSchema)],
    },
    changePasswordHandler,
  );
}
