/**
 * Estado de carregamento das páginas públicas. Texto simples, sem jargão, `aria-live` para
 * leitor de tela — a animação some sozinha com `prefers-reduced-motion` (regra global em
 * `globals.css`, não duplicada aqui).
 */
export function CarregandoPublico() {
  return (
    <div role="status" aria-live="polite" className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center text-tinta-suave">
      <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-linha-forte border-t-latao" aria-hidden="true" />
      <p>Carregando…</p>
    </div>
  );
}

/** Erro que não é "link inválido" — falha de rede/servidor pontual. Convida a tentar de novo. */
export function ErroTemporarioPublico({ aoTentarNovamente }: { aoTentarNovamente: () => void }) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
      <p className="max-w-sm text-tinta-suave">
        Não deu para carregar agora. Pode ser a internet do seu celular ou algo passageiro do nosso lado — tente de novo em
        instantes.
      </p>
      <button
        type="button"
        onClick={aoTentarNovamente}
        className="inline-flex items-center justify-center rounded-sm border border-linha-forte bg-papel-elevado px-5 font-medium text-tinta hover:bg-papel"
      >
        Tentar de novo
      </button>
    </div>
  );
}
