// =============================================================================
// Prime Tech Gallery – Role‑based access control middleware
// Must be used AFTER `authenticate`.
// =============================================================================

import { FastifyRequest, FastifyReply } from "fastify";

/**
 * Factory that returns a preHandler hook restricting access to the given roles.
 *
 * Usage:
 *   preHandler: [authenticate, requireRole("ADMIN", "SUPER_ADMIN")]
 */
export function requireRole(...allowedRoles: string[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    // `request.user` was set by the previous `authenticate` middleware
    const user = request.user as
      | { sub: string; role: string; email: string }
      | undefined;

    if (!user || !allowedRoles.includes(user.role)) {
      return reply.status(403).send({
        success: false,
        error: "Forbidden: insufficient permissions",
      });
    }
  };
}
