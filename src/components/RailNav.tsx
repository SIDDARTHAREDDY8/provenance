"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Evidence" },
  { href: "/paths", label: "Role fit" },
  { href: "/mentor", label: "Action queue" },
  { href: "/org", label: "Org aggregate" },
  { href: "/audit", label: "Audit log" },
] as const;

export function RailNav() {
  const pathname = usePathname();
  return (
    <nav className="rail-nav" aria-label="Sections">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} data-active={pathname === l.href}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
