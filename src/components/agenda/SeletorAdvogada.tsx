"use client";

import { useEffect, useState } from "react";
import { listarEquipe, type MembroEquipe } from "@/lib/api";
import { Campo, Selecao } from "@/components/ui/Campo";

/**
 * Quem tem agenda de disponibilidade. Filtra por papel `advogada` (é quem
 * conduz a Sessão de Viabilidade) — se por algum motivo não houver ninguém
 * com esse papel ainda (escritório em configuração), cai para a lista
 * inteira de ativos em vez de mostrar uma tela vazia sem explicação.
 */
export function useMembrosComAgenda() {
  const [membros, setMembros] = useState<MembroEquipe[] | null>(null);

  useEffect(() => {
    let vivo = true;
    listarEquipe()
      .then((resposta) => {
        if (!vivo) return;
        const todos = resposta?.itens ?? [];
        const advogadas = todos.filter((m) => m.papel === "advogada");
        setMembros(advogadas.length > 0 ? advogadas : todos);
      })
      .catch(() => {
        if (vivo) setMembros([]);
      });
    return () => {
      vivo = false;
    };
  }, []);

  return membros;
}

export function SeletorAdvogada({
  membros,
  valor,
  aoMudar,
  id = "advogada-id",
}: {
  membros: MembroEquipe[];
  valor: string;
  aoMudar: (id: string) => void;
  id?: string;
}) {
  return (
    <Campo rotulo="Advogada" id={id} ajuda="De quem é esta agenda." className="max-w-sm">
      <Selecao value={valor} onChange={(e) => aoMudar(e.target.value)}>
        <option value="">Selecione…</option>
        {membros.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nome}
          </option>
        ))}
      </Selecao>
    </Campo>
  );
}
