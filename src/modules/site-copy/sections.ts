export const SITE_COPY_SECTIONS = [
  {
    namespace: "site",
    label: "Site",
    title: "Site identity",
    description:
      "Manage the site name, default metadata and social sharing copy.",
  },
  {
    namespace: "chrome",
    label: "Navigation",
    title: "Navigation and footer",
    description: "Edit shared navigation, mobile menu and footer copy.",
  },
  {
    namespace: "home",
    label: "Homepage",
    title: "Homepage",
    description:
      "Manage the storefront landing page messaging and calls to action.",
  },
  {
    namespace: "services",
    label: "Services",
    title: "Consultation and installation",
    description:
      "Edit the consultation and installation pages, forms and confirmations.",
  },
  {
    namespace: "catalog",
    label: "Catalog",
    title: "Catalog",
    description: "Manage product discovery, filters and product-detail copy.",
  },
  {
    namespace: "commerce",
    label: "Commerce",
    title: "Cart and checkout",
    description:
      "Edit cart, checkout, payment and order-related customer copy.",
  },
  {
    namespace: "auth",
    label: "Authentication",
    title: "Authentication",
    description: "Manage sign-in, registration and account-recovery copy.",
  },
  {
    namespace: "account",
    label: "Account",
    title: "Customer account",
    description:
      "Edit profile, order history and service-request account copy.",
  },
  {
    namespace: "email",
    label: "Email",
    title: "Email and notifications",
    description: "Manage customer email, SMS and notification wording.",
  },
  {
    namespace: "system",
    label: "System",
    title: "System messages",
    description: "Edit shared error and recovery messages.",
  },
] as const;

export type SiteCopyNamespace =
  (typeof SITE_COPY_SECTIONS)[number]["namespace"];

export function findSiteCopySection(namespace: string) {
  return SITE_COPY_SECTIONS.find((section) => section.namespace === namespace);
}
