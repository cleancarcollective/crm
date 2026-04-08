import Link from "next/link";

type ContactNameLinkProps = {
  contactId: string | null;
  name: string;
  className?: string;
};

export function ContactNameLink({ contactId, name, className }: ContactNameLinkProps) {
  if (!contactId) {
    return <span className={className}>{name}</span>;
  }

  return (
    <Link href={`/contacts/${contactId}`} className={className}>
      {name}
    </Link>
  );
}
