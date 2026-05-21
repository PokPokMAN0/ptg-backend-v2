import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";

// --- Cart ---
async function getCartHandler(request: FastifyRequest, reply: FastifyReply) {
  const userId = (request.user as any).sub;
  const items = await request.server.prisma.cartItem.findMany({
    where: { user_id: userId },
    include: {
      catalog_ref: {
        select: { catalog_id: true, name: true, retail_mrp: true },
      },
    },
  });
  return reply.send({ success: true, data: items });
}

async function addToCartHandler(
  request: FastifyRequest<{
    Body: { catalog_ref_id: string; quantity: number };
  }>,
  reply: FastifyReply,
) {
  const userId = (request.user as any).sub;
  const { catalog_ref_id, quantity } = request.body;
  const existing = await request.server.prisma.cartItem.findUnique({
    where: { user_id_catalog_ref_id: { user_id: userId, catalog_ref_id } },
  });
  if (existing) {
    const updated = await request.server.prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + quantity },
    });
    return reply.send({ success: true, data: updated });
  }
  const item = await request.server.prisma.cartItem.create({
    data: { user_id: userId, catalog_ref_id, quantity },
  });
  return reply.send({ success: true, data: item });
}

async function removeFromCartHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const userId = (request.user as any).sub;
  await request.server.prisma.cartItem.deleteMany({
    where: { id: request.params.id, user_id: userId },
  });
  return reply.send({ success: true, message: "Item removed" });
}

// --- Wishlist ---
async function getWishlistHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const userId = (request.user as any).sub;
  const items = await request.server.prisma.wishlistItem.findMany({
    where: { user_id: userId },
    include: {
      catalog_ref: {
        select: { catalog_id: true, name: true, retail_mrp: true },
      },
    },
  });
  return reply.send({ success: true, data: items });
}

async function addToWishlistHandler(
  request: FastifyRequest<{ Body: { catalog_ref_id: string } }>,
  reply: FastifyReply,
) {
  const userId = (request.user as any).sub;
  try {
    const item = await request.server.prisma.wishlistItem.create({
      data: { user_id: userId, catalog_ref_id: request.body.catalog_ref_id },
    });
    return reply.send({ success: true, data: item });
  } catch (err: any) {
    if (err.code === "P2002")
      return reply
        .status(409)
        .send({ success: false, error: "Already in wishlist" });
    throw err;
  }
}

async function removeFromWishlistHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const userId = (request.user as any).sub;
  await request.server.prisma.wishlistItem.deleteMany({
    where: { id: request.params.id, user_id: userId },
  });
  return reply.send({ success: true, message: "Item removed" });
}

export async function customerCartWishlistRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/v1/customer/cart",
    { preHandler: [authenticate] },
    getCartHandler,
  );
  fastify.post<{ Body: { catalog_ref_id: string; quantity: number } }>(
    "/v1/customer/cart",
    { preHandler: [authenticate] },
    addToCartHandler,
  );
  fastify.delete<{ Params: { id: string } }>(
    "/v1/customer/cart/:id",
    { preHandler: [authenticate] },
    removeFromCartHandler,
  );
  fastify.get(
    "/v1/customer/wishlist",
    { preHandler: [authenticate] },
    getWishlistHandler,
  );
  fastify.post<{ Body: { catalog_ref_id: string } }>(
    "/v1/customer/wishlist",
    { preHandler: [authenticate] },
    addToWishlistHandler,
  );
  fastify.delete<{ Params: { id: string } }>(
    "/v1/customer/wishlist/:id",
    { preHandler: [authenticate] },
    removeFromWishlistHandler,
  );
}
