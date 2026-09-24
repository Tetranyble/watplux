import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ContentSubNav } from "@/components/admin/content-sub-nav";
import { SiteCopyManager } from "@/components/admin/site-copy-manager";
import { getSessionUser } from "@/lib/session";
import { findSiteCopySection } from "@/src/modules/site-copy/sections";
import { listSiteCopyForAdmin } from "@/src/modules/site-copy/use-cases/list-site-copy-for-admin";

export const metadata: Metadata = { title: "Website copy" };
export const instant = false;

export default async function WebsiteCopySectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section: namespace } = await params;
  const section = findSiteCopySection(namespace);
  if (!section) notFound();

  const actor = await getSessionUser();
  if (!actor) return null;
  const entries = await listSiteCopyForAdmin(actor, namespace);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-primary-emphasis">
          Public content
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Website copy</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          Edit visitor-facing content. Changes publish after saving.
        </p>
      </div>

      <ContentSubNav active={namespace} />

      <div>
        <h2 className="text-xl font-semibold">{section.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          {section.description}
        </p>
      </div>

      <SiteCopyManager
        namespace={namespace}
        entries={entries.map((entry) => ({
          key: entry.key,
          namespace: entry.namespace,
          label: entry.label,
          value: entry.value,
          description: entry.description,
          multiline: entry.multiline,
        }))}
      />
    </div>
  );
}
