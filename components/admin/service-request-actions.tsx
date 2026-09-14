"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ServiceRequestStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { nextServiceRequestStatuses } from "@/src/modules/service-request/domain";

export function ServiceRequestActions({
  requestId,
  status,
  assignedTo,
}: {
  requestId: string;
  status: ServiceRequestStatus;
  assignedTo: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function patch(body: Record<string, unknown>) {
    startTransition(async () => {
      const response = await fetch(`/api/admin/service-requests/${requestId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        toast.error("Could not update request", {
          description:
            payload?.error?.message ?? payload?.message ?? "Update failed.",
        });
        return;
      }
      toast.success("Service request updated.");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => patch({ assignment: assignedTo ? "none" : "self" })}
        >
          {assignedTo ? "Unassign" : "Assign to me"}
        </Button>
        {nextServiceRequestStatuses(status).map((next) => (
          <Button
            key={next}
            variant={next === "CANCELLED" ? "destructive" : "default"}
            disabled={pending}
            onClick={() => patch({ status: next })}
          >
            Mark {next.replaceAll("_", " ").toLowerCase()}
          </Button>
        ))}
      </div>
    </div>
  );
}
