"use client";

import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

function initials(name: string, email: string, fallback: string) {
  const value = name.trim() || email.split("@")[0] || fallback;
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
  const copy = useSiteCopy();
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
        throw new Error(result?.error ?? copy("account.avatar.updateFailed"));
      }
      setCurrentImage(result.image);
      toast.success(copy("account.avatar.updated"));
      router.refresh();
    } catch (error) {
      toast.error(copy("account.avatar.uploadFailed"), {
        description:
          error instanceof Error
            ? error.message
            : copy("account.avatar.tryAgain"),
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
        throw new Error(result?.error ?? copy("account.avatar.removeFailed"));
      }
      setCurrentImage(null);
      setConfirmingRemove(false);
      toast.success(copy("account.avatar.removed"));
      router.refresh();
    } catch (error) {
      toast.error(copy("account.avatar.removeError"), {
        description:
          error instanceof Error
            ? error.message
            : copy("account.avatar.tryAgain"),
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
          {initials(name, email, copy("account.userFallback"))}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{copy("account.avatar.title")}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {copy("account.avatar.description")}
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
              ? copy("account.avatar.uploading")
              : currentImage
                ? copy("account.avatar.change")
                : copy("account.avatar.upload")}
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
              {copy("account.avatar.remove")}
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title={copy("account.avatar.confirmTitle")}
        description={copy("account.avatar.confirmDescription")}
        confirmLabel={copy("account.avatar.confirm")}
        destructive
        busy={removing}
        onConfirm={remove}
      />
    </div>
  );
}
