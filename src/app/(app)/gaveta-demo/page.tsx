import { notFound } from "next/navigation";
import { GavetaDemo } from "./GavetaDemo";

export const metadata = { title: "Demonstração — Gaveta · SIC-HF" };

/**
 * Página de desenvolvimento (prova de conceito da `Gaveta`, Fase 3). Não
 * existe em produção: fora de `next dev`, responde `notFound()` — o
 * `not-found.tsx` de `(app)` cuida da tela. Não está na navegação nem na
 * paleta de comandos; só quem digita a URL chega aqui.
 */
export default function PaginaGavetaDemo() {
  if (process.env.NODE_ENV === "production") notFound();
  return <GavetaDemo />;
}
