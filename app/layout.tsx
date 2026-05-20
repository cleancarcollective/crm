import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { NewBookingButton } from "@/components/dashboard/NewBookingButton";
import { LogoutButton } from "@/components/dashboard/LogoutButton";
import { ShopSwitcher } from "@/components/dashboard/ShopSwitcher";
import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
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
  // Customer-facing pages (lock-in-recurring, manage-booking, lead-action)
  // render WITHOUT the staff nav even when a staff user happens to be
  // logged in. Middleware sets x-customer-page=1 for those paths. Skipping
  // the nav avoids the mobile horizontal-overflow we hit on the lock-in
  // page where staff testers refresh and see a broken layout.
  const isCustomerPage = (await headers()).get("x-customer-page") === "1";
  if (isCustomerPage) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  const user = await getCurrentUser();

  if (!user) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  // For super-admins, load the full shop list so the switcher can render
  // every option without an extra round-trip from the client.
  let allShops: Array<{ slug: string; name: string }> = [];
  if (user.isSuperAdmin) {
    const supabase = getSupabaseAdminClient();
    const { data } = await supabase
      .from("shops")
      .select("slug, name")
      .order("slug");
    allShops = (data ?? []) as Array<{ slug: string; name: string }>;
  }

  return (
    <html lang="en">
      <body>
        <nav className="globalNav">
          <Link href="/" className="globalNavBrand">CCC CRM</Link>
          {user.isSuperAdmin ? (
            <ShopSwitcher activeSlug={user.shop.slug} shops={allShops} />
          ) : (
            <span className={`globalNavShopPill globalNavShopPill--${user.shop.slug}`}>
              {user.shop.name.replace("Clean Car Collective ", "") || user.shop.name}
            </span>
          )}
          <div className="globalNavLinks">
            <Link href="/" className="globalNavLink">Calendar</Link>
            <Link href="/leads" className="globalNavLink">Leads</Link>
            <Link href="/clients" className="globalNavLink">Clients</Link>
            {user.role === "admin" ? (
              <>
                <a href="/analytics" className="globalNavLink">Funnel</a>
                <a href="/settings" className="globalNavLink">Settings</a>
              </>
            ) : null}
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
