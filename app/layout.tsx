import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { NewBookingButton } from "@/components/dashboard/NewBookingButton";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Clean Car Collective CRM",
  description: "Internal CRM booking intake"
};

export default function RootLayout({ children }: { children: ReactNode }) {
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
          <NewBookingButton className="buttonPrimary globalNavCta" />
        </nav>
        {children}
      </body>
    </html>
  );
}
