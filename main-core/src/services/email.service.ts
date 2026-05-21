// =============================================================================
// Prime Tech Gallery – Email Service (Resend)
// =============================================================================

import { Resend } from "resend";
import { logger } from "../lib/logger";
import { config } from "../config";

const resend = new Resend(config.RESEND_API_KEY);

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
  data?: any;
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
}: SendEmailOptions): Promise<SendEmailResult> {
  try {
    const { data, error } = await resend.emails.send({
      from: config.EMAIL_FROM!,
      to,
      subject,
      text,
      html,
    });

    if (data) {
      logger.info(
        { event: "email_sent", id: data.id },
        "Email sent successfully",
      );
      return { success: true, data };
    }

    console.error("[email.service] Resend error:", JSON.stringify(error));
    return { success: false, error: error?.message || "Unknown Resend error" };
  } catch (err: any) {
    console.error("[email.service] Exception:", err);
    return { success: false, error: err.message || "Email sending failed" };
  }
}
