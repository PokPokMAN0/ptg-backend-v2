// =============================================================================
// Prime Tech Gallery – Auth Service
// Handles login, registration, token generation, refresh, and logout.
// =============================================================================

import { PrismaClient } from "../generated/prisma/client";
import {
  verifyPassword,
  hashPassword,
  generateRefreshToken,
  hashRefreshToken,
} from "./encryption.service";
import { createOTP, sendVerificationEmail } from "./otp.service";
import { config } from "../config"; // fallback – only for cookie options; if config module doesn't exist yet, you can inline them

interface LoginResult {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    phone: string | null;
    image_url: string | null;
  };
}

interface RegisterResult {
  message: string;
  user: { id: string; email: string; name: string };
}

// ---------------------------------------------------------------------------
// login – verifies credentials, enforces verification, issues tokens
// ---------------------------------------------------------------------------
export async function login(
  prisma: PrismaClient,
  email: string,
  password: string,
  ip: string | null,
  userAgent: string | null,
  jwtSign: (payload: object) => Promise<string>,
  cookieOptions: {
    secure: boolean;
    sameSite: "strict";
    path: string;
    maxAge: number;
  },
): Promise<{ loginResult: LoginResult; rawRefreshToken: string }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.is_active) {
    throw new UnauthorizedError("Invalid email or password.");
  }

  const passwordValid = await verifyPassword(user.password_hash, password);
  if (!passwordValid) {
    throw new UnauthorizedError("Invalid email or password.");
  }

  if (!user.is_verified) {
    if (
      user.verification_expires_at &&
      user.verification_expires_at < new Date()
    ) {
      await prisma.user.delete({ where: { id: user.id } });
      throw new GoneError("Registration expired. Please sign up again.");
    }
    throw new ForbiddenError(
      "Please verify your email before logging in. Check your inbox or resend the verification code.",
    );
  }

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { last_login_at: new Date() },
  });

  // Access token
  const accessToken = await jwtSign({
    sub: user.id,
    role: user.role,
    email: user.email,
  });

  // Refresh token
  const rawRefreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(rawRefreshToken);
  await prisma.refreshToken.create({
    data: {
      user_id: user.id,
      token_hash: refreshTokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ip_address: ip,
      user_agent: userAgent || "",
    },
  });

  const loginResult: LoginResult = {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone,
      image_url: user.image_url,
    },
  };

  return { loginResult, rawRefreshToken };
}

// ---------------------------------------------------------------------------
// register – creates an unverified user and sends verification OTP
// ---------------------------------------------------------------------------
export async function register(
  prisma: PrismaClient,
  email: string,
  password: string,
  name: string,
  phone: string | undefined,
  ip: string | null,
): Promise<RegisterResult> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ConflictError("A user with this email already exists.");
  }

  const password_hash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      password_hash,
      name,
      phone,
      role: "CUSTOMER",
      is_verified: false,
      verification_expires_at: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const code = await createOTP(user.id, "EMAIL_VERIFICATION", 60);
  if (code) {
    await sendVerificationEmail(email, code);
  }

  // Audit log is handled by the route (since we need request.ip)
  return {
    message: "Account created. Please verify your email within 60 minutes.",
    user: { id: user.id, email: user.email, name: user.name },
  };
}

// ---------------------------------------------------------------------------
// refreshAccessToken – rotates refresh token and returns new access token
// ---------------------------------------------------------------------------
export async function refreshAccessToken(
  prisma: PrismaClient,
  rawRefreshToken: string | undefined,
  ip: string | null,
  userAgent: string | null,
  jwtSign: (payload: object) => Promise<string>,
): Promise<{ newAccessToken: string; newRawRefreshToken: string }> {
  if (!rawRefreshToken) {
    throw new UnauthorizedError("No refresh token provided.");
  }

  const tokenHash = hashRefreshToken(rawRefreshToken);
  const storedToken = await prisma.refreshToken.findFirst({
    where: {
      token_hash: tokenHash,
      revoked: false,
      expires_at: { gte: new Date() },
    },
    include: {
      user: { select: { id: true, role: true, email: true, is_active: true } },
    },
  });

  if (!storedToken || !storedToken.user.is_active) {
    throw new UnauthorizedError("Invalid or expired refresh token.");
  }

  // Revoke old token
  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { revoked: true },
  });

  // Issue new tokens
  const newAccessToken = await jwtSign({
    sub: storedToken.user.id,
    role: storedToken.user.role,
    email: storedToken.user.email,
  });

  const newRawRefreshToken = generateRefreshToken();
  const newRefreshTokenHash = hashRefreshToken(newRawRefreshToken);
  await prisma.refreshToken.create({
    data: {
      user_id: storedToken.user.id,
      token_hash: newRefreshTokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ip_address: ip,
      user_agent: userAgent || "",
    },
  });

  return { newAccessToken, newRawRefreshToken };
}

// ---------------------------------------------------------------------------
// logout – revokes refresh token and returns a clear‑cookie response
// ---------------------------------------------------------------------------
export async function logout(
  prisma: PrismaClient,
  rawRefreshToken: string | undefined,
): Promise<void> {
  if (rawRefreshToken) {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    await prisma.refreshToken.updateMany({
      where: { token_hash: tokenHash, revoked: false },
      data: { revoked: true },
    });
  }
}

// ---------------------------------------------------------------------------
// Small error classes for service-level clarity
// ---------------------------------------------------------------------------
export class UnauthorizedError extends Error {
  statusCode = 401;
  constructor(msg: string) {
    super(msg);
    this.name = "UnauthorizedError";
  }
}
export class ConflictError extends Error {
  statusCode = 409;
  constructor(msg: string) {
    super(msg);
    this.name = "ConflictError";
  }
}
export class ForbiddenError extends Error {
  statusCode = 403;
  constructor(msg: string) {
    super(msg);
    this.name = "ForbiddenError";
  }
}
export class GoneError extends Error {
  statusCode = 410;
  constructor(msg: string) {
    super(msg);
    this.name = "GoneError";
  }
}
