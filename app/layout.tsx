import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handoff — human + agent, same board",
  description:
    "A project board built for humans and AI agents working together: agents act through MCP tools, humans approve the risky ones.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full">{children}</body>
    </html>
  );
}
