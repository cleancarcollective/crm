import Link from "next/link";
import { cookies } from "next/headers";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { NewBookingButton } from "@/components/dashboard/NewBookingButton";
import { LogoutButton } from "@/components/dashboard/LogoutButton";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Clean Car Collective CRM",
  description: "Internal CRM for Clean Car Collective staff",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "CCC CRM",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: [
      { url: "/icons/apple-touch-icon-180.png", sizes: "180x180" },
      { url: "/icons/apple-touch-icon-167.png", sizes: "167x167" },
      { url: "/icons/apple-touch-icon-152.png", sizes: "152x152" },
      { url: "/icons/apple-touch-icon-120.png", sizes: "120x120" },
    ],
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#1a1713",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = sessionId ? await verifySession(sessionId) : null;

  if (!user) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body>
        <nav className="globalNav">
          <Link href="/" className="globalNavBrand">
            CCC CRM
          </Link>
          <div className="globalNavLinks">
            <Link href="/" className="globalNavLink">Calendar</Link>
            <Link href="/leads" className="globalNavLink">Leads</Link>
            <Link href="/clients" className="globalNavLink">Clients</Link>
            <a href="/settings" className="globalNavLink">Settings</a>
          </div>
          <div className="globalNavRight">
            <NewBookingButton className="buttonPrimary globalNavCta" />
            <span className="globalNavUser">{user.name}</span>
            <LogoutButton />
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
