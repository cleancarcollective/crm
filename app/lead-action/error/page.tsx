const REASONS: Record<string, string> = {
  malformed: "The link is malformed. Try clicking it again from the original email.",
  bad_signature: "This link couldn't be verified. It may have been tampered with.",
  expired: "This link has expired. Please open the lead in the CRM and send the estimate from there.",
  consumed: "This link has already been used. Open the CRM to check the lead's current state.",
  mismatch: "The link doesn't match the lead. Try again or use the CRM directly.",
  not_found: "The lead couldn't be found.",
  no_email: "The contact doesn't have an email address on file.",
  no_draft: "No draft estimate is saved for this lead. Open the CRM to write one.",
  insert_failed: "We couldn't record the outbound email. Please try sending from the CRM.",
  send_failed: "Postmark refused the send. Open the lead in the CRM to see the error.",
  server_misconfigured: "The server is missing required configuration. Tell the dev.",
};

export default async function ErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message = (reason && REASONS[reason]) || "Something went wrong.";
  return (
    <main className="leadActionShell">
      <div className="leadActionCard leadActionCard--err">
        <div className="leadActionEmoji">⚠️</div>
        <h1>Couldn&apos;t send</h1>
        <p>{message}</p>
        <p className="leadActionFoot">
          <a href="/leads" className="textLink">Open the CRM</a> to handle it manually.
        </p>
      </div>
    </main>
  );
}
