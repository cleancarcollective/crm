"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ImportExportBarProps = {
  mode: "leads" | "clients";
  exportParams?: string; // query string to pass to export (e.g. "?status=won&q=search")
};

export function ImportExportBar({ mode, exportParams = "" }: ImportExportBarProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function handleExport() {
    const url = `/api/${mode}/export${exportParams}`;
    window.location.href = url;
  }

  function handleImportClick() {
    fileRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage("");
    setError("");

    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/${mode}/import`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setMessage(`Imported ${data.imported ?? 0} records.`);
        router.refresh();
      } else {
        setError(data.error ?? "Import failed.");
      }

      // Reset file input
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <div className="importExportBar">
      <button type="button" className="buttonGhost importExportBtn" onClick={handleExport}>
        Export CSV
      </button>
      <button type="button" className="buttonGhost importExportBtn" onClick={handleImportClick} disabled={isPending}>
        {isPending ? "Importing…" : "Import CSV / XLSX"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      {message ? <span className="importExportMsg">{message}</span> : null}
      {error ? <span className="importExportError">{error}</span> : null}
    </div>
  );
}
