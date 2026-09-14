import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { hashRateLimitIdentity } from "@/lib/request-security";

export interface RateLimitRule {
  namespace: string;
  identity: string;
  windowSeconds: number;
  max: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

/**
 * Database-backed fixed-window limiter for public application endpoints that
 * are outside Better Auth. The UPDATE path increments atomically; window
 * rollover is protected by a row transaction lock.
 */
export async function consumeRateLimit(
  rule: RateLimitRule,
): Promise<RateLimitDecision> {
  const key = `${rule.namespace}:${hashRateLimitIdentity(rule.identity)}`;
  const now = new Date();
  const newExpiry = new Date(now.getTime() + rule.windowSeconds * 1000);

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        count: number;
        expiresAt: Date;
      }>
    >`
      SELECT id, count, expires_at AS expiresAt
      FROM request_rate_limits
      WHERE bucket_key = ${key}
      FOR UPDATE
    `;

    const current = rows[0];
    if (!current) {
      await tx.requestRateLimit.create({
        data: {
          id: randomUUID(),
          bucketKey: key,
          count: 1,
          windowStartedAt: now,
          expiresAt: newExpiry,
        },
      });
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: Math.max(0, rule.max - 1),
      };
    }

    if (current.expiresAt.getTime() <= now.getTime()) {
      await tx.requestRateLimit.update({
        where: { id: current.id },
        data: { count: 1, windowStartedAt: now, expiresAt: newExpiry },
      });
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: Math.max(0, rule.max - 1),
      };
    }

    const nextCount = current.count + 1;
    await tx.requestRateLimit.update({
      where: { id: current.id },
      data: { count: { increment: 1 } },
    });

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((current.expiresAt.getTime() - now.getTime()) / 1000),
    );
    return {
      allowed: nextCount <= rule.max,
      retryAfterSeconds: nextCount <= rule.max ? 0 : retryAfterSeconds,
      remaining: Math.max(0, rule.max - nextCount),
    };
  });
}
