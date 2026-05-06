export default async function AlreadyPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const label = status ?? "actioned";
  return (
    <main className="leadActionShell">
      <div className="leadActionCard leadActionCard--info">
        <div className="leadActionEmoji">ℹ️</div>
        <h1>Already actioned</h1>
        <p>This lead is already in the <code>{label}</code> state — the estimate was either sent earlier or the lead was won/lost. Nothing to do.</p>
        <p className="leadActionFoot">You can close this tab.</p>
      </div>
    </main>
  );
}
