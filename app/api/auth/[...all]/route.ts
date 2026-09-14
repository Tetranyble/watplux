import { toNextJsHandler } from "better-auth/next-js";
import { io } from "next/cache";

import { getAuth } from "@/lib/auth";

export async function GET(request: Request) {
  await io();
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  await io();
  return toNextJsHandler(getAuth()).POST(request);
}
