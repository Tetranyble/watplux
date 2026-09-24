"use client";

import { Badge } from "@/components/ui/badge";
import type { OrderSummary } from "@/src/modules/order/types";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

// `components/**` may not import a `domain`-typed module directly
// (eslint boundaries) — derived from `OrderSummary`'s own field type
// instead of importing `OrderStatus` from `domain/order-state-machine.ts`.
type OrderStatus = OrderSummary["status"];

const STATUS_VARIANT: Record<
  OrderStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING_PAYMENT: "outline",
  PAID: "secondary",
  PROCESSING: "secondary",
  READY_FOR_DISPATCH: "secondary",
  SHIPPED: "secondary",
  DELIVERED: "default",
  CANCELLED: "destructive",
  REFUNDED: "destructive",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const copy = useSiteCopy();
  const labels: Record<OrderStatus, string> = {
    PENDING_PAYMENT: copy("commerce.status.pending"),
    PAID: copy("commerce.status.paid"),
    PROCESSING: copy("commerce.status.processing"),
    READY_FOR_DISPATCH: copy("commerce.status.dispatch"),
    SHIPPED: copy("commerce.status.shipped"),
    DELIVERED: copy("commerce.status.delivered"),
    CANCELLED: copy("commerce.status.cancelled"),
    REFUNDED: copy("commerce.status.refunded"),
  };
  return <Badge variant={STATUS_VARIANT[status]}>{labels[status]}</Badge>;
}
