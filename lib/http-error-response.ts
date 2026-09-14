import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";

import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Shared Route Handler error mapping — per docs/ARCHITECTURE.md §23:
 * never leak stack traces, SQL/Prisma errors, or internal messages to the
 * client. A known `AppError` (or `ZodError`) returns its safe message and
 * status; anything else becomes a generic 500 with no detail, logged
 * server-side for investigation.
 */
export function errorResponse(error: unknown): NextResponse {
  unstable_rethrow(error);

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid input.", issues: error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  if (isAppError(error)) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
    );
  }

  logger.error({ err: error }, "Unhandled error in Route Handler");
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}
