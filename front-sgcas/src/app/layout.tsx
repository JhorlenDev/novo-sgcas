import type { Metadata, Viewport } from "next";
import { Public_Sans } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

// Fonte de linhas retas e boa leitura em tamanho pequeno, feita para serviços públicos.
const publicSans = Public_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "SGCAS", template: "%s · SGCAS" },
  description: "Sistema de Gestão de Casos da Assistência Social",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#155399",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={publicSans.variable} suppressHydrationWarning>
      <body suppressHydrationWarning className={publicSans.className}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
