import type {
  CatalogSpecification,
  CatalogVariant,
} from "@/src/modules/catalog/types";

/** One row of the typed solar/logistics facet columns already on
 * `ProductVariant` (docs/PHASE_9_STOREFRONT_PLAN.md §4/§10) — never a
 * second solar-specification model; this is purely a display mapping
 * over the columns the catalog module already returns. */
const FACET_ROWS: {
  key: keyof CatalogVariant;
  label: string;
  unit?: string;
}[] = [
  { key: "powerRatingW", label: "Power rating", unit: "W" },
  { key: "voltageV", label: "Voltage", unit: "V" },
  { key: "capacityWh", label: "Capacity", unit: "Wh" },
  { key: "ratedCurrentA", label: "Rated current", unit: "A" },
  { key: "phase", label: "Phase" },
  { key: "efficiencyPercent", label: "Efficiency", unit: "%" },
  { key: "mpptMinV", label: "MPPT min voltage", unit: "V" },
  { key: "mpptMaxV", label: "MPPT max voltage", unit: "V" },
  { key: "weightKg", label: "Weight", unit: "kg" },
  { key: "lengthCm", label: "Length", unit: "cm" },
  { key: "widthCm", label: "Width", unit: "cm" },
  { key: "heightCm", label: "Height", unit: "cm" },
];

export function SpecTable({
  variant,
  specifications,
}: {
  variant: CatalogVariant;
  specifications: CatalogSpecification[];
}) {
  const facetRows = FACET_ROWS.filter((row) => variant[row.key] !== null);

  const groups = new Map<string, CatalogSpecification[]>();
  for (const spec of specifications) {
    const group = spec.groupLabel ?? "Other specifications";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(spec);
  }

  if (facetRows.length === 0 && specifications.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      {facetRows.length > 0 ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold">
            Technical specifications
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {facetRows.map((row) => (
              <div key={row.key}>
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="font-medium">
                  {String(variant[row.key])}
                  {row.unit ? ` ${row.unit}` : ""}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {Array.from(groups.entries()).map(([groupLabel, specs]) => (
        <div key={groupLabel}>
          <h2 className="mb-2 text-sm font-semibold">{groupLabel}</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {specs.map((spec) => (
              <div key={spec.specKey}>
                <dt className="text-muted-foreground">
                  {spec.specKey.replace(/_/g, " ")}
                </dt>
                <dd className="font-medium">
                  {spec.specValue}
                  {spec.unit ? ` ${spec.unit}` : ""}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
