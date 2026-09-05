import { notFound } from "next/navigation";
import { GaleriaGraficos } from "./GaleriaGraficos";

export const metadata = { title: "Galeria de gráficos · SIC-HF" };

/**
 * Galeria de desenvolvimento da biblioteca de gráficos do Croqui (Fase 3,
 * §3.5) — TODO DADO É FICTÍCIO ("Família Exemplo"). Não existe em produção:
 * fora de `next dev`, responde `notFound()`. Mantida no repositório porque
 * é a bancada visual de quem mexe em `components/graficos/**`.
 */
export default function PaginaGraficosDemo() {
  if (process.env.NODE_ENV === "production") notFound();
  return <GaleriaGraficos />;
}
