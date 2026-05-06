export default function SentPage() {
  return (
    <main className="leadActionShell">
      <div className="leadActionCard leadActionCard--ok">
        <div className="leadActionEmoji">✅</div>
        <h1>Estimate sent</h1>
        <p>The customer should have it in their inbox in a moment. Lead is now marked as <code>sent</code>, follow-ups scheduled at +3 / +5 / +7 / +30 days.</p>
        <p className="leadActionFoot">You can close this tab.</p>
      </div>
    </main>
  );
}
