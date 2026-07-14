import { redirect } from "next/navigation";

import { UpsellApproval } from "@/components/portal/UpsellApproval";
import { getPortalSession } from "@/lib/portal/session";
import { getOfferForEmail } from "@/lib/upsells/data";

export const metadata = { title: "What we found - Clean Car Collective" };

export default async function UpsellPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getPortalSession();
  const { id } = await params;
  if (!session) redirect("/account/login" as never);

  const offer = await getOfferForEmail(id, session.email);
  if (!offer) redirect("/account" as never);

  return <UpsellApproval offer={offer} />;
}
