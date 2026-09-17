import nodemailer from "nodemailer";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: ReturnType<typeof nodemailer.createTransport> | undefined;

function getTransporter() {
  if (transporter) return transporter;
  if (!env.MAIL_HOST || !env.MAIL_FROM_ADDRESS) {
    throw new Error(
      "MAIL_HOST and MAIL_FROM_ADDRESS are required for SMTP delivery.",
    );
  }

  transporter = nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: env.MAIL_SCHEME === "ssl" || env.MAIL_PORT === 465,
    requireTLS: env.MAIL_SCHEME === "tls",
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    auth: env.MAIL_USERNAME
      ? { user: env.MAIL_USERNAME, pass: env.MAIL_PASSWORD }
      : undefined,
  });
  return transporter;
}

export async function sendTransactionalEmail(
  message: TransactionalEmail,
): Promise<void> {
  if (env.MAIL_MAILER === "log") {
    logger.info(
      { recipient: message.to, subject: message.subject },
      "Transactional email suppressed by log transport",
    );
    return;
  }

  if (!env.MAIL_FROM_ADDRESS) {
    throw new Error("MAIL_FROM_ADDRESS is required for SMTP delivery.");
  }

  await getTransporter().sendMail({
    from: {
      address: env.MAIL_FROM_ADDRESS,
      name: env.MAIL_FROM_NAME,
    },
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
