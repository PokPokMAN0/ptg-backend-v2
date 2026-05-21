// =============================================================================
// Prime Tech Gallery – Centralized Configuration
// Loads all env vars, validates with Zod, exports a frozen config object.
// =============================================================================

import dotenv from "dotenv";
dotenv.config(); // load .env once, here only

import { z } from "zod";

const envSchema = z.object({
  // ── Server ──────────────────────────────────────────────────────────
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // ── Database ────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url(),

  // ── Authentication ──────────────────────────────────────────────────
  JWT_SECRET: z.string().min(32),
  HASH_SECRET: z.string().min(32),
  IMEI_ENCRYPTION_KEY: z.string().length(64),

  // ── Catalog Engine connection ───────────────────────────────────────
  CATALOG_ENGINE_URL: z.string().url().default("http://localhost:4000"),
  CATALOG_API_KEY: z.string().default("shared-secret-key-change-me"),

  // ── Email ───────────────────────────────────────────────────────────
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // ── CORS ────────────────────────────────────────────────────────────
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

export const config = Object.freeze(envSchema.parse(process.env));
