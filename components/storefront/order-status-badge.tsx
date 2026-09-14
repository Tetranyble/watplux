import { Badge } from "@/components/ui/badge";
import type { OrderSummary } from "@/src/modules/order/types";

// `components/**` may not import a `domain`-typed module directly
// (eslint boundaries) — derived from `OrderSummary`'s own field type
// instead of importing `OrderStatus` from `domain/order-state-machine.ts`.
type OrderStatus = OrderSummary["status"];

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Pending payment",
  PAID: "Paid",
  PROCESSING: "Processing",
  READY_FOR_DISPATCH: "Ready for dispatch",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

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
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
