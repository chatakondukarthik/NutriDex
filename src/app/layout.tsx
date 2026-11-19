import type { Metadata, Viewport } from "next";
import { Fraunces, Instrument_Sans, Space_Mono } from "next/font/google";
import RouteMotif from "@/components/route-motif";
import EmberField from "@/components/ember-field";
import { SpiceGlow } from "@/components/spice-glow";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { listPeople } from "@/lib/db/people";
import { getActivePerson } from "@/lib/person-server";
import { getThemeSettings } from "@/lib/theme-server";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--ff-display",
  axes: ["SOFT"],
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--ff-sans",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--ff-ledger",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NutriPlan",
  description: "Plan your meals. Know what is in them.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "NutriPlan",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F1E8" },
    { media: "(prefers-color-scheme: dark)", color: "#1C1510" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await getThemeSettings();
  const activePerson = await getActivePerson();
  const people = listPeople();

  return (
    <html
      lang="en"
      data-theme={theme.mode}
      data-accent={theme.accent}
      data-motion={theme.motion ? "on" : "off"}
      data-sound={theme.sound ? "on" : "off"}
      suppressHydrationWarning
      className={`${fraunces.variable} ${instrumentSans.variable} ${spaceMono.variable}`}
    >
      <body className="grain flex h-[100dvh] flex-col overflow-hidden text-ink antialiased">
        <EmberField />
        <SpiceGlow />
        <ServiceWorkerRegistrar />
        <ThemeProvider initial={theme}>
          <RouteMotif />
          <SiteHeader
            activePersonId={activePerson.id}
            people={people.map((person) => ({
              id: person.id,
              displayName: person.displayName,
            }))}
          />
          {/*
            The wrapper is the skip link's target: focusing it scrolls the
            browser to the content instead of the header, and tabbing then
            continues inside the page.
          */}
          <div id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col overflow-y-auto outline-none">{children}</div>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
