import { formatDiscountPercent, formatMinorUnits } from "@/lib/format";

/**
 * The one place a price is ever rendered (docs/PHASE_9_STOREFRONT_PLAN.md
 * §6/§10) — purely presentational, purely display math (percent-off
 * badge). Never recomputes or sends a price anywhere; every value it
 * receives already came straight from the backend.
 */
export function PriceDisplay({
  priceMinor,
  compareAtPriceMinor,
  currency,
  size = "default",
}: {
  priceMinor: number;
  compareAtPriceMinor: number | null;
  currency: string;
  size?: "default" | "lg";
}) {
  const hasDiscount =
    compareAtPriceMinor !== null && compareAtPriceMinor > priceMinor;
  const discountPercent = hasDiscount
    ? formatDiscountPercent(priceMinor, compareAtPriceMinor)
    : 0;

  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span
        className={size === "lg" ? "text-2xl font-semibold" : "font-semibold"}
      >
        {formatMinorUnits(priceMinor, currency)}
      </span>
      {hasDiscount ? (
        <>
          <span className="text-sm text-muted-foreground line-through">
            {formatMinorUnits(compareAtPriceMinor, currency)}
          </span>
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
            -{discountPercent}%
          </span>
        </>
      ) : null}
    </div>
  );
}
