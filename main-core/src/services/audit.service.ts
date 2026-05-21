// =============================================================================
// Prime Tech Gallery — Audit Logging Service
// =============================================================================

import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { logger } from "../lib/logger";
import { config } from "../config";

// Create a dedicated Prisma instance for audit logging (same adapter pattern as server.ts)
const adapter = new PrismaPg({
  connectionString: config.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

export async function logAudit(
  actorId: string,
  action: string,
  targetTable: string,
  targetId: string,
  metadata?: any,
  ip?: string,
) {
  try {
    await prisma.auditLog.create({
      data: {
        actor_id: actorId,
        action,
        target_table: targetTable,
        target_id: targetId,
        metadata: metadata || undefined,
        ip_address: ip,
      },
    });
  } catch (err) {
    logger.error(err, "[audit.service] Failed to log:");
  }
}
