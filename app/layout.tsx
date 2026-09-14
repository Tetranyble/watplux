import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toast";
import { siteConfig } from "@/lib/site-config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
};

/**
 * The TRUE root — `<html>`/`<body>`, fonts, global metadata, and
 * `<Toaster>` (shared by every route, storefront and admin alike). The
 * storefront's own header/footer chrome deliberately does NOT live here
 * anymore (docs/PHASE_10_ADMIN_PLAN.md §5) — it moved to
 * `app/(storefront)/layout.tsx` once `/admin/**` needed a sibling route
 * tree with entirely different chrome. Route groups don't affect URLs
 * (`(storefront)` never appears in a path), so every existing storefront
 * URL is unchanged; only the physical file location and which layout
 * wraps it changed.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
