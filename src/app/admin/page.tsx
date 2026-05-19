import AdminCatalog from "@/components/AdminCatalog";

export default function AdminPage() {
  return (
    <main className="flex flex-col flex-1 min-h-0">
      <header className="px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-elev)]">
        <h1 className="text-sm font-semibold">Catalog</h1>
        <p className="text-[11px] text-[var(--text-muted)] -mt-0.5">
          tables, generated docs, proposals, and live activity
        </p>
      </header>
      <div className="flex-1 min-h-0">
        <AdminCatalog />
      </div>
    </main>
  );
}
