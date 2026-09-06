import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Recuperar senha",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RecuperarSenhaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}