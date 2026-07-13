import { redirect } from "next/navigation";

import { PortalLoginClient } from "@/components/portal/PortalLoginClient";
import { getPortalSession } from "@/lib/portal/session";

export const metadata = { title: "Sign in - Clean Car Collective" };

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getPortalSession();
  if (session) redirect("/account" as never);

  const { error } = await searchParams;
  return <PortalLoginClient linkError={error ?? null} />;
}
