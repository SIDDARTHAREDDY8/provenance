import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Provenance",
  description:
    "An agentic runtime that verifies résumé claims against an evidence pack before anyone is scored.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* By <link> rather than next/font: the project still builds and degrades
            to the fallback stack with no network access. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="border-b border-rule bg-sheet sticky top-0 z-10">
          <div className="mx-auto flex h-13 max-w-[1180px] items-center gap-5 px-6 py-3">
            <p className="font-serif text-[18px] font-medium tracking-[-0.015em] m-0">Provenance</p>
            <span className="eyebrow hidden border-l border-rule pl-5 sm:block">
              Verified hiring runtime
            </span>
            <Nav />
          </div>
        </header>
        <main className="mx-auto max-w-[1180px] px-6 pb-24 pt-7 stagger">{children}</main>
      </body>
    </html>
  );
}
