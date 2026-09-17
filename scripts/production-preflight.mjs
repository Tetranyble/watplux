#!/usr/bin/env node
import path from "node:path";

const required = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "APP_BASE_URL",
  "PAYSTACK_SECRET_KEY",
  "INTERNAL_WORKER_SECRET",
  "GUEST_ORDER_TOKEN_SECRET",
  "MAIL_HOST",
  "MAIL_FROM_ADDRESS",
];

const problems = [];
for (const name of required) {
  if (!process.env[name]?.trim()) problems.push(`${name} is required`);
}
if (process.env.DEPLOYMENT_ENV !== "production")
  problems.push("DEPLOYMENT_ENV must be production");
if (process.env.MAIL_MAILER !== "smtp")
  problems.push("MAIL_MAILER must be smtp");
if (process.env.MAIL_USERNAME && !process.env.MAIL_PASSWORD)
  problems.push("MAIL_PASSWORD is required when MAIL_USERNAME is configured");
if (process.env.MEDIA_STORAGE_PROVIDER === "s3" && !process.env.S3_BUCKET)
  problems.push("S3_BUCKET is required when MEDIA_STORAGE_PROVIDER=s3");
if (process.env.MEDIA_STORAGE_PROVIDER === "local") {
  if (process.env.CPANEL_PERSISTENT_LOCAL_MEDIA !== "true")
    problems.push(
      "CPANEL_PERSISTENT_LOCAL_MEDIA must be true for production local storage",
    );
  if (!path.isAbsolute(process.env.LOCAL_MEDIA_ROOT ?? ""))
    problems.push("LOCAL_MEDIA_ROOT must be an absolute persistent path");
}
if (!["local", "s3"].includes(process.env.MEDIA_STORAGE_PROVIDER ?? ""))
  problems.push("MEDIA_STORAGE_PROVIDER must be local or s3");
for (const name of ["APP_BASE_URL", "BETTER_AUTH_URL"]) {
  const value = process.env[name];
  if (value && !value.startsWith("https://"))
    problems.push(`${name} must use https://`);
}
for (const name of [
  "BETTER_AUTH_SECRET",
  "INTERNAL_WORKER_SECRET",
  "GUEST_ORDER_TOKEN_SECRET",
]) {
  const value = process.env[name];
  if (value && value.length < 32)
    problems.push(`${name} must be at least 32 characters`);
}

if (problems.length) {
  console.error("Production preflight failed:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("Production preflight passed.");
