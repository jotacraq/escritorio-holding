import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SCRIPT_TEMA_INICIAL } from "@/hooks/useTema";
import { ToastProvider } from "@/components/ui/Toast";

/* Fonte única: Neuetra, servida de `public/fonts/` via `@font-face` em
   `globals.css` (mesmos arquivos do seminário). As famílias IBM Plex que
   viviam aqui via `next/font/google` foram removidas na fundação V1 do
   design system — não eram mais a fonte ativa e custavam 3 downloads a mais
   por visita (e uma ida ao Google no build). */

export const metadata: Metadata = {
  title: "SIC-HF — Sistema de Inteligência para Conversão em Holding Familiar",
  description: "Esteira do cliente, briefing estratégico e croqui estrutural do escritório da Dra. Elaine Montenegro.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f1f0" },
    { media: "(prefers-color-scheme: dark)", color: "#111214" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_INICIAL }} />
      </head>
      <body className="flex h-full min-h-screen flex-col antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
