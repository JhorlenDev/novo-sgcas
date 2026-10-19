import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SGCAS",
  description: "Sistema de Gestao de Casos da Assistencia Social",
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
