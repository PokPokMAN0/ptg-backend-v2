// =============================================================================
// Prime Tech Gallery — Main Core Server (Fastify + Prisma 7 + JWT)
// =============================================================================

// 1. Load environment variables BEFORE any other module touches process.env
import { config } from "./config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fjwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { PrismaClient } from "./lib/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import fastifyHelmet from "@fastify/helmet";
import { authRoutes } from "./routes/v1/auth/auth.routes";
import { catalogSyncRoutes } from "./routes/v1/admin/catalog-sync.routes";
import { inventoryRoutes } from "./routes/v1/admin/inventory.routes";
import { posSalesRoutes } from "./routes/v1/pos/sales.routes";
import { reportRoutes } from "./routes/v1/admin/reports.routes";
import { salesListRoutes } from "./routes/v1/admin/sales-list.routes";
import { productManageRoutes } from "./routes/v1/admin/product-manage.routes";
import { supplierRoutes } from "./routes/v1/admin/supplier.routes";
import { batchRoutes } from "./routes/v1/admin/batch.routes";
import { warrantyRoutes } from "./routes/v1/admin/warranty.routes";
import { customerCartWishlistRoutes } from "./routes/v1/customer/cart-wishlist.routes";
import { addressRoutes } from "./routes/v1/customer/address.routes";
import { customerOrderRoutes } from "./routes/v1/customer/orders.routes";
import { webOrderRoutes } from "./routes/v1/checkout/web-order.routes";
import { userManagementRoutes } from "./routes/v1/admin/users.routes";
import { customerAccountRoutes } from "./routes/v1/customer/account.routes";
import { posLookupRoutes } from "./routes/v1/pos/lookup.routes";
import { posSearchInventoryRoutes } from "./routes/v1/pos/search-inventory.routes";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { logger } from "./lib/logger";

// ---------------------------------------------------------------------------
// Environment guard – fail fast if critical vars are missing
// ---------------------------------------------------------------------------
const requiredEnvVars = [
  "DATABASE_URL",
  "JWT_SECRET",
  "IMEI_ENCRYPTION_KEY",
  "HASH_SECRET",
  "CATALOG_ENGINE_URL",
] as const;

for (const key of requiredEnvVars) {
  if (!config[key]) {
    logger.error(`[server] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Prisma 7 adapter + client
// ---------------------------------------------------------------------------
const adapter = new PrismaPg({
  connectionString: config.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Fastify instance
// ---------------------------------------------------------------------------
const server = Fastify({
  logger: {
    level: config.LOG_LEVEL ?? "info",
    transport:
      config.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

// ---------------------------------------------------------------------------
// Decorations – must happen BEFORE any route/plugin that uses them
// ---------------------------------------------------------------------------
server.decorate("prisma", prisma);

// Global error handler – prevents raw Prisma errors from reaching the client
server.setErrorHandler((error, request, reply) => {
  server.log.error(error);

  // Type‑narrow: treat as a generic Error for common properties
  const err = error instanceof Error ? error : new Error(String(error));

  // Prisma known request errors
  if (err.name === "PrismaClientKnownRequestError") {
    return reply.status(400).send({
      success: false,
      error: "Invalid request. Check your input data.",
    });
  }

  // Fastify validation errors (they have a validation property)
  if ("validation" in err) {
    return reply.status(400).send({
      success: false,
      error: err.message,
    });
  }

  // Default internal error
  return reply.status(500).send({
    success: false,
    error: "Internal server error. Please try again later.",
  });
});

// ---------------------------------------------------------------------------
// Main startup wrapper (CommonJS safe – no top‑level await)
// ---------------------------------------------------------------------------
async function main() {
  // ---- Plugins ----
  await server.register(cors, {
    origin: config.CORS_ORIGIN?.split(",") ?? ["http://localhost:3000"],
    credentials: true,
  });

  await server.register(fastifyHelmet);

  // Swagger documentation – must be registered BEFORE routes
  await server.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Prime Tech Gallery – Main Core API",
        description:
          "Secure operational backend for inventory, POS, auth, reports, and more.",
        version: "1.0.0",
      },
      servers: [
        {
          url: "http://localhost:8080",
          description: "Local development server",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  });

  await server.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list", // collapse all endpoints by default
      deepLinking: true,
    },
  });

  // Rate limiting (global off, applied per‑route)
  await server.register(rateLimit, { global: false });

  // JWT authentication
  await server.register(fjwt, {
    secret: config.JWT_SECRET!,
    sign: { expiresIn: "7d" }, // extended for development
  });

  // Enable cookie parsing (for refresh tokens)
  await server.register(require("@fastify/cookie"));

  // Register auth routes
  await server.register(authRoutes);

  await server.register(catalogSyncRoutes);

  await server.register(inventoryRoutes);

  await server.register(posSalesRoutes);
  await server.register(posLookupRoutes);
  await server.register(posSearchInventoryRoutes);

  await server.register(reportRoutes);
  await server.register(salesListRoutes);

  await server.register(productManageRoutes);
  await server.register(supplierRoutes);
  await server.register(batchRoutes);
  await server.register(warrantyRoutes);
  await server.register(customerCartWishlistRoutes);
  await server.register(addressRoutes);
  await server.register(customerOrderRoutes);
  await server.register(webOrderRoutes);
  await server.register(customerAccountRoutes);

  await server.register(userManagementRoutes);

  // ---- Health check ----
  server.get("/health", async () => {
    // PostgreSQL
    const dbStatus = await prisma.$queryRaw`SELECT 1`
      .then(() => "connected")
      .catch(() => "disconnected");

    // Catalog Engine
    let catalogStatus = "unknown";
    try {
      const catalogUrl =
        process.env.CATALOG_ENGINE_URL || "http://localhost:4000";
      const res = await fetch(`${catalogUrl}/health`);
      const body = await res.json();
      catalogStatus = body.status === "ok" ? "healthy" : "unhealthy";
    } catch {
      catalogStatus = "unreachable";
    }

    return {
      status: dbStatus === "connected" ? "ok" : "degraded",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      db: dbStatus,
      catalog_engine: catalogStatus,
    };
  });
  // ---- TODO: Register route plugins here ----
  // await server.register(authRoutes, { prefix: "/v1/auth" });
  // await server.register(adminRoutes, { prefix: "/v1/admin" });
  // await server.register(posRoutes, { prefix: "/v1/pos" });

  // ---- Start listening ----
  const PORT = parseInt(process.env.PORT ?? "8080", 10);
  const HOST = config.HOST ?? "0.0.0.0";

  try {
    await server.listen({ port: PORT, host: HOST });
    server.log.info(`[main-core] Backend listening on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal: string) {
  server.log.info(`[server] Received ${signal}, shutting down...`);
  await server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Kick off
main();

// ---------------------------------------------------------------------------
// Type augmentation – make `server.prisma` available in all routes
// ---------------------------------------------------------------------------
declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export { server, prisma };
