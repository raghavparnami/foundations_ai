import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import BootKicker from "@/components/BootKicker";

export const metadata: Metadata = {
  title: "Loom",
  description: "Loom is to tables what Claude Code is to files.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <BootKicker />
        <div className="flex h-screen w-screen overflow-hidden">
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col bg-[var(--bg)]">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
