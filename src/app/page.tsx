import ChatPanel from "@/components/ChatPanel";
import ReadinessPill from "@/components/ReadinessPill";
import RunInsights from "@/components/RunInsights";

export default function Page() {
  return (
    <main className="flex flex-col flex-1 min-h-0 bg-[var(--bg)]">
      <header className="px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex-1" />
        <div className="flex items-center gap-4">
          <RunInsights />
          <div className="h-4 w-px bg-[var(--border)]" />
          <ReadinessPill />
        </div>
      </header>
      <ChatPanel />
    </main>
  );
}
