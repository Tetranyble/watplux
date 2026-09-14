"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

export function UserSecurityActions({
  userId,
  status,
}: {
  userId: string;
  status: "ACTIVE" | "SUSPENDED";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const post = (path: string, body?: unknown) =>
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Request failed.");
        return;
      }
      toast.success(
        path === "force-logout"
          ? "All sessions revoked."
          : status === "ACTIVE"
            ? "Account suspended."
            : "Account activated.",
      );
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={status === "ACTIVE" ? "destructive" : "default"}
        disabled={pending}
        onClick={() =>
          post("status", {
            status: status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
          })
        }
      >
        {status === "ACTIVE" ? "Suspend account" : "Reactivate account"}
      </Button>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => post("force-logout")}
      >
        Log out all devices
      </Button>
    </div>
  );
}
