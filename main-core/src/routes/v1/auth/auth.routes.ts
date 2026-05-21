// =============================================================================
// Prime Tech Gallery – Authentication Routes (service‑extracted, cleaned)
// =============================================================================

import "@fastify/cookie";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  login,
  register,
  refreshAccessToken,
  logout,
} from "../../../services/auth.service";
import { schema } from "../../../lib/schema";
import { z } from "zod";
import { validate } from "../../../middleware/validate";
import { authenticate } from "../../../middleware/auth.middleware";
import { logAudit } from "../../../services/audit.service";
import {
  verifyOTP,
  createOTP,
  sendVerificationEmail,
  sendPasswordResetEmail,
} from "../../../services/otp.service";
import {
  hashPassword,
  verifyPassword,
} from "../../../services/encryption.service";

// ---------------------------------------------------------------------------
// Request body types
// ---------------------------------------------------------------------------
interface LoginBody {
  email: string;
  password: string;
}

interface RegisterBody {
  email: string;
  password: string;
  name: string;
  phone?: string;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8)
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[0-9]/, "Must contain a digit"),
  name: z.string().min(1),
  phone: z.string().optional(),
});

const VerifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

const ResetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  new_password: z
    .string()
    .min(8)
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[0-9]/, "Must contain a digit"),
});

const ResendVerificationSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function loginHandler(
  request: FastifyRequest<{ Body: LoginBody }>,
  reply: FastifyReply,
) {
  try {
    const { email, password } = request.body;
    const { loginResult, rawRefreshToken } = await login(
      request.server.prisma,
      email,
      password,
      request.ip,
      request.headers["user-agent"] || "",
      (payload: object) => reply.jwtSign(payload),
      {
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/v1/auth",
        maxAge: 7 * 24 * 60 * 60,
      },
    );

    reply.setCookie("refresh_token", rawRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/v1/auth",
      maxAge: 7 * 24 * 60 * 60,
    });

    await logAudit(
      loginResult.user.id,
      "USER_LOGIN",
      "users",
      loginResult.user.id,
      { email },
      request.ip,
    );

    return reply.send({ success: true, data: loginResult });
  } catch (err: any) {
    if (err.statusCode) {
      return reply
        .status(err.statusCode)
        .send({ success: false, error: err.message });
    }
    throw err;
  }
}

async function registerHandler(
  request: FastifyRequest<{ Body: RegisterBody }>,
  reply: FastifyReply,
) {
  try {
    const { email, password, name, phone } = request.body;
    const result = await register(
      request.server.prisma,
      email,
      password,
      name,
      phone,
      request.ip,
    );

    await logAudit(
      result.user.id,
      "USER_REGISTERED",
      "users",
      result.user.id,
      { email, name },
      request.ip,
    );

    return reply.status(201).send({ success: true, data: result });
  } catch (err: any) {
    if (err.statusCode) {
      return reply
        .status(err.statusCode)
        .send({ success: false, error: err.message });
    }
    throw err;
  }
}

async function refreshHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const rawRefreshToken = request.cookies?.refresh_token;
    const { newAccessToken, newRawRefreshToken } = await refreshAccessToken(
      request.server.prisma,
      rawRefreshToken,
      request.ip,
      request.headers["user-agent"] || "",
      (payload: object) => reply.jwtSign(payload),
    );

    reply.setCookie("refresh_token", newRawRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/v1/auth",
      maxAge: 7 * 24 * 60 * 60,
    });

    return reply.send({
      success: true,
      data: { access_token: newAccessToken },
    });
  } catch (err: any) {
    reply.clearCookie("refresh_token", { path: "/v1/auth" });
    if (err.statusCode) {
      return reply
        .status(err.statusCode)
        .send({ success: false, error: err.message });
    }
    throw err;
  }
}

