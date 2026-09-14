"use client";

import { useRef, useState } from "react";
import { ImagePlus, UploadCloud, X } from "lucide-react";
import { toast } from "@/components/ui/toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function MediaImageField({
  name,
  value,
  defaultValue = "",
  onValueChange,
  placeholder = "Upload or paste an image URL",
}: {
  name?: string;
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string) => void;
  placeholder?: string;
}) {
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = controlled ? (value ?? "") : internalValue;
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function update(next: string) {
    if (!controlled) setInternalValue(next);
    onValueChange?.(next);
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/admin/media", {
        method: "POST",
        body: form,
      });
      const result = (await response.json().catch(() => null)) as {
        asset?: { publicUrl: string };
        error?: string;
      } | null;
      if (!response.ok || !result?.asset)
        throw new Error(result?.error ?? "Upload failed.");
      update(result.asset.publicUrl);
      toast.success("Image uploaded", {
        description: "The image is ready to use when you save.",
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

  return (
    <div className="space-y-2">
      {currentValue ? (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- preview accepts managed and legacy remote URLs */}
          <img
            src={currentValue}
            alt=""
            className="size-14 rounded-md object-cover"
          />
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {currentValue}
          </p>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => update("")}
            aria-label="Remove image"
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input
          name={name}
          value={currentValue}
          onChange={(event) => update(event.target.value)}
          placeholder={placeholder}
          className="min-w-0"
        />
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
          size="icon"
          variant="outline"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          aria-label="Upload image"
        >
          {uploading ? (
            <UploadCloud className="size-4 animate-pulse" />
          ) : (
            <ImagePlus className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
