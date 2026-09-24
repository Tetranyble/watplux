import { Message, SMTPClient } from "emailjs";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function getClient() {
  if (!env.MAIL_HOST || !env.MAIL_FROM_ADDRESS) {
    throw new Error(
      "MAIL_HOST and MAIL_FROM_ADDRESS are required for SMTP delivery.",
    );
  }

  return new SMTPClient({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    ssl: env.MAIL_SCHEME === "ssl" || env.MAIL_PORT === 465,
    tls: env.MAIL_SCHEME === "tls" && env.MAIL_PORT !== 465,
    timeout: 15_000,
    ...(env.MAIL_USERNAME
      ? { user: env.MAIL_USERNAME, password: env.MAIL_PASSWORD }
      : {}),
  });
}

function mailbox(name: string, address: string): string {
  const safeName = name.replace(/["\r\n]/g, "").trim();
  return safeName ? `"${safeName}" <${address}>` : address;
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

  const client = getClient();
  const email = new Message({
    from: mailbox(env.MAIL_FROM_NAME, env.MAIL_FROM_ADDRESS),
    to: message.to,
    subject: message.subject,
    text: message.text,
    attachment: [
      {
        data: message.html,
        alternative: true,
        type: "text/html",
        charset: "utf-8",
      },
    ],
  });

  try {
    await client.sendAsync(email);
  } finally {
    client.smtp.close();
  }
}
