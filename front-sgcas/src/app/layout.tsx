import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

// Tipografia do design local, compartilhada por todas as telas.
const nunito = Nunito({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "SGCAS", template: "%s · SGCAS" },
  description: "Sistema de Gestão de Casos da Assistência Social",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0064E0",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={nunito.variable} suppressHydrationWarning>
      <body suppressHydrationWarning className={nunito.className}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
