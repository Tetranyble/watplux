"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "@/components/ui/toast";

import { Button } from "@/components/ui/button";
import type { ProductDetail } from "@/src/modules/catalog/types";

async function postAction(
  url: string,
): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    return { ok: false, message: payload?.error ?? "Request failed." };
  }
  return { ok: true };
}

/** `publishProduct`/`archiveProduct` — `products.update`, enforced
 * server-side regardless of what this component renders
 * (docs/PHASE_10_ADMIN_PLAN.md §10/§20). */
export function ProductLifecycleActions({
  product,
}: {
  product: ProductDetail;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handlePublish() {
    startTransition(async () => {
      const result = await postAction(
        `/api/admin/catalog/products/${product.id}/publish`,
      );
      if (!result.ok) {
        toast.error(result.message ?? "Could not publish this product.");
        return;
      }
      toast.success("Product published.");
      router.refresh();
    });
  }

  function handleArchive() {
    startTransition(async () => {
      const result = await postAction(
        `/api/admin/catalog/products/${product.id}/archive`,
      );
      if (!result.ok) {
        toast.error(result.message ?? "Could not archive this product.");
        return;
      }
      toast.success("Product archived.");
      router.refresh();
    });
  }

  return (
    <div className="flex gap-2">
      {product.status !== "ACTIVE" ? (
        <Button onClick={handlePublish} disabled={isPending} size="sm">
          Publish
        </Button>
      ) : null}
      {product.status === "ACTIVE" ? (
        <Button
          onClick={handleArchive}
          disabled={isPending}
          variant="outline"
          size="sm"
        >
          Archive
        </Button>
      ) : null}
    </div>
  );
}
