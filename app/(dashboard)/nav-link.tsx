"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={`focus-ring block rounded-md px-3 py-2 text-sm transition ${
        active ? "bg-accentSoft font-medium text-accent" : "text-ink/70 hover:bg-line/50"
      }`}
    >
      {label}
    </Link>
  );
}
