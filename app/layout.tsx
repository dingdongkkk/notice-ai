import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import "./design.css";

// Body text uses a typeface designed for readers with low vision. Kannada and
// Devanagari fall back to the device's own fonts.
const body = Atkinson_Hyperlegible({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Notice → Action",
  description:
    "Know what a public notice means for your household, what changed, and what to do next, with proof.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f3ec" },
    { media: "(prefers-color-scheme: dark)", color: "#f5f3ec" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