async function logoutHandler(request: FastifyRequest, reply: FastifyReply) {
  await logout(request.server.prisma, request.cookies?.refresh_token);
  reply.clearCookie("refresh_token", { path: "/v1/auth" });
  return reply.send({
    success: true,
    data: { message: "Logged out successfully." },
  });
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------
export async function authRoutes(fastify: FastifyInstance) {
  // Login
  fastify.post<{ Body: LoginBody }>(
    "/v1/auth/login",
    {
      ...schema(LoginSchema),
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      preHandler: [validate(LoginSchema)],
    },
    loginHandler,
  );

  // Register
  fastify.post<{ Body: RegisterBody }>(
    "/v1/auth/register",
    {
      ...schema(RegisterSchema),
      config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
      preHandler: [validate(RegisterSchema)],
    },
    registerHandler,
  );

  // Refresh
  fastify.post("/v1/auth/refresh", refreshHandler);

  // Logout
  fastify.post("/v1/auth/logout", logoutHandler);

  // Verify Email (public)
  fastify.post(
    "/v1/auth/verify-email",
    {
      ...schema(VerifyEmailSchema),
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      preHandler: [validate(VerifyEmailSchema)],
    },
    async (request, reply) => {
      const { email, code } = request.body as z.infer<typeof VerifyEmailSchema>;
      const user = await request.server.prisma.user.findUnique({
        where: { email },
      });
      if (!user || user.is_verified) {
        return reply
          .status(400)
          .send({ success: false, error: "Invalid request." });
      }
      const valid = await verifyOTP(user.id, code, "EMAIL_VERIFICATION");
      if (!valid) {
        return reply
          .status(400)
          .send({ success: false, error: "Invalid or expired code." });
      }
      await request.server.prisma.user.update({
        where: { id: user.id },
        data: { is_verified: true, verification_expires_at: null },
      });
      await logAudit(
        user.id,
        "EMAIL_VERIFIED",
        "users",
        user.id,
        null,
        request.ip,
      );
      return reply.send({
        success: true,
        data: { message: "Email verified. You can now log in." },
      });
    },
  );

  // Forgot Password
  fastify.post(
    "/v1/auth/forgot-password",
    {
      ...schema(ForgotPasswordSchema),
      config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
      preHandler: [validate(ForgotPasswordSchema)],
    },
    async (request, reply) => {
      const { email } = request.body as z.infer<typeof ForgotPasswordSchema>;
      const user = await request.server.prisma.user.findUnique({
        where: { email },
      });
      if (user) {
        const code = await createOTP(user.id, "PASSWORD_RESET", 10);
        if (code) await sendPasswordResetEmail(user.email, code);
      }
      return reply.send({
        success: true,
        data: {
          message:
            "If an account with that email exists, a reset code has been sent.",
        },
      });
    },
  );

  // Reset Password
  fastify.post(
    "/v1/auth/reset-password",
    {
      ...schema(ResetPasswordSchema),
      preHandler: [validate(ResetPasswordSchema)],
    },
    async (request, reply) => {
      const { email, code, new_password } = request.body as z.infer<
        typeof ResetPasswordSchema
      >;
      const user = await request.server.prisma.user.findUnique({
        where: { email },
      });
      if (!user) {
        return reply
          .status(400)
          .send({ success: false, error: "Invalid request." });
      }
      const valid = await verifyOTP(user.id, code, "PASSWORD_RESET");
      if (!valid) {
        return reply
          .status(400)
          .send({ success: false, error: "Invalid or expired code." });
      }
      const password_hash = await hashPassword(new_password);
      await request.server.prisma.user.update({
        where: { id: user.id },
        data: { password_hash },
      });
      return reply.send({
        success: true,
        data: { message: "Password has been reset." },
      });
    },
  );

  // Get My Profile
  fastify.get(
    "/v1/auth/me",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { sub } = request.user as { sub: string };
      const user = await request.server.prisma.user.findUnique({
        where: { id: sub },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          image_url: true,
          is_active: true,
          is_verified: true,
          last_login_at: true,
          created_at: true,
          updated_at: true,
        },
      });
      if (!user) {
        return reply
          .status(404)
          .send({ success: false, error: "User not found." });
      }
      return reply.send({ success: true, data: user });
    },
  );

  // Resend Verification OTP
  fastify.post(
    "/v1/auth/resend-verification-otp",
    {
      ...schema(ResendVerificationSchema),
      config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
      preHandler: [validate(ResendVerificationSchema)],
    },
    async (request, reply) => {
      const { email, password } = request.body as z.infer<
        typeof ResendVerificationSchema
      >;
      const user = await request.server.prisma.user.findUnique({
        where: { email },
      });
      if (!user || user.is_verified) {
        return reply.send({
          success: true,
          data: {
            message:
              "If the account exists and is unverified, a new code has been sent.",
          },
        });
      }
      const valid = await verifyPassword(user.password_hash, password);
      if (!valid) {
        return reply
          .status(401)
          .send({ success: false, error: "Invalid credentials." });
      }
      if (
        user.verification_expires_at &&
        user.verification_expires_at < new Date()
      ) {
        await request.server.prisma.user.delete({ where: { id: user.id } });
        return reply
          .status(410)
          .send({
            success: false,
            error: "Registration expired. Please sign up again.",
          });
      }
      // cooldown
      const recentOTP = await request.server.prisma.otpCode.findFirst({
        where: {
          user_id: user.id,
          type: "EMAIL_VERIFICATION",
          created_at: { gte: new Date(Date.now() - 60 * 1000) },
        },
        orderBy: { created_at: "desc" },
      });
      if (recentOTP) {
        const retryAfter = Math.ceil(
          (recentOTP.created_at.getTime() + 60000 - Date.now()) / 1000,
        );
        return reply.status(429).send({
          success: false,
          error: `Please wait ${retryAfter} seconds before requesting a new code.`,
        });
      }
      const newExpiry = new Date(Date.now() + 60 * 60 * 1000);
      await request.server.prisma.user.update({
        where: { id: user.id },
        data: { verification_expires_at: newExpiry },
      });
      const code = await createOTP(user.id, "EMAIL_VERIFICATION", 60);
      if (code) {
        await sendVerificationEmail(user.email, code);
      }
      return reply.send({
        success: true,
        data: {
          message: "A new verification code has been sent to your email.",
        },
      });
    },
  );
}
