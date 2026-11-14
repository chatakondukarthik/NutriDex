import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NutriPlan",
  description: "Plan your meals. Know what is in them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#faf9f7] text-[#14161a] antialiased">
        {children}
      </body>
    </html>
  );
}
