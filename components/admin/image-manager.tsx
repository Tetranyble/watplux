"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ImagePlus, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "@/components/ui/toast";
import { z } from "zod";

import { ControlledInput } from "@/components/forms/controlled-fields";
import { UrlDialog, useUrlDialog } from "@/components/router/url-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  addProductImageSchema,
  updateProductImageSchema,
} from "@/src/modules/catalog/schema";
import type { CatalogImage } from "@/src/modules/catalog/types";

type AddValues = z.input<typeof addProductImageSchema>;
type EditValues = z.input<typeof updateProductImageSchema>;

async function mutate(
  url: string,
  method: string,
  body?: Record<string, unknown>,
) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    issues?: string[];
  } | null;
  return { ok: response.ok, message: payload?.issues?.[0] ?? payload?.error };
}

function AddImageUrlForm({
  productId,
  close,
}: {
  productId: string;
  close: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    formState: { isValid },
  } = useForm<AddValues>({
    resolver: zodResolver(addProductImageSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: { productId, url: "", altText: undefined, sortOrder: 0 },
  });
  const submit = handleSubmit((values) =>
    startTransition(async () => {
      const result = await mutate(
        `/api/admin/catalog/products/${productId}/images`,
        "POST",
        values as Record<string, unknown>,
      );
      if (!result.ok) {
        toast.error(result.message ?? "Could not add image.");
        return;
      }
      toast.success("Image attached.");
      close();
      router.refresh();
    }),
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      <ControlledInput
        control={control}
        name="url"
        label="Image URL"
        placeholder="https://…"
        required
      />
      <ControlledInput
        control={control}
        name="altText"
        label="Alt text"
        description="Describe the product image for customers using assistive technology."
        emptyAsUndefined
      />
      <ControlledInput
        control={control}
        name="sortOrder"
        label="Sort order"
        type="number"
        min={0}
        valueAsNumber
        emptyAsUndefined
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !isValid}>
          {pending ? "Adding…" : "Add image"}
        </Button>
      </div>
    </form>
  );
}

function EditImageForm({
  image,
  close,
}: {
  image: CatalogImage;
  close: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const {
    control,
    handleSubmit,
    formState: { isValid },
  } = useForm<EditValues>({
    resolver: zodResolver(updateProductImageSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      altText: image.altText,
      width: image.width,
      height: image.height,
      sortOrder: image.sortOrder,
    },
  });
  const submit = handleSubmit((values) =>
    startTransition(async () => {
      const result = await mutate(
        `/api/admin/catalog/images/${image.id}`,
        "PATCH",
        values as Record<string, unknown>,
      );
      if (!result.ok) {
        toast.error(result.message ?? "Could not update image.");
        return;
      }
      toast.success("Image updated.");
      close();
      router.refresh();
    }),
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      <ControlledInput
        control={control}
        name="altText"
        label="Alt text"
        emptyAsNull
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <ControlledInput
          control={control}
          name="width"
          label="Width"
          type="number"
          min={1}
          valueAsNumber
          emptyAsNull
        />
        <ControlledInput
          control={control}
          name="height"
          label="Height"
          type="number"
          min={1}
          valueAsNumber
          emptyAsNull
        />
        <ControlledInput
          control={control}
          name="sortOrder"
          label="Sort order"
          type="number"
          min={0}
          valueAsNumber
          emptyAsUndefined
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !isValid}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function ImageRow({
  image,
  canUpdate,
}: {
  image: CatalogImage;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const dialogKey = `image-edit-${image.id}`;
  const dialog = useUrlDialog(dialogKey);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  function run(
    url: string,
    method: string,
    success: string,
    after?: () => void,
  ) {
    startTransition(async () => {
      const result = await mutate(url, method);
      if (!result.ok) {
        toast.error(result.message ?? "Request failed.");
        return;
      }
      toast.success(success);
      after?.();
      router.refresh();
    });
  }
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-4 pt-0 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-20 shrink-0 overflow-hidden rounded-lg border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={image.altText ?? ""}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">
                {image.altText || "Product image"}
              </p>
              {image.isPrimary ? (
                <Badge variant="outline">Primary</Badge>
              ) : null}
            </div>
            <p className="mt-1 max-w-lg truncate text-xs text-muted-foreground">
              {image.url}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {image.width && image.height
                ? `${image.width}×${image.height} · `
                : ""}
              sort {image.sortOrder}
            </p>
          </div>
        </div>
        {canUpdate ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => dialog.open()}
            >
              Edit
            </Button>
            {!image.isPrimary ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    `/api/admin/catalog/images/${image.id}/primary`,
                    "POST",
                    "Primary image updated.",
                  )
                }
              >
                Set primary
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setRemoveOpen(true)}
            >
              Remove
            </Button>
          </div>
        ) : null}
        <UrlDialog
          dialogKey={dialogKey}
          title="Edit image"
          description="Update image metadata without changing the stored asset."
        >
          {(close) => <EditImageForm image={image} close={close} />}
        </UrlDialog>
        <ConfirmDialog
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          title="Remove product image?"
          description="This detaches the image from the product. A reusable stored media asset is not deleted here."
          confirmLabel="Remove"
          destructive
          busy={pending}
          onConfirm={() =>
            run(
              `/api/admin/catalog/images/${image.id}`,
              "DELETE",
              "Image removed.",
              () => setRemoveOpen(false),
            )
          }
        />
      </CardContent>
    </Card>
  );
}

function UploadImage({ productId }: { productId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/admin/media", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as {
        asset?: {
          publicUrl: string;
          width: number;
          height: number;
          originalName: string;
        };
        error?: string;
      } | null;
      if (!response.ok || !payload?.asset)
        throw new Error(payload?.error ?? "Could not upload image.");
      const result = await mutate(
        `/api/admin/catalog/products/${productId}/images`,
        "POST",
        {
          url: payload.asset.publicUrl,
          width: payload.asset.width,
          height: payload.asset.height,
          altText: payload.asset.originalName
            .replace(/\.[^.]+$/, "")
            .replace(/[-_]+/g, " "),
        },
      );
      if (!result.ok)
        throw new Error(
          result.message ?? "The image uploaded but could not be attached.",
        );
      toast.success("Image uploaded and attached.");
      router.refresh();
    } catch (error) {
      toast.error("Could not add image", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <>
      <Input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
      >
        <UploadCloud className="size-4" />
        {uploading ? "Processing…" : "Upload image"}
      </Button>
    </>
  );
}

export function ImageManager({
  productId,
  images,
  canCreate,
  canUpdate,
}: {
  productId: string;
  images: CatalogImage[];
  canCreate: boolean;
  canUpdate: boolean;
}) {
  const addUrl = useUrlDialog("image-add-url");
  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex flex-wrap justify-end gap-2">
          <UploadImage productId={productId} />
          <Button type="button" onClick={() => addUrl.open()}>
            <ImagePlus className="size-4" />
            Add by URL
          </Button>
        </div>
      ) : null}
      {images.length ? (
        <div className="grid gap-3">
          {images.map((image) => (
            <ImageRow key={image.id} image={image} canUpdate={canUpdate} />
          ))}
        </div>
      ) : (
        <EmptyState
          className="min-h-40 py-8"
          icon={ImagePlus}
          title="No product images yet"
          description="Upload or attach the first image for this product."
        />
      )}
      <UrlDialog
        dialogKey="image-add-url"
        title="Attach image URL"
        description="Prefer the upload flow for Watplux-managed media. Use a URL for an existing external asset."
      >
        {(close) => <AddImageUrlForm productId={productId} close={close} />}
      </UrlDialog>
    </div>
  );
}
