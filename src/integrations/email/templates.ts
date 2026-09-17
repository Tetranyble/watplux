import { siteConfig } from "@/lib/site-config";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character] ?? character,
  );
}

function emailShell(content: string): string {
  return `<!doctype html><html lang="en"><body style="margin:0;background:#faf9f5;color:#211f1a;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:40px 20px"><div style="margin-bottom:24px;font-size:22px;font-weight:700">${siteConfig.name}</div><div style="border:1px solid #ded8ca;border-radius:8px;background:#fff;padding:32px">${content}</div><p style="margin-top:20px;color:#746d60;font-size:12px;line-height:1.6">This is an automated transactional message from ${siteConfig.name}.</p></div></body></html>`;
}

function actionButton(label: string, url: string): string {
  const safeUrl = escapeHtml(url);
  return `<p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;border-radius:4px;background:#ffbe00;color:#211800;padding:13px 20px;text-decoration:none;font-weight:700">${escapeHtml(label)}</a></p><p style="color:#746d60;font-size:13px;line-height:1.6">If the button does not work, copy and paste this address into your browser:<br><a href="${safeUrl}" style="color:#5f4a00;word-break:break-all">${safeUrl}</a></p>`;
}

export function verificationEmail(name: string, url: string) {
  const greeting = name.trim() ? `Hi ${escapeHtml(name.trim())},` : "Hello,";
  return {
    subject: "Verify your Watplux email",
    text: `${greeting.replace(/<[^>]+>/g, "")}\n\nVerify your email address to finish setting up your Watplux account:\n${url}\n\nThis link expires in one hour. If you did not create this account, you can ignore this email.`,
    html: emailShell(
      `<p style="margin-top:0">${greeting}</p><h1 style="font-size:26px;line-height:1.2">Verify your email address</h1><p style="color:#5f594f;line-height:1.7">Finish setting up your account and protect access to your orders and service requests.</p>${actionButton("Verify email", url)}<p style="color:#746d60;font-size:13px">This link expires in one hour. If you did not create this account, you can ignore this email.</p>`,
    ),
  };
}

export function passwordResetEmail(name: string, url: string) {
  const greeting = name.trim() ? `Hi ${escapeHtml(name.trim())},` : "Hello,";
  return {
    subject: "Reset your Watplux password",
    text: `${greeting.replace(/<[^>]+>/g, "")}\n\nUse this secure link to reset your Watplux password:\n${url}\n\nThis link expires in one hour. If you did not request a password reset, you can ignore this email.`,
    html: emailShell(
      `<p style="margin-top:0">${greeting}</p><h1 style="font-size:26px;line-height:1.2">Reset your password</h1><p style="color:#5f594f;line-height:1.7">Use the secure link below to choose a new password for your account.</p>${actionButton("Reset password", url)}<p style="color:#746d60;font-size:13px">This link expires in one hour. If you did not request a password reset, you can ignore this email.</p>`,
    ),
  };
}

export function serviceRequestAcknowledgementEmail(params: {
  name: string;
  reference: string;
  serviceLabel: string;
  trackingUrl: string;
}) {
  const name = escapeHtml(params.name.trim() || "there");
  const reference = escapeHtml(params.reference);
  const serviceLabel = escapeHtml(params.serviceLabel);
  return {
    subject: `${params.serviceLabel} request received — #${params.reference}`,
    text: `Hi ${params.name.trim() || "there"},\n\nWe received your ${params.serviceLabel.toLowerCase()} request. Your reference is #${params.reference}. Our team will review it and contact you with the next step.\n\nTrack your requests: ${params.trackingUrl}`,
    html: emailShell(
      `<p style="margin-top:0">Hi ${name},</p><h1 style="font-size:26px;line-height:1.2">Your request is safely with us.</h1><p style="color:#5f594f;line-height:1.7">We received your <strong>${serviceLabel.toLowerCase()}</strong> request. Our team will review the details and contact you with the next practical step.</p><div style="margin:24px 0;border-radius:6px;background:#f7f3e8;padding:18px"><span style="display:block;color:#746d60;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Request reference</span><strong style="display:block;margin-top:4px;font-size:20px">#${reference}</strong></div>${actionButton("Track service requests", params.trackingUrl)}`,
    ),
  };
}
