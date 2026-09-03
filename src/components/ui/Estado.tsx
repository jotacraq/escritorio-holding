import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";

export function EstadoCarregando({ rotulo = "Carregando…" }: { rotulo?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 px-1 py-8 text-sm text-tinta-suave">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-linha-forte border-t-latao" aria-hidden="true" />
      {rotulo}
    </div>
  );
}

export function EstadoErro({ erro, tentarNovamente, titulo = "Não deu para carregar" }: { erro: unknown; tentarNovamente?: () => void; titulo?: string }) {
  const mensagem = erro instanceof ApiError ? erro.message : "Erro inesperado. Tente de novo em instantes.";
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-sm border border-vermelho bg-vermelho-fraco px-4 py-3 text-sm text-[color:var(--vermelho)]">
      <p className="font-medium">{titulo}</p>
      <p>{mensagem}</p>
      {tentarNovamente && (
        <button
          type="button"
          onClick={tentarNovamente}
          className="mt-1 rounded-sm border border-current px-2.5 py-1 text-xs font-medium hover:bg-white/40"
        >
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function EstadoVazio({ titulo, descricao, acao }: { titulo: string; descricao?: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-sm border border-dashed border-linha-forte px-4 py-6 text-sm text-tinta-suave">
      <p className="font-medium text-tinta">{titulo}</p>
      {descricao && <p>{descricao}</p>}
      {acao}
    </div>
  );
}

/** Recurso ainda não exposto pelo backend (endpoint assumido, 404/501). Não é erro do usuário. */
export function EstadoIndisponivel({ titulo = "Recurso ainda não disponível" }: { titulo?: string }) {
  return (
    <div className="rounded-sm border border-linha bg-papel-elevado px-4 py-3 text-sm text-tinta-suave">
      <p className="font-medium text-tinta">{titulo}</p>
      <p>O backend ainda não expõe esta rota. Assim que existir, esta tela passa a mostrar o dado real.</p>
    </div>
  );
}
