/**
 * The one place minor-unit money formatting logic lives for the storefront
 * (docs/PHASE_9_STOREFRONT_PLAN.md §6/§10) — every component that displays
 * a price imports this instead of hand-rolling `Intl.NumberFormat` calls.
 * Purely presentational: never used to compute a price, total, or
 * discount — the backend remains authoritative for all of that.
 */
export function formatMinorUnits(
  amountMinor: number,
  currency: string,
): string {
  const amount = amountMinor / 100;
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).format(amount);
  } catch {
    // Unknown/invalid currency code — fall back to a plain numeric
    // display rather than throwing during render.
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDiscountPercent(
  priceMinor: number,
  compareAtPriceMinor: number,
): number {
  if (compareAtPriceMinor <= 0 || compareAtPriceMinor <= priceMinor) {
    return 0;
  }
  return Math.round(
    ((compareAtPriceMinor - priceMinor) / compareAtPriceMinor) * 100,
  );
}

export function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity)
    ? String(quantity)
    : quantity.toFixed(3).replace(/\.?0+$/, "");
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
  }).format(value instanceof Date ? value : new Date(value));
}
