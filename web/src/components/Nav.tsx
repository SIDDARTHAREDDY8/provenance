"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Queue" },
  { href: "/compliance", label: "Compliance" },
  { href: "/corrections", label: "Corrections" },
  { href: "/audit", label: "Audit" },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="ml-auto flex gap-1" aria-label="Sections">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            data-active={active}
            className="rounded-[3px] px-2.5 py-1 text-[13px] text-ink-2 no-underline transition-colors hover:bg-sheet-2 hover:text-ink data-[active=true]:bg-prussian-tint data-[active=true]:font-medium data-[active=true]:text-prussian"
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
