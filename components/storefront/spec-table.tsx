"use client";

import type {
  CatalogSpecification,
  CatalogVariant,
} from "@/src/modules/catalog/types";
import { useSiteCopy } from "@/components/storefront/site-copy-provider";

/** One row of the typed solar/logistics facet columns already on
 * `ProductVariant` (docs/PHASE_9_STOREFRONT_PLAN.md §4/§10) — never a
 * second solar-specification model; this is purely a display mapping
 * over the columns the catalog module already returns. */
export function SpecTable({
  variant,
  specifications,
}: {
  variant: CatalogVariant;
  specifications: CatalogSpecification[];
}) {
  const copy = useSiteCopy();
  const facetDefinitions: {
    key: keyof CatalogVariant;
    label: string;
    unit?: string;
  }[] = [
    {
      key: "powerRatingW",
      label: copy("catalog.specs.powerRating"),
      unit: "W",
    },
    { key: "voltageV", label: copy("catalog.specs.voltage"), unit: "V" },
    { key: "capacityWh", label: copy("catalog.specs.capacity"), unit: "Wh" },
    { key: "ratedCurrentA", label: copy("catalog.specs.current"), unit: "A" },
    { key: "phase", label: copy("catalog.specs.phase") },
    {
      key: "efficiencyPercent",
      label: copy("catalog.specs.efficiency"),
      unit: "%",
    },
    { key: "mpptMinV", label: copy("catalog.specs.mpptMin"), unit: "V" },
    { key: "mpptMaxV", label: copy("catalog.specs.mpptMax"), unit: "V" },
    { key: "weightKg", label: copy("catalog.specs.weight"), unit: "kg" },
    { key: "lengthCm", label: copy("catalog.specs.length"), unit: "cm" },
    { key: "widthCm", label: copy("catalog.specs.width"), unit: "cm" },
    { key: "heightCm", label: copy("catalog.specs.height"), unit: "cm" },
  ];
  const facetRows = facetDefinitions.filter((row) => variant[row.key] !== null);

  const groups = new Map<string, CatalogSpecification[]>();
  for (const spec of specifications) {
    const group = spec.groupLabel ?? copy("catalog.specs.other");
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
            {copy("catalog.specs.technical")}
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
