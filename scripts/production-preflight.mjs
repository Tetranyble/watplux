#!/usr/bin/env node
const required = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "APP_BASE_URL",
  "PAYSTACK_SECRET_KEY",
  "INTERNAL_WORKER_SECRET",
  "GUEST_ORDER_TOKEN_SECRET",
  "S3_BUCKET",
];

const problems = [];
for (const name of required) {
  if (!process.env[name]?.trim()) problems.push(`${name} is required`);
}
if (process.env.DEPLOYMENT_ENV !== "production")
  problems.push("DEPLOYMENT_ENV must be production");
if (process.env.MEDIA_STORAGE_PROVIDER !== "s3")
  problems.push("MEDIA_STORAGE_PROVIDER must be s3");
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
