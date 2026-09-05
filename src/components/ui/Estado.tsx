import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { Botao } from "./Botao";

export function EstadoCarregando({ rotulo = "Carregando…" }: { rotulo?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 px-1 py-8 text-sm text-tinta-suave">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-linha-forte border-t-[color:var(--latao-cta)]" aria-hidden="true" />
      {rotulo}
    </div>
  );
}

/**
 * Erro sempre com o que fazer: título humano, a mensagem da API (que já vem
 * em português) e o botão de tentar de novo quando existe.
 */
export function EstadoErro({ erro, tentarNovamente, titulo = "Não deu para carregar" }: { erro: unknown; tentarNovamente?: () => void; titulo?: string }) {
  const mensagem = erro instanceof ApiError ? erro.message : "Erro inesperado. Tente de novo em instantes.";
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-cartao border border-[color:var(--vermelho)] bg-vermelho-fraco px-5 py-4 text-sm text-[color:var(--vermelho)]">
      <p className="text-subtitulo font-bold">{titulo}</p>
      <p className="text-tinta">{mensagem}</p>
      {tentarNovamente && (
        <Botao variante="perigo" tamanho="compacto" onClick={tentarNovamente} className="mt-1">
          Tentar de novo
        </Botao>
      )}
    </div>
  );
}

type Ilustracao = "pasta" | "agenda" | "busca" | "lista" | "sucesso";

/* Ilustrações leves, inline, tingidas com os tokens (funcionam nos dois
   temas). Decorativas — o título e a descrição carregam a informação. */
const ILUSTRACOES: Record<Ilustracao, ReactNode> = {
  pasta: (
    <>
      <path d="M8 18a3 3 0 0 1 3-3h11l4 4h19a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V18Z" fill="var(--latao-fraco)" stroke="var(--latao)" />
      <path d="M8 26h40" stroke="var(--latao)" />
      <path d="M20 35h16" stroke="var(--latao)" strokeDasharray="3 3" />
    </>
  ),
  agenda: (
    <>
      <rect x="9" y="12" width="38" height="34" rx="4" fill="var(--latao-fraco)" stroke="var(--latao)" />
      <path d="M9 22h38M19 8v8M37 8v8" stroke="var(--latao)" />
      <circle cx="28" cy="34" r="4" fill="var(--latao-cta)" stroke="none" />
    </>
  ),
  busca: (
    <>
      <circle cx="25" cy="25" r="13" fill="var(--latao-fraco)" stroke="var(--latao)" />
      <path d="M35 35l11 11" stroke="var(--latao)" strokeWidth="3" />
      <path d="M19 25h12M25 19v12" stroke="var(--latao)" strokeDasharray="2 3" />
    </>
  ),
  lista: (
    <>
      <rect x="10" y="10" width="36" height="36" rx="5" fill="var(--latao-fraco)" stroke="var(--latao)" />
      <path d="M18 21h20M18 28h20M18 35h12" stroke="var(--latao)" />
    </>
  ),
  sucesso: (
    <>
      <circle cx="28" cy="28" r="18" fill="var(--verde-fraco)" stroke="var(--verde)" />
      <path d="M19 29l6 6 12-13" stroke="var(--verde)" strokeWidth="3" />
    </>
  ),
};

/**
 * Vazio é vazio — mas um vazio é um convite para agir. Título humano,
 * explicação de uma linha e a ação primária que tira a pessoa dali.
 * Props antigas (`titulo`, `descricao`, `acao`) continuam funcionando.
 */
export function EstadoVazio({
  titulo,
  descricao,
  acao,
  ilustracao = "lista",
  compacto = false,
}: {
  titulo: string;
  descricao?: string;
  /** Botão/link primário. Passe um `<Botao variante="primario">` ou `<Link>`. */
  acao?: ReactNode;
  ilustracao?: Ilustracao;
  /** Versão de uma linha, sem ilustração (dentro de cartões pequenos). */
  compacto?: boolean;
}) {
  if (compacto) {
    return (
      <div className="flex flex-col items-start gap-1.5 rounded-controle border border-dashed border-linha-forte px-4 py-4 text-sm text-tinta-suave">
        <p className="font-bold text-tinta">{titulo}</p>
        {descricao && <p>{descricao}</p>}
        {acao && <div className="mt-1">{acao}</div>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-cartao border border-dashed border-linha-forte px-6 py-10 text-center">
      <svg aria-hidden="true" viewBox="0 0 56 56" className="h-14 w-14" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {ILUSTRACOES[ilustracao]}
      </svg>
      <p className="text-subtitulo font-bold text-tinta">{titulo}</p>
      {descricao && <p className="max-w-md text-sm text-tinta-suave">{descricao}</p>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}

/** Recurso ainda não exposto pelo backend (endpoint assumido, 404/501). Não é erro do usuário. */
export function EstadoIndisponivel({ titulo = "Recurso ainda não disponível" }: { titulo?: string }) {
  return (
    <div className="rounded-cartao border border-linha bg-papel-elevado px-5 py-4 text-sm text-tinta-suave">
      <p className="font-bold text-tinta">{titulo}</p>
      <p>O sistema ainda não tem esta parte ligada. Assim que existir, esta tela passa a mostrar o dado real.</p>
    </div>
  );
}
