// =============================================================================
// Prime Tech Gallery – OTP Service (styled emails)
// =============================================================================

import crypto from "node:crypto";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { sendEmail } from "./email.service";
import { logger } from "../lib/logger";
import { config } from "../config";

const adapter = new PrismaPg({ connectionString: config.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashOTP(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

export async function createOTP(
  userId: string,
  type: "EMAIL_VERIFICATION" | "PASSWORD_RESET",
  expiryMinutes: number = 10,
): Promise<string | null> {
  const rawCode = generateOTP();
  const hashed = hashOTP(rawCode);

  logger.debug(`[DEV] OTP for user ${userId}: ${rawCode}`);

  try {
    await prisma.otpCode.create({
      data: {
        user_id: userId,
        code_hash: hashed,
        type,
        expires_at: new Date(Date.now() + expiryMinutes * 60 * 1000),
      },
    });
    return rawCode;
  } catch (err) {
    logger.error(err, "[otp.service] Failed to create OTP:");
    return null;
  }
}

export async function verifyOTP(
  userId: string,
  rawCode: string,
  type: "EMAIL_VERIFICATION" | "PASSWORD_RESET",
): Promise<boolean> {
  const hashed = hashOTP(rawCode);
  const record = await prisma.otpCode.findFirst({
    where: {
      user_id: userId,
      code_hash: hashed,
      type,
      used: false,
      expires_at: { gte: new Date() },
    },
  });

  if (!record) return false;

  await prisma.otpCode.update({
    where: { id: record.id },
    data: { used: true },
  });
  return true;
}

export async function sendVerificationEmail(
  email: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  const text = `Your verification code is: ${code}. It expires in 10 minutes.`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap');
    @import url('https://fonts.googleapis.com/css2?family=Betania+Patmos&display=swap');
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f2f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f2f6fa;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.05);overflow:hidden;">
          
          <!-- Header – Black background -->
          <tr>
            <td style="background-color:#000000;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;font-weight:700;">
  <span style="font-family:'Space Grotesk',sans-serif;color:#ffffff;font-size:28px;">Prime Tech</span>
  <span style="font-family:'Betania Patmos',cursive;color:#2165ed;font-size:32px;font-weight:700;">Gallery</span>
</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;font-size:18px;color:#1f2937;font-weight:600;">
                Verify your email address
              </p>
              <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#4b5563;">
                Please use the code below to verify your email and complete your registration on <strong>Prime Tech Gallery</strong>.
              </p>
              
              <!-- Code box -->
              <div style="background-color:#f2f6fa;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
                <span style="font-size:28px;letter-spacing:4px;font-family:'Courier New',monospace;font-weight:700;color:#111827;">
                  ${code}
                </span>
              </div>
              
              <p style="margin:0 0 8px;font-size:12px;color:#9ca3af;">
                This code expires in <strong>10 minutes</strong>.<br>
                If you did not create an account, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f2f6fa;padding:24px 40px;text-align:center;font-size:11px;color:#9ca3af;">
              &copy; 2026 Prime Tech Gallery. All rights reserved.<br>
              Dhaka, Bangladesh
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return sendEmail({
    to: email,
    subject: "Verify your email – Prime Tech Gallery",
    text,
    html,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  const text = `Your password reset code is: ${code}. It expires in 10 minutes.`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap');
    @import url('https://fonts.googleapis.com/css2?family=Betania+Patmos&display=swap');
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f2f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f2f6fa;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.05);overflow:hidden;">
          
          <!-- Header – Black background -->
          <tr>
            <td style="background-color:#000000;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;font-weight:700;">
  <span style="font-family:'Space Grotesk',sans-serif;color:#ffffff;font-size:28px;">Prime Tech</span>
  <span style="font-family:'Betania Patmos',cursive;color:#2165ed;font-size:32px;font-weight:700;">Gallery</span>
</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;font-size:18px;color:#1f2937;font-weight:600;">
                Verify your email address
              </p>
              <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#4b5563;">
                Please use the code below to verify your email and complete your registration on <strong>Prime Tech Gallery</strong>.
              </p>
              
              <!-- Code box -->
              <div style="background-color:#f2f6fa;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
                <span style="font-size:28px;letter-spacing:4px;font-family:'Courier New',monospace;font-weight:700;color:#111827;">
                  ${code}
                </span>
              </div>
              
              <p style="margin:0 0 8px;font-size:12px;color:#9ca3af;">
                This code expires in <strong>10 minutes</strong>.<br>
                If you did not create an account, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f2f6fa;padding:24px 40px;text-align:center;font-size:11px;color:#9ca3af;">
              &copy; 2026 Prime Tech Gallery. All rights reserved.<br>
              Dhaka, Bangladesh
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return sendEmail({
    to: email,
    subject: "Password reset – Prime Tech Gallery",
    text,
    html,
  });
}
