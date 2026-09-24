import {
  fillCopy,
  loadCopyNamespace,
} from "@/src/modules/site-copy/public-copy";

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

function emailShell(
  content: string,
  siteName: string,
  automated: string,
): string {
  return `<!doctype html><html lang="en"><body style="margin:0;background:#faf9f5;color:#211f1a;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:40px 20px"><div style="margin-bottom:24px;font-size:22px;font-weight:700">${escapeHtml(siteName)}</div><div style="border:1px solid #ded8ca;border-radius:8px;background:#fff;padding:32px">${content}</div><p style="margin-top:20px;color:#746d60;font-size:12px;line-height:1.6">${escapeHtml(automated)}</p></div></body></html>`;
}

function actionButton(label: string, url: string, fallback: string): string {
  const safeUrl = escapeHtml(url);
  return `<p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;border-radius:4px;background:#ffbe00;color:#211800;padding:13px 20px;text-decoration:none;font-weight:700">${escapeHtml(label)}</a></p><p style="color:#746d60;font-size:13px;line-height:1.6">${escapeHtml(fallback)}<br><a href="${safeUrl}" style="color:#5f4a00;word-break:break-all">${safeUrl}</a></p>`;
}

async function emailCopy() {
  const [email, site] = await Promise.all([
    loadCopyNamespace("email"),
    loadCopyNamespace("site"),
  ]);
  const siteName = site("site.name");
  const automated = fillCopy(email("email.automated"), { siteName });
  return { email, siteName, automated };
}

export async function verificationEmail(name: string, url: string) {
  const { email, siteName, automated } = await emailCopy();
  const greeting = name.trim()
    ? fillCopy(email("email.greeting"), { name: name.trim() })
    : email("email.hello");
  const expiry = email("email.verify.expiry");
  return {
    subject: fillCopy(email("email.verify.subject"), { siteName }),
    text: fillCopy(email("email.verify.text"), {
      greeting,
      siteName,
      url,
      expiry,
    }),
    html: emailShell(
      `<p style="margin-top:0">${escapeHtml(greeting)}</p><h1 style="font-size:26px;line-height:1.2">${escapeHtml(email("email.verify.title"))}</h1><p style="color:#5f594f;line-height:1.7">${escapeHtml(email("email.verify.description"))}</p>${actionButton(email("email.verify.action"), url, email("email.buttonFallback"))}<p style="color:#746d60;font-size:13px">${escapeHtml(expiry)}</p>`,
      siteName,
      automated,
    ),
  };
}

export async function passwordResetEmail(name: string, url: string) {
  const { email, siteName, automated } = await emailCopy();
  const greeting = name.trim()
    ? fillCopy(email("email.greeting"), { name: name.trim() })
    : email("email.hello");
  const expiry = email("email.reset.expiry");
  return {
    subject: fillCopy(email("email.reset.subject"), { siteName }),
    text: fillCopy(email("email.reset.text"), {
      greeting,
      siteName,
      url,
      expiry,
    }),
    html: emailShell(
      `<p style="margin-top:0">${escapeHtml(greeting)}</p><h1 style="font-size:26px;line-height:1.2">${escapeHtml(email("email.reset.title"))}</h1><p style="color:#5f594f;line-height:1.7">${escapeHtml(email("email.reset.description"))}</p>${actionButton(email("email.reset.action"), url, email("email.buttonFallback"))}<p style="color:#746d60;font-size:13px">${escapeHtml(expiry)}</p>`,
      siteName,
      automated,
    ),
  };
}

export async function serviceRequestAcknowledgementEmail(params: {
  name: string;
  reference: string;
  serviceLabel: string;
  trackingUrl: string;
}) {
  const { email, siteName, automated } = await emailCopy();
  const rawName = params.name.trim() || email("email.service.there");
  const reference = escapeHtml(params.reference);
  return {
    subject: fillCopy(email("email.service.subject"), {
      serviceLabel: params.serviceLabel,
      reference: params.reference,
    }),
    text: fillCopy(email("email.service.text"), {
      name: rawName,
      serviceLabel: params.serviceLabel.toLowerCase(),
      reference: params.reference,
      trackingUrl: params.trackingUrl,
    }),
    html: emailShell(
      `<p style="margin-top:0">${escapeHtml(fillCopy(email("email.greeting"), { name: rawName }))}</p><h1 style="font-size:26px;line-height:1.2">${escapeHtml(email("email.service.title"))}</h1><p style="color:#5f594f;line-height:1.7">${escapeHtml(fillCopy(email("email.service.description"), { serviceLabel: params.serviceLabel.toLowerCase() }))}</p><div style="margin:24px 0;border-radius:6px;background:#f7f3e8;padding:18px"><span style="display:block;color:#746d60;font-size:12px;text-transform:uppercase;letter-spacing:.08em">${escapeHtml(email("email.service.reference"))}</span><strong style="display:block;margin-top:4px;font-size:20px">#${reference}</strong></div>${actionButton(email("email.service.action"), params.trackingUrl, email("email.buttonFallback"))}`,
      siteName,
      automated,
    ),
  };
}
