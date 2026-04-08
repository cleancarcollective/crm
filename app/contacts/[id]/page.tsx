import { notFound } from "next/navigation";

import { ContactProfile } from "@/components/dashboard/ContactProfile";
import { getContactProfileById } from "@/lib/dashboard/contacts";

export default async function ContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getContactProfileById(id);

  if (!profile) {
    notFound();
  }

  return <ContactProfile profile={profile} />;
}
