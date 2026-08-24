import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AnalyticsBootstrap from "@/components/analytics/AnalyticsBootstrap";
import FavoritesBootstrap from "@/components/FavoritesBootstrap";
import SearchNavigationLoading from "@/components/search/SearchNavigationLoading";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://ofertano.vercel.app"),

  title: {
    default: "Ofertano | Compare preços antes de comprar",
    template: "%s | Ofertano",
  },

  description:
    "Compare preços, encontre ofertas e compre diretamente em lojas parceiras como Mercado Livre, Amazon e Shopee.",

  applicationName: "Ofertano",

  keywords: [
    "Ofertano",
    "comparador de preços",
    "comparar preços",
    "ofertas",
    "promoções",
    "Mercado Livre",
    "Amazon",
    "Shopee",
    "compras online",
  ],

  authors: [
    {
      name: "Ofertano",
    },
  ],

  creator: "Ofertano",
  publisher: "Ofertano",
  category: "shopping",

  alternates: {
    canonical: "/",
  },

  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "/",
    siteName: "Ofertano",
    title: "Ofertano | Compare preços antes de comprar",
    description:
      "Compare preços, encontre ofertas e compre diretamente nas lojas parceiras.",
  },

  twitter: {
    card: "summary_large_image",
    title: "Ofertano | Compare preços antes de comprar",
    description:
      "Compare preços, encontre ofertas e compre diretamente nas lojas parceiras.",
  },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },

  icons: {
    icon: [
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    shortcut: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-slate-50 text-gray-900">
        <AnalyticsBootstrap />
        <FavoritesBootstrap />
        <SearchNavigationLoading />
        {children}
      </body>
    </html>
  );
}
