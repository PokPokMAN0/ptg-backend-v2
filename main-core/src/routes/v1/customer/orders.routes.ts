import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../../../middleware/auth.middleware";

async function getOrdersHandler(request: FastifyRequest, reply: FastifyReply) {
  const userId = (request.user as any).sub;
  const { limit, page } = request.query as any;
  const take = Math.min(parseInt(limit) || 20, 50);
  const skip = ((parseInt(page) || 1) - 1) * take;

  const [orders, total] = await Promise.all([
    request.server.prisma.sale.findMany({
      where: { buyer_id: userId },
      include: {
        items: {
          include: {
            inventory_unit: {
              select: { catalog_ref: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { created_at: "desc" },
      skip,
      take,
    }),
    request.server.prisma.sale.count({ where: { buyer_id: userId } }),
  ]);

  return reply.send({
    success: true,
    data: orders,
    pagination: {
      page: parseInt(page) || 1,
      limit: take,
      total,
      totalPages: Math.ceil(total / take),
    },
  });
}

export async function customerOrderRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/v1/customer/orders",
    { preHandler: [authenticate] },
    getOrdersHandler,
  );
}
