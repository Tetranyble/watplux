"use client";

import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

function initials(name: string, email: string) {
  const value = name.trim() || email.split("@")[0] || "User";
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function AvatarUpload({
  name,
  email,
  image,
}: {
  name: string;
  email: string;
  image: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [currentImage, setCurrentImage] = useState(image);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/account/avatar", {
        method: "POST",
        body: form,
      });
      const result = (await response.json().catch(() => null)) as {
        image?: string;
        error?: string;
      } | null;
      if (!response.ok || !result?.image) {
        throw new Error(result?.error ?? "Could not update your photo.");
      }
      setCurrentImage(result.image);
      toast.success("Profile photo updated");
      router.refresh();
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

  async function remove() {
    setRemoving(true);
    try {
      const response = await fetch("/api/account/avatar", {
        method: "DELETE",
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(result?.error ?? "Could not remove your photo.");
      }
      setCurrentImage(null);
      setConfirmingRemove(false);
      toast.success("Profile photo removed");
      router.refresh();
    } catch (error) {
      toast.error("Could not remove photo", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center">
      <Avatar className="size-20 ring-1 ring-border">
        {currentImage ? <AvatarImage src={currentImage} alt="" /> : null}
        <AvatarFallback className="text-lg">
          {initials(name, email)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="font-medium">Profile photo</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a JPEG, PNG, WebP, or AVIF image. It will be cropped to a
          square and optimized automatically.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
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
            size="sm"
            variant="outline"
            disabled={uploading || removing}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <ImagePlus aria-hidden="true" />
            )}
            {uploading
              ? "Uploading…"
              : currentImage
                ? "Change photo"
                : "Upload photo"}
          </Button>
          {currentImage ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={uploading || removing}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmingRemove(true)}
            >
              <Trash2 aria-hidden="true" />
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title="Remove profile photo?"
        description="Your initials will be shown until you upload another photo."
        confirmLabel="Remove photo"
        destructive
        busy={removing}
        onConfirm={remove}
      />
    </div>
  );
}
