import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kursus Bahasa Mandarin SHHS · 新中汉语补习学校",
  description: "Sistem manajemen sekolah · 学校管理系统",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}
