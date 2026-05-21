// =============================================================================
// Prime Tech Gallery – Auth middleware
// Verifies the JWT access token on every protected route.
// =============================================================================

import { FastifyRequest, FastifyReply } from "fastify";

/**
 * PreHandler hook that calls `request.jwtVerify()`.
 * On success, `request.user` is automatically populated with the token payload
 * (e.g. { sub, role, email }).
 * On failure, returns 401 Unauthorized.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ success: false, error: "Unauthorized" });
  }
}
