// =============================================================================
// Prime Tech Gallery — Main Core Server (Fastify + Prisma 7 + JWT)
// =============================================================================

// 1. Load environment variables BEFORE any other module touches process.env
import dotenv from "dotenv";
dotenv.config();

import Fastify from "fastify";
import cors from "@fastify/cors";
import fjwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { PrismaClient } from "./lib/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import fastifyHelmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import fastifyCookie from "@fastify/cookie";
import fastifyCompress from "@fastify/compress";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { join } from "node:path";

import { authRoutes } from "./routes/v1/auth/auth.routes";
import { catalogSyncRoutes } from "./routes/v1/admin/catalog-sync.routes";
import { inventoryRoutes } from "./routes/v1/admin/inventory.routes";
import { posSalesRoutes } from "./routes/v1/pos/sales.routes";
import { posLookupRoutes } from "./routes/v1/pos/lookup.routes";
import { posSearchInventoryRoutes } from "./routes/v1/pos/search-inventory.routes";
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
import { customerPhotoRoutes } from "./routes/v1/customer/photo.routes";

// ---------------------------------------------------------------------------
// Environment guard
// ---------------------------------------------------------------------------
const requiredEnvVars = [
  "DATABASE_URL",
  "JWT_SECRET",
  "IMEI_ENCRYPTION_KEY",
  "HASH_SECRET",
  "CATALOG_ENGINE_URL",
] as const;

for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`[server] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Prisma 7 adapter + client
// ---------------------------------------------------------------------------
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Fastify instance
// ---------------------------------------------------------------------------
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
  bodyLimit: 10 * 1024 * 1024,
});

// Increase default body limit (before multipart can handle it)
server.addHook("onRoute", (routeOptions) => {
  if (routeOptions.url === "/v1/customer/account/photo") {
    (routeOptions as any).config = {
      ...((routeOptions as any).config || {}),
      bodyLimit: 10 * 1024 * 1024, // 10 MB
    };
  }
});

// ---------------------------------------------------------------------------
// Decorations – must happen BEFORE any route/plugin that uses them
// ---------------------------------------------------------------------------
server.decorate("prisma", prisma);

// Global error handler
server.setErrorHandler((error, request, reply) => {
  server.log.error(error);
  const err = error instanceof Error ? error : new Error(String(error));

  if (err.name === "PrismaClientKnownRequestError") {
    return reply.status(400).send({
      success: false,
      error: "Invalid request. Check your input data.",
    });
  }
  if (err.message === "Request body is too large") {
    return reply.status(413).send({
      success: false,
      error: "File is too large. Maximum size is 10 MB.",
    });
  }
  if ("validation" in err) {
    return reply.status(400).send({
      success: false,
      error: err.message,
    });
  }

  return reply.status(500).send({
    success: false,
    error: "Internal server error. Please try again later.",
  });
});

// ---------------------------------------------------------------------------
// Main startup
// ---------------------------------------------------------------------------
async function main() {
  // ---- Compression ----
  await server.register(fastifyCompress, {
    encodings: ["br", "gzip"],
  });

  // ---- CORS ----
  await server.register(cors, {
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    preflightContinue: false,
  });

  // ---- Security headers ----
  await server.register(fastifyHelmet);

  // ---- Swagger ----
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
      docExpansion: "list",
      deepLinking: true,
    },
  });

  // ---- Rate limiting ----
  await server.register(rateLimit, { global: false });

  // ---- JWT ----
  await server.register(fjwt, {
    secret: process.env.JWT_SECRET!,
    sign: { expiresIn: "7d" },
  });

  // ---- Cookies ----
  await server.register(fastifyCookie);

  // ---- Multipart (before routes that need it) ----
  await server.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  });

  // ---- Static serving for profile pics ----
  await server.register(fastifyStatic, {
    root: join(__dirname, "..", "public", "profile-pics"),
    prefix: "/profile-pics/",
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  });

  // ---- All routes ----
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
  await server.register(customerPhotoRoutes);
  await server.register(userManagementRoutes);

  // ---- Enhanced Health Check ----
  server.get("/health", async () => {
    const checks: {
      service: string;
      status: "OK" | "Minor Error" | "Critical Error";
      detail: string;
    }[] = [];

    // PostgreSQL
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const ms = Date.now() - start;
      checks.push({ service: "PostgreSQL", status: "OK", detail: `${ms}ms` });
    } catch (err: any) {
      checks.push({
        service: "PostgreSQL",
        status: "Critical Error",
        detail: err.message || "Disconnected",
      });
    }

    // Catalog Engine
    try {
      const catalogUrl =
        process.env.CATALOG_ENGINE_URL || "http://localhost:4000";
      const res = await fetch(`${catalogUrl}/health`);
      if (res.ok) {
        const body = await res.json();
        checks.push({
          service: "Catalog Engine",
          status: body.status === "ok" ? "OK" : "Minor Error",
          detail: body.status || "Unknown",
        });
      } else {
        checks.push({
          service: "Catalog Engine",
          status: "Minor Error",
          detail: `HTTP ${res.status}`,
        });
      }
    } catch (err: any) {
      checks.push({
        service: "Catalog Engine",
        status: "Critical Error",
        detail: err.message || "Unreachable",
      });
    }

    // Overall status
    const hasCritical = checks.some((c) => c.status === "Critical Error");
    const hasMinor = checks.some((c) => c.status === "Minor Error");
    const overall = hasCritical
      ? "Critical Error"
      : hasMinor
        ? "Minor Error"
        : "OK";

    return {
      status: overall,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    };
  });

  // ---- Start ----
  const PORT = parseInt(process.env.PORT ?? "8080", 10);
  const HOST = process.env.HOST ?? "0.0.0.0";

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

main();

// ---------------------------------------------------------------------------
// Type augmentation
// ---------------------------------------------------------------------------
declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export { server, prisma };
