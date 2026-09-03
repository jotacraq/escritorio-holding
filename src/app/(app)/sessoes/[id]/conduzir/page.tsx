"use client";

import { use } from "react";
import { ConduzirSessaoApp } from "@/components/sessao/ConduzirSessaoApp";

/** `id` é o id da JORNADA (não o da sessão) — mesmo parâmetro de `/jornadas/[id]`.
 * A Ficha 360 (`GET /api/jornadas/[id]`, já existente) é a única rota que junta
 * pessoa + sessão numa consulta só; a partir dela a tela resolve o id real de
 * `sessoes_viabilidade` para chamar `/api/sessoes/[id]/sims`. */
export default function PaginaConduzirSessao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ConduzirSessaoApp jornadaId={id} />;
}
