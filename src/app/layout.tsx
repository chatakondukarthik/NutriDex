import type { Metadata } from "next";
import { PageTransition } from "@/components/page-transition";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { listPeople } from "@/lib/db/people";
import { getActivePerson } from "@/lib/person-server";
import { getThemeSettings } from "@/lib/theme-server";
import "./globals.css";

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
      suppressHydrationWarning
    >
      <body className="min-h-screen text-ink antialiased">
        <ThemeProvider initial={theme}>
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
          <div id="main-content" tabIndex={-1} className="outline-none">
            <PageTransition>{children}</PageTransition>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
