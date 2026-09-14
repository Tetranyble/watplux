import type {
  Order,
  OrderAddress,
  OrderItem,
  OrderStatusHistory,
} from "@prisma/client";

import type { OrderStatus } from "@/src/modules/order/domain/order-state-machine";

/**
 * Safe, client-returnable projections — the only shapes any order
 * use-case is allowed to hand back to a caller (same convention as
 * `src/modules/inventory/types.ts`). BigInt ids are always stringified;
 * Prisma `Decimal` fields are always converted to plain `number` before
 * crossing this boundary — display-only, never used for further
 * arithmetic (every calculation stays in `Decimal`/integer minor units up
 * to the point of writing to the database, per `repo.ts`/`domain/`).
 */

export interface OrderItemRecord {
  id: string;
  productId: string | null;
  productVariantId: string | null;
  productNameSnapshot: string;
  skuSnapshot: string;
  variantLabelSnapshot: string | null;
  unitPriceMinor: number;
  quantity: number;
  discountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
  createdAt: string;
}

export interface OrderAddressRecord {
  id: string;
  type: "SHIPPING" | "BILLING";
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string | null;
  deliveryNotes: string | null;
}

export interface OrderStatusHistoryRecord {
  id: string;
  fromStatus: string;
  toStatus: string;
  actorType: "SYSTEM" | "ADMIN" | "WEBHOOK";
  actorId: string | null;
  note: string | null;
  createdAt: string;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  userId: string | null;
  guestEmail: string | null;
  status: OrderStatus;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetail extends OrderSummary {
  guestPhone: string | null;
  customerNote: string | null;
  authoritativePaymentAttemptId: string | null;
  items: OrderItemRecord[];
  addresses: OrderAddressRecord[];
  statusHistory: OrderStatusHistoryRecord[];
}

/** Keyset ("cursor") pagination envelope — matches
 * `src/modules/inventory/types.ts`'s `CursorPage<T>` shape exactly; not
 * imported from there to keep the two modules independent (the same
 * small-duplication precedent Phase 4/5 already established). */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Result of `markOrderPaid` — always returned, never thrown, for the
 * "already PAID"/"already CANCELLED" outcomes (docs/PHASE_6_ORDER_PLAN.md
 * §8/§11/§12): the caller (a future Payment module) needs to distinguish
 * these from a genuine error. */
export interface MarkOrderPaidResult {
  transitioned: boolean;
  order: OrderDetail;
}

export function toOrderItemRecord(item: OrderItem): OrderItemRecord {
  return {
    id: item.id.toString(),
    productId: item.productId?.toString() ?? null,
    productVariantId: item.productVariantId?.toString() ?? null,
    productNameSnapshot: item.productNameSnapshot,
    skuSnapshot: item.skuSnapshot,
    variantLabelSnapshot: item.variantLabelSnapshot,
    unitPriceMinor: item.unitPriceMinor,
    quantity: item.quantity.toNumber(),
    discountMinor: item.discountMinor,
    taxMinor: item.taxMinor,
    lineTotalMinor: item.lineTotalMinor,
    createdAt: item.createdAt.toISOString(),
  };
}

export function toOrderAddressRecord(
  address: OrderAddress,
): OrderAddressRecord {
  return {
    id: address.id.toString(),
    type: address.type,
    fullName: address.fullName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    state: address.state,
    country: address.country,
    postalCode: address.postalCode,
    deliveryNotes: address.deliveryNotes,
  };
}

export function toOrderStatusHistoryRecord(
  history: OrderStatusHistory,
): OrderStatusHistoryRecord {
  return {
    id: history.id.toString(),
    fromStatus: history.fromStatus,
    toStatus: history.toStatus,
    actorType: history.actorType,
    actorId: history.actorId?.toString() ?? null,
    note: history.note,
    createdAt: history.createdAt.toISOString(),
  };
}

export function toOrderSummary(order: Order): OrderSummary {
  return {
    id: order.id.toString(),
    orderNumber: order.orderNumber,
    userId: order.userId?.toString() ?? null,
    guestEmail: order.guestEmail,
    status: order.status,
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    deliveryFeeMinor: order.deliveryFeeMinor,
    taxMinor: order.taxMinor,
    totalMinor: order.totalMinor,
    currency: order.currency,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export function toOrderDetail(
  order: Order & {
    items: OrderItem[];
    addresses: OrderAddress[];
    statusHistory: OrderStatusHistory[];
  },
): OrderDetail {
  return {
    ...toOrderSummary(order),
    guestPhone: order.guestPhone,
    customerNote: order.customerNote,
    authoritativePaymentAttemptId:
      order.authoritativePaymentAttemptId?.toString() ?? null,
    items: order.items.map(toOrderItemRecord),
    addresses: order.addresses.map(toOrderAddressRecord),
    statusHistory: order.statusHistory.map(toOrderStatusHistoryRecord),
  };
}
