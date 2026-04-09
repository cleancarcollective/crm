import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { NewBookingButton } from "@/components/dashboard/NewBookingButton";
import { LogoutButton } from "@/components/dashboard/LogoutButton";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Clean Car Collective CRM",
  description: "Internal CRM booking intake"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = sessionId ? await verifySession(sessionId) : null;

  // Login page renders without the nav shell
  // (middleware handles redirect for non-login pages with no session)
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
