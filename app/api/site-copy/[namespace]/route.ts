import { NextResponse } from "next/server";

import { getSiteCopyNamespace } from "@/app/_data/site-copy";

const PUBLIC_NAMESPACES = new Set(["system"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ namespace: string }> },
) {
  const { namespace } = await params;
  if (!PUBLIC_NAMESPACES.has(namespace)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ copy: await getSiteCopyNamespace(namespace) });
}
