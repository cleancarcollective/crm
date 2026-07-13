import { redirect } from "next/navigation";

import { PortalDashboard } from "@/components/portal/PortalDashboard";
import { loadPortalSnapshot } from "@/lib/portal/data";
import { getPortalSession } from "@/lib/portal/session";

export const metadata = { title: "My account - Clean Car Collective" };

export default async function PortalHome() {
  const session = await getPortalSession();
  if (!session) redirect("/account/login" as never);

  const snapshot = await loadPortalSnapshot(session.email);
  if (!snapshot) {
    // Valid session but no contact rows (e.g. contact deleted). Send back
    // through login which will silently no-op for unknown emails.
    redirect("/account/login" as never);
  }

  return <PortalDashboard snapshot={snapshot} />;
}
