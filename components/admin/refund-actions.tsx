"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "@/components/ui/toast";
import { z } from "zod";

import {
  ControlledInput,
  ControlledTextarea,
} from "@/components/forms/controlled-fields";
import { UrlDialog, useUrlDialog } from "@/components/router/url-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DialogFooter } from "@/components/ui/dialog";
import { requestRefundSchema } from "@/src/modules/payment/schema";

async function postMutation(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      payload?.issues?.[0] ?? payload?.error ?? "Request failed.",
    );
}

type RefundInput = z.input<typeof requestRefundSchema>;
type RefundOutput = z.output<typeof requestRefundSchema>;
export function RequestRefundForm({
  paymentAttemptId,
}: {
  paymentAttemptId: string;
}) {
  const router = useRouter();
  const dialogKey = `refund-request-${paymentAttemptId}`;
  const dialog = useUrlDialog(dialogKey);
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, isValid },
  } = useForm<RefundInput, unknown, RefundOutput>({
    resolver: zodResolver(requestRefundSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: { reason: undefined, amountMinor: undefined },
  });
  useEffect(() => {
    if (!dialog.isOpen) reset();
  }, [dialog.isOpen, reset]);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => dialog.open()}>
        Request refund
      </Button>
      <UrlDialog
        dialogKey={dialogKey}
        title="Request refund"
        description="Leave the amount blank to refund the full remaining refundable balance."
      >
        {(close) => {
          const closeAndReset = () => {
            reset();
            close();
          };
          return (
            <form
              className="grid gap-4"
              noValidate
              onSubmit={handleSubmit(async (values) => {
                try {
                  await postMutation(
                    `/api/admin/payments/${paymentAttemptId}/refunds`,
                    values,
                  );
                  toast.success("Refund requested.");
                  closeAndReset();
                  router.refresh();
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Could not request a refund.",
                  );
                }
              })}
            >
              <ControlledInput
                control={control}
                name="amountMinor"
                label="Amount (minor units)"
                description="Optional. For NGN, 250000 means ₦2,500."
                type="number"
                min="1"
                step="1"
                valueAsNumber
                emptyAsUndefined
              />
              <ControlledTextarea
                control={control}
                name="reason"
                label="Reason"
                rows={3}
                maxLength={2000}
                emptyAsUndefined
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeAndReset}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting || !isValid}>
                  {isSubmitting ? "Requesting…" : "Request refund"}
                </Button>
              </DialogFooter>
            </form>
          );
        }}
      </UrlDialog>
    </>
  );
}

export function CancelRefundButton({ refundId }: { refundId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  function cancel() {
    startTransition(async () => {
      try {
        await postMutation(
          `/api/admin/payments/refunds/${refundId}/cancel`,
          {},
        );
        toast.success("Refund cancelled.");
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not cancel this refund.",
        );
      }
    });
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={isPending}
      >
        Cancel refund
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Cancel refund?"
        description="This stops the pending refund request. It does not reverse a refund that has already been processed by Paystack."
        confirmLabel="Cancel refund"
        destructive
        busy={isPending}
        onConfirm={cancel}
      />
    </>
  );
}
