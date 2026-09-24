import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toast";
import { env } from "@/lib/env";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getSiteCopy();
  const c = (key: string) => copyValue(copy, key);
  const siteName = c("site.name");
  const title = c("site.title");
  const description = c("site.description");
  return {
    metadataBase: new URL(env.APP_BASE_URL),
    applicationName: siteName,
    title: {
      default: title,
      template: `%s | ${siteName}`,
    },
    description,
    keywords: c("site.keywords")
      .split("\n")
      .map((keyword) => keyword.trim())
      .filter(Boolean),
    authors: [{ name: siteName, url: "/" }],
    creator: siteName,
    publisher: siteName,
    category: c("site.category"),
    referrer: "origin-when-cross-origin",
    alternates: { canonical: "/" },
    appleWebApp: {
      capable: true,
      title: siteName,
      statusBarStyle: "default",
    },
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    openGraph: {
      type: "website",
      locale: c("site.locale"),
      url: "/",
      siteName,
      title,
      description,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: c("site.openGraphAlt"),
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image"],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
  };
}

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f5" },
    { media: "(prefers-color-scheme: dark)", color: "#15130f" },
  ],
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
export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
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
