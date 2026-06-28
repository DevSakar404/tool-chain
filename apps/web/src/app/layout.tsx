import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tool-Chain — Resume Parser",
  description: "Chain-driven agent: Google Drive file → extracted text → structured ResumeDTO",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  );
}
