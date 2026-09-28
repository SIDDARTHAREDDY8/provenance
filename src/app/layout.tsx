import type { Metadata } from "next";
import { Rail } from "@/components/Rail";
import { repo } from "@/lib/repo";
import { DEMO_PERSON } from "@/lib/constants";
import "./globals.css";

export const metadata: Metadata = {
  title: "Contribution Graph",
  description:
    "Evidence-linked skills extraction and internal mobility, built from work artifacts instead of self-assessment.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [person, artifacts, profile] = await Promise.all([
    repo.person(DEMO_PERSON),
    repo.artifactsFor(DEMO_PERSON),
    repo.profile(DEMO_PERSON),
  ]);

  return (
    <html lang="en">
      <head>
        {/* Loaded by link rather than next/font so the project still builds and
            degrades to the fallback stack without network access. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="masthead">
          <div className="masthead-inner">
            <p className="wordmark">Contribution Graph</p>
            <span className="masthead-meta">Internal mobility · Payments</span>
            <span className="masthead-right">
              <span className="live-dot" aria-hidden="true" />
              {profile?.provider === "fixture" ? "Recorded extraction" : "Live extraction"}
            </span>
          </div>
        </header>
        <div className="frame">
          <Rail person={person} artifacts={artifacts} profile={profile} />
          <main className="sheet">{children}</main>
        </div>
      </body>
    </html>
  );
}
