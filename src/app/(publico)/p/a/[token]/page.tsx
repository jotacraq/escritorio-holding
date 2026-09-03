"use client";

import { use } from "react";
import { AgendamentoPublico } from "@/components/publico/AgendamentoPublico";

/** `/p/a/[token]` — escolha de horário da Sessão de Viabilidade. */
export default function PaginaAgendamentoPublico({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <AgendamentoPublico token={token} />;
}
