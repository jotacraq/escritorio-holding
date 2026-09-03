"use client";

import { useRecurso } from "@/hooks/useRecurso";
import { ApiError } from "@/lib/api";
import { normalizarPainel, type PainelDiaNormalizado } from "@/types/painel-ui";

/**
 * `GET /api/painel`, isolado de `src/lib/api.ts` de propósito — aquele
 * arquivo é fronteira de outro agente e a rota está sendo escrita em
 * paralelo (ARQUITETURA-FASE-2 §4.6/§5, B-1B). `ApiError` é só importado
 * (não editado) para reaproveitar o mesmo tratamento de erro do resto do
 * app em `<EstadoErro>`.
 */
async function buscarPainelDia(): Promise<PainelDiaNormalizado> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/painel", { credentials: "include" });
  } catch {
    throw new ApiError("Sem conexão com o servidor. Verifique a rede e tente de novo.", 0, "rede");
  }

  if (!resposta.ok) {
    if (resposta.status === 404 || resposta.status === 501) {
      throw new ApiError(
        "A rota do painel ainda não está no ar. Assim que existir, esta tela passa a mostrar a fila real.",
        resposta.status,
      );
    }
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ApiError("Sem permissão para ver o painel com esta sessão.", resposta.status);
    }
    throw new ApiError(`Não foi possível carregar o painel agora (${resposta.status}).`, resposta.status);
  }

  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    corpo = null;
  }

  // 200 sem corpo utilizável é falha de contrato, não painel vazio.
  if (!corpo || typeof corpo !== "object") {
    throw new ApiError("O servidor respondeu, mas o painel veio em um formato inesperado.", resposta.status, "contrato");
  }

  return normalizarPainel(corpo);
}

/**
 * Sem polling (CLAUDE.md / ARQUITETURA-FASE-2 §8 Escalabilidade): uma busca
 * ao montar, e uma sob `recarregar()` explícito (botão "Atualizar"). O
 * egress do Supabase é da organização inteira.
 */
export function usePainelDia() {
  return useRecurso(buscarPainelDia, []);
}
