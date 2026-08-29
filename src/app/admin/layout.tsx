import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import AdminNav from "./AdminNav";
import styles from "./admin.module.css";

export const metadata: Metadata = {
  title: "Painel",
  manifest: "/admin-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Ofertano Admin",
    statusBarStyle: "default",
  },
};

export default function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/admin" className={styles.brand}>
            <span className={styles.brandName}>Ofertano</span>
            <span className={styles.brandHint}>Painel administrativo</span>
          </Link>

          <AdminNav />

          <Link href="/" className={styles.siteLink}>
            Ver site
          </Link>
        </div>
      </header>

      <div className={styles.content}>{children}</div>
    </div>
  );
}
