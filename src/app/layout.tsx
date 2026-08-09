import type { Metadata, Viewport } from "next";
import { Poppins, Righteous } from "next/font/google";
import { TRPCReactProvider } from "~/trpc/react";
import "./globals.css";

const display = Righteous({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const body = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nutrition",
  description: "Personal macro planning, meal scheduling and grocery lists.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh">
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
