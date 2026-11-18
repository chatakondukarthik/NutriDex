import type { Metadata } from "next";
import { Fraunces, Instrument_Sans, Space_Mono } from "next/font/google";
import RouteMotif from "@/components/route-motif";
import EmberField from "@/components/ember-field";
import { SpiceGlow } from "@/components/spice-glow";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
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
      <body className="grain flex min-h-screen flex-col text-ink antialiased">
        <EmberField />
        <SpiceGlow />
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
          <div id="main-content" tabIndex={-1} className="flex-1 outline-none">{children}</div>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
