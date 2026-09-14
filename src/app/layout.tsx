import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { SCRIPT_TEMA_INICIAL } from "@/hooks/useTema";
import { ToastProvider } from "@/components/ui/Toast";

/* Migração do design system para a paleta/tipografia do GPS-THB (14/09/2026).
   Neuetra (3 `@font-face` locais) sai; entram Inter (`--font-sans`, corpo) e
   Space Grotesk (`--font-display`, títulos e KPI numérico), via
   `next/font/google`, com `display:"swap"` para nunca bloquear o primeiro
   texto visível. Os `.woff2` da Neuetra continuam em `public/fonts/` até a
   aprovação do Marcio — remover o arquivo é commit separado, é o que
   permite reversão parcial sem depender deste commit. */
const fonteSans = Inter({
  subsets: ["latin"],
  variable: "--fonte-inter",
  display: "swap",
});
const fonteDisplay = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--fonte-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SIC-HF — Sistema de Inteligência para Conversão em Holding Familiar",
  description: "Esteira do cliente, briefing estratégico e croqui estrutural do escritório da Dra. Elaine Montenegro.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f6" },
    { media: "(prefers-color-scheme: dark)", color: "#14120f" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`h-full ${fonteSans.variable} ${fonteDisplay.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_INICIAL }} />
      </head>
      <body className="flex h-full min-h-screen flex-col antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
