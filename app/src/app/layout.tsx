import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import "./globals.css";

const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-roboto-src" });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: APP_TAGLINE,
  // YouTube's image hosts refuse some cross-site referrers; avatars and thumbnails load without one.
  referrer: "no-referrer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${roboto.variable} h-full`} suppressHydrationWarning>
      <body className="h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
