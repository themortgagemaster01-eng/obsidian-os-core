import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Obsidian OS",
  description: "The AI Agency Operating System — mission control for autonomous agency operations.",
};

/**
 * Every route in this app is session-dependent (Supabase Auth via cookies,
 * checked in middleware and in Server Components). Forcing the whole app
 * dynamic at the root layout stops Next.js from attempting to statically
 * prerender any page at build time — which would otherwise try to construct
 * a Supabase server client with no request context (and, in an environment
 * with no live Supabase project configured yet, no env vars either) and
 * fail the build. There is no meaningful static content in this app to
 * lose by doing this.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
