"use client";

import { useCallback, useEffect, useState } from "react";
import { normalizarPainel, type PainelDiaNormalizado } from "@/types/painel-ui";

/**
 * Acesso a `GET /api/painel`, isolado de `src/lib/api.ts` de propósito —
 * aquele arquivo é fronteira de outro agente. Sem polling (CLAUDE.md /
 * ARQUITETURA-FASE-2 §8 Escalabilidade): a tela só busca de novo sob ação
 * do usuário (montagem + botão "Atualizar").
 */

export type EstadoCargaPainel =
  | { fase: "carregando" }
  | { fase: "erro"; mensagem: string }
  | { fase: "pronto"; dados: PainelDiaNormalizado };

function mensagemDeErro(status: number): string {
  if (status === 404 || status === 501) {
    return "A rota do painel ainda não está no ar. Assim que existir, esta tela passa a mostrar a fila real.";
  }
  if (status === 401 || status === 403) {
    return "Sem permissão para ver o painel com esta sessão.";
  }
  if (status === 0) {
    return "Sem conexão com o servidor. Verifique a rede e tente de novo.";
  }
  return `Não foi possível carregar o painel agora (${status}).`;
}

export function usarPainelDia() {
  const [estado, setEstado] = useState<EstadoCargaPainel>({ fase: "carregando" });

  const carregar = useCallback(() => {
    setEstado({ fase: "carregando" });
    let cancelado = false;

    (async () => {
      let resposta: Response;
      try {
        resposta = await fetch("/api/painel", { credentials: "include" });
      } catch {
        if (!cancelado) setEstado({ fase: "erro", mensagem: mensagemDeErro(0) });
        return;
      }

      if (!resposta.ok) {
        if (!cancelado) setEstado({ fase: "erro", mensagem: mensagemDeErro(resposta.status) });
        return;
      }

      let corpo: unknown = null;
      try {
        corpo = await resposta.json();
      } catch {
        corpo = null;
      }

      // Resposta 200 sem corpo utilizável é falha de contrato, não painel vazio.
      if (!corpo || typeof corpo !== "object") {
        if (!cancelado) setEstado({ fase: "erro", mensagem: "O servidor respondeu, mas o painel veio em um formato inesperado." });
        return;
      }

      if (!cancelado) setEstado({ fase: "pronto", dados: normalizarPainel(corpo) });
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => carregar(), [carregar]);

  return { estado, recarregar: carregar };
}
