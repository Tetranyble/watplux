/**
 * Static brand configuration that is safe to render publicly. Contact details
 * remain optional until the business supplies production values; the UI never
 * invents a phone number or inbox. Service CTAs now use the real Phase 12
 * request workflow rather than mailto placeholders.
 */
export const siteConfig = {
  name: "Watplux",
  title: "Watplux | Reliable solar power solutions",
  description:
    "Solar power equipment, system planning and installation services.",
  locale: "en_NG",
  keywords: [
    "solar power Nigeria",
    "solar panels",
    "solar inverters",
    "solar batteries",
    "solar installation",
    "backup power",
  ],
  supportEmail: null as string | null,
  supportPhone: null as string | null,
} as const;

export const consultationCtaHref = "/consultation";
export const installationCtaHref = "/installation";
