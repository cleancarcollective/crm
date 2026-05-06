import Link from "next/link";

import { ChangePasswordForm } from "@/components/dashboard/ChangePasswordForm";
import { requireCurrentShop, getCurrentUser } from "@/lib/auth/currentShop";

export default async function AccountPage() {
  const shop = await requireCurrentShop();
  const user = await getCurrentUser();
  if (!user) {
    return <main className="pageShell"><p>Not signed in.</p></main>;
  }

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">
            <Link href="/settings" className="eyebrowLink">← Back to Settings</Link>
          </p>
          <h1 className="pageTitle">Your account</h1>
          <p className="detailSubtitle">{shop.name}</p>
        </div>
      </div>

      <section className="detailPanel settingsSection">
        <h2>Profile</h2>
        <dl className="accountInfoGrid">
          <dt>Name</dt>
          <dd>{user.name}</dd>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Shop</dt>
          <dd>{shop.name}</dd>
        </dl>
      </section>

      <section className="detailPanel settingsSection">
        <h2>Change password</h2>
        <p className="settingsDescription">
          Use a password that&apos;s at least 8 characters. You&apos;ll stay signed in
          on this device after the change.
        </p>
        <ChangePasswordForm />
      </section>
    </main>
  );
}
