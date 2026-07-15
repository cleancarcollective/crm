import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { GlobalNavLinks } from "@/components/dashboard/GlobalNavLinks";
import { GlobalSearch } from "@/components/dashboard/GlobalSearch";
import { NewBookingButton } from "@/components/dashboard/NewBookingButton";
import { LogoutButton } from "@/components/dashboard/LogoutButton";
import { ShopSwitcher } from "@/components/dashboard/ShopSwitcher";
import { getCurrentUser } from "@/lib/auth/currentShop";
import { gateRouteForRole } from "@/lib/auth/roles";
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
  const hdrs = await headers();
  const isCustomerPage = hdrs.get("x-customer-page") === "1";
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

  // Role-based path gating for sales users. The pathname is forwarded as a
  // request header by middleware.ts. If a sales user has landed somewhere
  // they shouldn't, redirect them to /sales before rendering.
  const pathname = hdrs.get("x-pathname") ?? "";
  const gateRedirect = gateRouteForRole(user, pathname);
  if (gateRedirect && pathname !== gateRedirect) {
    // Cast to bypass typedRoutes - gateRouteForRole's runtime return values
    // are always real app routes (/sales, /), but the function returns a
    // generic string for flexibility.
    redirect(gateRedirect as unknown as Parameters<typeof redirect>[0]);
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

  const navItems = [
    { href: "/", label: "Calendar" },
    { href: "/leads", label: "Leads" },
    { href: "/clients", label: "Clients" },
    ...(user.role === "sales" || user.role === "admin"
      ? [
          { href: "/sales", label: "Cold leads" },
          { href: "/sales/services", label: "Services" },
          { href: "/sales/selling-guide", label: "Selling guide" },
          { href: "/sales/script", label: "Script" },
          { href: "/sales/objections", label: "Objections" },
        ]
      : []),
    ...(user.role === "admin"
      ? [
          { href: "/analytics", label: "Funnel" },
          { href: "/collective", label: "Collective" },
          { href: "/journey", label: "Journey" },
          { href: "/settings", label: "Settings" },
        ]
      : []),
  ];

  return (
    <html lang="en">
      <body className="hasGlobalNav">
        <nav className="globalNav">
          <Link href="/" className="globalNavBrand">CCC CRM</Link>
          {user.isSuperAdmin ? (
            <ShopSwitcher activeSlug={user.shop.slug} shops={allShops} />
          ) : (
            <span className={`globalNavShopPill globalNavShopPill--${user.shop.slug}`}>
              {user.shop.name.replace("Clean Car Collective ", "") || user.shop.name}
            </span>
          )}
          <GlobalNavLinks items={navItems} />
          <div className="globalNavRight">
            <GlobalSearch />
            <NewBookingButton
              className="buttonPrimary globalNavCta"
              label={
                <>
                  <span className="ctaFull">+ New Booking</span>
                  <span className="ctaShort">+ Book</span>
                </>
              }
            />
            <span className="globalNavUser">{user.name}</span>
            <LogoutButton />
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
