/**
 * Static brand configuration that is safe to render publicly. Contact details
 * remain optional until the business supplies production values; the UI never
 * invents a phone number or inbox. Service CTAs now use the real Phase 12
 * request workflow rather than mailto placeholders.
 */
export const siteConfig = {
  name: "Watplux",
  description:
    "Solar power equipment, system planning and installation services.",
  supportEmail: null as string | null,
  supportPhone: null as string | null,
} as const;

export const consultationCtaHref = "/consultation";
export const installationCtaHref = "/installation";
