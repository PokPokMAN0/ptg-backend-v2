// =============================================================================
// Prime Tech Gallery — encryption.service.ts
// Handles: AES-256-GCM encryption, HMAC-SHA256 hashing, Argon2 password hashing
// Node.js built-in `crypto` only (zero extra deps for crypto/hashing).
// Argon2 requires: npm install argon2
// =============================================================================

import crypto from "node:crypto";
import argon2 from "argon2";
import { logger } from "../lib/logger";
import { config } from "../config";

// =============================================================================
// ENVIRONMENT GUARD
// Fail loudly at startup — never silently use a weak or missing key.
// Set in .env: IMEI_ENCRYPTION_KEY=<64 hex chars = 32 bytes>
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// =============================================================================

const RAW_KEY = config.IMEI_ENCRYPTION_KEY;

if (!RAW_KEY || RAW_KEY.length !== 64) {
  logger.fatal(
    "[encryption.service] IMEI_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
      "Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
}

/** 32-byte Buffer derived from the hex env var. Used only inside this module. */
const ENCRYPTION_KEY: Buffer = Buffer.from(RAW_KEY!, "hex");

// AES-256-GCM constants
const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12; // 96-bit IV — recommended for GCM
const TAG_BYTES = 16; // 128-bit auth tag — GCM default

// SHA-256 HMAC secret for deterministic hashing
// Separate from the encryption key so rotating one doesn't break the other.
// Set in .env: HASH_SECRET=<any long random string>
const HASH_SECRET = config.HASH_SECRET;

if (!HASH_SECRET || HASH_SECRET.length < 32) {
  logger.fatal(
    "[encryption.service] HASH_SECRET must be at least 32 characters. " +
      "Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * The wire format stored in the DB for encrypted fields.
 * Stored as a single colon-delimited base64 string: `iv:tag:ciphertext`
 * This keeps the schema a plain String column with no structural coupling.
 */
type EncryptedPayload = string; // "base64iv:base64tag:base64ciphertext"

// =============================================================================
// SECTION 1 — AES-256-GCM ENCRYPTION / DECRYPTION
// Used for: InventoryUnit.imei_1, imei_2, serial_number
// =============================================================================

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * A fresh random 12-byte IV is generated per call, making every ciphertext
 * unique even for identical inputs. The GCM auth tag prevents silent tampering.
 *
 * @param plaintext - The raw IMEI or serial number string.
 * @returns         - A base64-encoded string in the format `iv:tag:ciphertext`.
 *                   Store this directly in the DB column.
 */
export function encryptField(plaintext: string): EncryptedPayload {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv, {
    authTagLength: TAG_BYTES,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  // Pack into a single storable string: iv:tag:ciphertext (all base64)
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a payload produced by `encryptField`.
 *
 * CALL THIS ONLY IN ADMIN-SCOPED SERVICE PATHS.
 * Never call from catalog, cart, or public routes.
 *
 * @param payload - The `iv:tag:ciphertext` string from the DB column.
 * @returns       - The original plaintext IMEI or serial number.
 * @throws        - If the payload is malformed or the auth tag fails (tampering detected).
 */
export function decryptField(payload: EncryptedPayload): string {
  const parts = payload.split(":");

  if (parts.length !== 3) {
    logger.fatal(
      "[encryption.service] decryptField: malformed payload — expected iv:tag:ciphertext",
    );
    throw new Error("Decrypt failed: malformed payload");
  }

  const [ivB64, tagB64, ciphertextB64] = parts;

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv, {
    authTagLength: TAG_BYTES,
  });

  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    logger.fatal(
      "[encryption.service] decryptField: authentication failed — data may be tampered",
    );
    throw new Error("Decrypt failed: authentication error");
  }
}

// =============================================================================
// SECTION 2 — SHA-256 DETERMINISTIC HASHING
// Used for: InventoryUnit.imei_1_hash, imei_2_hash, serial_hash
//
// WHY: The encrypted ciphertext is non-deterministic (random IV per call),
// so you cannot do a DB lookup by IMEI barcode scan. Instead, store a keyed
// HMAC-SHA256 hash of the plaintext. The hash is always the same for the same
// input, so it is indexable and searchable.
//
// WHY HMAC instead of plain SHA-256:
// Plain SHA-256 is vulnerable to rainbow table attacks on the small IMEI space
// (15 digits). HMAC-SHA256 with a secret key makes precomputation infeasible.
// =============================================================================

/**
 * Produces a keyed HMAC-SHA256 hash of the plaintext value.
 * The output is a 64-character lowercase hex string.
 *
 * Store the result in `imei_1_hash`, `imei_2_hash`, or `serial_hash`.
 * Use `findInventoryByImei` below to look up by barcode.
 *
 * @param plaintext - Raw IMEI or serial number.
 * @returns         - 64-char hex HMAC-SHA256 digest.
 */
export function hashField(plaintext: string): string {
  return crypto
    .createHmac("sha256", HASH_SECRET!)
    .update(plaintext, "utf8")
    .digest("hex");
}

/**
 * Convenience: prepares all encrypted + hash fields for one InventoryUnit
 * from raw plaintext inputs. Call this before a Prisma `create` or `update`.
 *
 * @example
 * const fields = prepareInventoryFields({ imei1: "354551234567890", serial: "SN123" });
 * await prisma.inventoryUnit.create({ data: { ...fields, product_id, dealer_cost, retail_mrp } });
 */
// ---------------------------------------------------------------------------
// Explicit return type interface (avoids recursive ReturnType)
// ---------------------------------------------------------------------------
interface PreparedInventoryFields {
  imei_1?: string;
  imei_1_hash?: string;
  imei_2?: string;
  imei_2_hash?: string;
  serial_number?: string;
  serial_hash?: string;
}

export function prepareInventoryFields(input: {
  imei1?: string;
  imei2?: string;
  serial?: string;
}): PreparedInventoryFields {
  const result: PreparedInventoryFields = {};

  if (input.imei1) {
    result.imei_1 = encryptField(input.imei1);
    result.imei_1_hash = hashField(input.imei1);
  }
  if (input.imei2) {
    result.imei_2 = encryptField(input.imei2);
    result.imei_2_hash = hashField(input.imei2);
  }
  if (input.serial) {
    result.serial_number = encryptField(input.serial);
    result.serial_hash = hashField(input.serial);
  }

  return result;
}
// =============================================================================
// SECTION 3 — PASSWORD HASHING (Argon2id)
// Used for: User.password_hash
//
// Argon2id is the winner of the Password Hashing Competition and the
// current OWASP recommendation. It is resistant to both GPU brute-force
// (Argon2d strength) and side-channel attacks (Argon2i strength).
//
// Install: npm install argon2
// =============================================================================

/** Argon2id parameters — tuned for a production server (adjust to your hardware). */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3, // 3 iterations
  parallelism: 4, // 4 threads
};

/**
 * Hashes a plaintext password using Argon2id.
 * The salt is generated internally by the argon2 library and embedded in the output string.
 *
 * @param password - The user's plaintext password.
 * @returns        - An Argon2id hash string. Store in `User.password_hash`.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a plaintext password against a stored Argon2id hash.
 * Returns `true` on match, `false` on mismatch.
 * Never throws on a wrong password — only on a corrupted hash string.
 *
 * @param hash     - The value from `User.password_hash`.
 * @param password - The plaintext password submitted at login.
 */
export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Hash string is malformed — log and treat as failure, never crash the auth route
    logger.warn(
      "[encryption.service] verifyPassword: failed to parse hash — possible DB corruption",
    );
    return false;
  }
}

