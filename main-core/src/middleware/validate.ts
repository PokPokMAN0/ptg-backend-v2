import { z, ZodSchema } from "zod";
import { FastifyRequest, FastifyReply } from "fastify";

export function validate(schema: ZodSchema) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      });
    }
    request.body = result.data;
  };
}
