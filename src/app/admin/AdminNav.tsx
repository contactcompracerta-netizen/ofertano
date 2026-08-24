"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./admin.module.css";

const NAV_ITEMS = [
  { href: "/admin", label: "Início" },
  { href: "/admin/inteligencia", label: "Inteligência" },
  { href: "/admin/oportunidades", label: "Oportunidades" },
  { href: "/admin/fila", label: "Fila" },
  { href: "/admin/links-afiliados", label: "Afiliados" },
  { href: "/admin/integracoes", label: "Integrações" },
  { href: "/admin/blog", label: "Blog" },
] as const;

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav} aria-label="Administração">
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname === item.href ||
              pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              active ? styles.navLinkActive : styles.navLink
            }
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
