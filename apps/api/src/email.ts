import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "./env.js";

let cachedTransporter: Transporter | null = null;
let lastUser: string | undefined = undefined;
let lastPass: string | undefined = undefined;

function getTransporter(env: Env): Transporter | null {
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    return null;
  }

  if (cachedTransporter && lastUser === env.SMTP_USER && lastPass === env.SMTP_PASS) {
    return cachedTransporter;
  }

  lastUser = env.SMTP_USER;
  lastPass = env.SMTP_PASS;

  cachedTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  return cachedTransporter;
}

export interface SendVerificationResult {
  sent: boolean;
  verificationUrl: string;
  reason?: string;
}

/**
 * Send an email verification link to the given recipient.
 * If SMTP credentials are not configured, logs the verification URL to console
 * so development can proceed seamlessly without an external email provider.
 */
export async function sendVerificationEmail(params: {
  to: string;
  token: string;
  webOrigin: string;
  env: Env;
}): Promise<SendVerificationResult> {
  const { to, token, webOrigin, env } = params;
  const baseUrl = webOrigin.replace(/\/+$/, "");
  const verificationUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;

  const transporter = getTransporter(env);
  if (!transporter) {
    console.info(
      `[MeanTime Mailer] SMTP credentials not set (SMTP_USER/SMTP_PASS empty). Verification URL for ${to}:\n  -> ${verificationUrl}`,
    );
    return { sent: false, verificationUrl, reason: "smtp_unconfigured" };
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #fafafa; margin: 0; padding: 40px 20px; color: #171717; }
    .container { max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
    .logo { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 16px; margin-bottom: 24px; color: #171717; text-decoration: none; }
    .badge { display: inline-block; width: 24px; height: 24px; line-height: 24px; text-align: center; background: #171717; color: #ffffff; border-radius: 6px; font-size: 13px; font-weight: bold; }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 12px; color: #171717; }
    p { font-size: 14px; line-height: 1.6; color: #525252; margin: 0 0 20px; }
    .btn { display: inline-block; background-color: #171717; color: #ffffff !important; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 500; text-decoration: none; margin: 8px 0 24px; }
    .link-fallback { font-size: 12px; color: #737373; word-break: break-all; margin-top: 16px; }
    .footer { font-size: 12px; color: #a3a3a3; margin-top: 24px; border-top: 1px solid #f5f5f5; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <span class="badge">m</span>
      <span>MeanTime</span>
    </div>
    <h1>Verify your email address</h1>
    <p>Thanks for creating an account with MeanTime. Please verify your email address to confirm your registration and unlock full account features.</p>
    <a href="${verificationUrl}" class="btn" target="_blank" rel="noopener">Verify Email Address</a>
    <p class="link-fallback">If the button doesn't work, copy and paste this link into your browser:<br><a href="${verificationUrl}">${verificationUrl}</a></p>
    <div class="footer">
      This link will expire in 24 hours. If you did not create a MeanTime account, you can safely ignore this email.
    </div>
  </div>
</body>
</html>
  `;

  const text = `Verify your email address for MeanTime\n\nThanks for creating an account with MeanTime. Please click the link below to verify your email address:\n\n${verificationUrl}\n\nThis link will expire in 24 hours. If you did not create a MeanTime account, you can safely ignore this email.`;

  try {
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: "Verify your email address — MeanTime",
      text,
      html,
    });
    return { sent: true, verificationUrl };
  } catch (error) {
    console.error(`[MeanTime Mailer] Failed to send verification email to ${to}:`, error);
    return {
      sent: false,
      verificationUrl,
      reason: error instanceof Error ? error.message : "send_failed",
    };
  }
}
