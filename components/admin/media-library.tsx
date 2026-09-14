"use client";

import { useRef, useState } from "react";
import { Check, Copy, ImagePlus, Trash2, UploadCloud } from "lucide-react";
import { toast } from "@/components/ui/toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { MediaAssetRecord } from "@/src/modules/media/types";

export function MediaLibrary({
  initialItems,
  canUpload,
  canDelete,
  initialNextCursor,
}: {
  initialItems: MediaAssetRecord[];
  canUpload: boolean;
  canDelete: boolean;
  initialNextCursor: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const response = await fetch("/api/admin/media?limit=40", {
      cache: "no-store",
    });
    if (!response.ok) return;
    const data = (await response.json()) as {
      items: MediaAssetRecord[];
      nextCursor: string | null;
    };
    setItems(data.items);
    setNextCursor(data.nextCursor);
  }

  async function upload(files: FileList | File[]) {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("file", file);
        const response = await fetch("/api/admin/media", {
          method: "POST",
          body: form,
        });
        const result = (await response.json().catch(() => null)) as {
          asset?: MediaAssetRecord;
          error?: string;
        } | null;
        if (!response.ok || !result?.asset)
          throw new Error(result?.error ?? `Could not upload ${file.name}.`);
      }
      await refresh();
      toast.success("Media uploaded", {
        description: "Images were processed and added to the reusable library.",
      });
    } catch (error) {
      toast.error("Upload failed", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/admin/media?limit=40&cursor=${encodeURIComponent(nextCursor)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Could not load more media.");
      const data = (await response.json()) as {
        items: MediaAssetRecord[];
        nextCursor: string | null;
      };
      setItems((current) => [...current, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (error) {
      toast.error("Could not load more media", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setLoadingMore(false);
    }
  }

  async function remove(id: string) {
    setDeleting(true);
    const response = await fetch(`/api/admin/media/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setItems((current) => current.filter((item) => item.id !== id));
      toast.success("Media deleted");
      setDeletingId(null);
      setDeleting(false);
      return;
    }
    const result = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    toast.error("Could not delete media", {
      description: result?.error ?? "The image may still be in use.",
    });
    setDeleting(false);
  }

  async function copy(url: string, id: string) {
    const absolute = new URL(url, window.location.origin).toString();
    await navigator.clipboard.writeText(absolute);
    setCopied(id);
    toast.success("Media URL copied");
    window.setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-6">
      {canUpload ? (
        <div className="rounded-2xl border border-dashed bg-muted/20 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">Upload catalog imagery</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                JPEG, PNG, WebP and AVIF are accepted. Watplux normalizes
                uploads to WebP, strips metadata and keeps a stable media URL
                independent of the storage provider.
              </p>
            </div>
            <Input
              ref={fileRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="hidden"
              onChange={(event) =>
                event.target.files && void upload(event.target.files)
              }
            />
            <Button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <UploadCloud className="size-4" />
              {uploading ? "Processing…" : "Upload images"}
            </Button>
          </div>
        </div>
      ) : null}

      {items.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.id}
              className="overflow-hidden rounded-2xl border bg-card"
            >
              <div className="aspect-[4/3] bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- admin media preview is intentionally storage-provider agnostic */}
                <img
                  src={item.publicUrl}
                  alt={item.originalName}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="space-y-3 p-4">
                <div>
                  <p className="truncate font-medium">{item.originalName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.width}×{item.height} ·{" "}
                    {(item.sizeBytes / 1024).toFixed(0)} KB · {item.provider}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void copy(item.publicUrl, item.id)}
                  >
                    {copied === item.id ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                    {copied === item.id ? "Copied" : "Copy URL"}
                  </Button>
                  {canDelete ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeletingId(item.id)}
                    >
                      <Trash2 className="size-4" /> Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">
          <ImagePlus className="mx-auto mb-3 size-7" />
          No media has been uploaded yet.
        </div>
      )}
      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(deletingId)}
        onOpenChange={(open) => !open && !deleting && setDeletingId(null)}
        title="Delete stored image?"
        description="This permanently removes the stored media asset. Watplux will refuse deletion while the image is still referenced by a product, category, or brand."
        confirmLabel="Delete image"
        destructive
        busy={deleting}
        onConfirm={() => (deletingId ? remove(deletingId) : undefined)}
      />
    </div>
  );
}