// =============================================================================
// SECTION 4 — REFRESH TOKEN HASHING
// Used for: RefreshToken.token_hash
//
// Refresh tokens are long random strings (not passwords), so plain SHA-256
// (no salt needed) is appropriate — they already have enough entropy.
// =============================================================================

/**
 * Hashes a raw refresh token with SHA-256.
 * Store the result in `RefreshToken.token_hash`. Never store the raw token.
 *
 * @param rawToken - The raw refresh token string issued to the client.
 * @returns        - 64-char hex SHA-256 digest.
 */
export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/**
 * Generates a cryptographically secure random refresh token.
 * Issue this to the client in an HttpOnly cookie.
 *
 * @returns - A 64-byte (512-bit) hex string refresh token.
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString("hex");
}

// =============================================================================
// USAGE REFERENCE
// =============================================================================
//
// ── STORING a new InventoryUnit ─────────────────────────────────────────────
//
//   import { prepareInventoryFields } from "./encryption.service";
//
//   const fields = prepareInventoryFields({ imei1: "354551234567890", serial: "SN9988" });
//   await prisma.inventoryUnit.create({ data: { product_id, dealer_cost, retail_mrp, ...fields } });
//
// ── SEARCHING by barcode scan (POS / Admin) ──────────────────────────────────
//
//   import { hashField } from "./encryption.service";
//
//   const hash = hashField(scannedImei);
//   const unit = await prisma.inventoryUnit.findUnique({ where: { imei_1_hash: hash } });
//
// ── DECRYPTING for ADMIN view ─────────────────────────────────────────────────
//
//   import { decryptField } from "./encryption.service";
//
//   // Only inside an ADMIN-role-guarded service path:
//   const plainImei = decryptField(unit.imei_1!);
//
// ── REGISTERING a user ────────────────────────────────────────────────────────
//
//   import { hashPassword } from "./encryption.service";
//
//   const password_hash = await hashPassword(req.body.password);
//   await prisma.user.create({ data: { email, name, password_hash, role: "CUSTOMER" } });
//
// ── LOGGING IN a user ─────────────────────────────────────────────────────────
//
//   import { verifyPassword } from "./encryption.service";
//
//   const user = await prisma.user.findUnique({ where: { email } });
//   const ok   = user ? await verifyPassword(user.password_hash, req.body.password) : false;
//   if (!ok) throw new UnauthorizedError("Invalid credentials");
//
// ── ISSUING a refresh token ────────────────────────────────────────────────────
//
//   import { generateRefreshToken, hashRefreshToken } from "./encryption.service";
//
//   const rawToken  = generateRefreshToken();
//   const tokenHash = hashRefreshToken(rawToken);
//   await prisma.refreshToken.create({ data: { user_id, token_hash: tokenHash, expires_at } });
//   reply.setCookie("refresh_token", rawToken, { httpOnly: true, secure: true, sameSite: "strict" });
//
// =============================================================================
