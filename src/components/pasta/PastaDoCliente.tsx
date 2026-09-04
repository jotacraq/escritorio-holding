"use client";

import type { ChaveItemPasta } from "@/lib/pasta/catalogo";
import type { EstadoItemPasta, ItemPasta } from "@/lib/pasta/derivar";
import { ABA_POR_ITEM_PASTA, ACAO_POR_ITEM_PASTA } from "@/lib/pasta/rotas";
import { SeloIA } from "@/components/ui/Selo";

/**
 * "A Pasta do Cliente" (Fase 2 do plano, `brain/Diário/2026-09-04.md`) — a
 * tela que vira a RAIZ da Ficha 360, substituindo `ChecklistPendencias` +
 * primeira aba do primeiro grupo como conteúdo padrão de `/jornadas/[id]`
 * (sem hash). Onde antes 9 dos 14 artefatos ficavam invisíveis fora do grupo
 * de abas ativo (`Abas.tsx`, `abasVisiveis = grupoAtivo.abas`), aqui os itens
 * visíveis para o papel (já filtrados por `derivarPasta`) aparecem todos de
 * uma vez.
 *
 * Reforço da regra de segurança (não é redundância, é a garantia de que a
 * camada visual não reabre o que `derivarPasta` já fechou): este componente
 * SÓ itera `itens` — nunca lê `CATALOGO_PASTA` nem reconstrói a lista
 * completa dos 14. Um item de patrimônio para quem não pode ver
 * simplesmente não está no array — não existe card cinza "bloqueado" em
 * lugar nenhum deste arquivo.
 */

/**
 * Os 3 momentos amplos do plano do arquiteto. Mapeamento de
 * `ChaveItemPasta` decidido ao ler `catalogo.ts`/`derivar.ts`:
 * - "Antes da sessão": tudo que é preparação (Formulário, Ligação, Links,
 *   Briefing) mais o próprio agendamento da Sessão (`sessao` cobre tanto
 *   "agendar" quanto "realizar" — ela é o evento-gonzo entre antes/durante,
 *   e como todo pré-requisito de "na sessão"/"depois" é `sessao_realizada`,
 *   faz mais sentido ancorar o cartão de agendamento em "antes").
 * - "Na sessão": os dois artefatos que só existem por causa do evento em si
 *   (Transcrição, Análise da Sessão) — não são preparação nem produto final.
 * - "Depois da sessão": tudo que só o faz sentido consumir depois que a SV
 *   aconteceu (Diagnóstico, Relatório, Croqui, Material) mais o que não tem
 *   relação de pré-requisito com a sessão em si, mas semanticamente pertence
 *   ao dossiê final do caso (Patrimônio, Familiares, Documentos) — mantido
 *   junto do plano do arquiteto em vez de um 4º momento "Patrimônio", porque
 *   a Fase 2 é sobre PARAR de esconder itens atrás de grupo, não recriar um
 *   grupo novo com outro nome.
 */
const MOMENTOS: { titulo: string; chaves: ChaveItemPasta[] }[] = [
  { titulo: "Antes da sessão", chaves: ["formulario", "ligacao", "links", "briefing", "sessao"] },
  { titulo: "Na sessão", chaves: ["transcricao", "analise_sessao"] },
  {
    titulo: "Depois da sessão",
    chaves: ["diagnostico_sv", "relatorio_sv", "croqui", "material", "patrimonio", "familiares", "documentos"],
  },
];

const CORES_ESTADO: Record<EstadoItemPasta, { borda: string; ponto: string; texto: string }> = {
  pronto: { borda: "border-verde-fraco", ponto: "bg-[color:var(--verde)]", texto: "text-[color:var(--verde)]" },
  em_revisao: { borda: "border-ambar-borda", ponto: "bg-[color:var(--ambar)]", texto: "text-[color:var(--ambar)]" },
  falta: { borda: "border-ambar-borda", ponto: "bg-[color:var(--ambar)]", texto: "text-[color:var(--ambar)]" },
  ainda_nao: { borda: "border-linha", ponto: "bg-tinta-fraca", texto: "text-tinta-fraca" },
};

const ROTULO_ESTADO: Record<EstadoItemPasta, string> = {
  pronto: "Pronto",
  em_revisao: "Em revisão",
  falta: "Falta",
  ainda_nao: "Ainda não é hora",
};

function CartaoItem({ item }: { item: ItemPasta }) {
  const cores = CORES_ESTADO[item.estado];
  const clicavel = item.estado !== "ainda_nao";
  const href = clicavel ? `#${ABA_POR_ITEM_PASTA[item.chave]}` : undefined;
  const acao = ACAO_POR_ITEM_PASTA[item.chave];

  const conteudo = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${cores.texto}`}>
          <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${cores.ponto}`} />
          {ROTULO_ESTADO[item.estado]}
          {item.estado === "falta" && (
            <span aria-hidden="true" className="ml-0.5">
              →
            </span>
          )}
        </span>
        {item.procedencia === "gerado_ia" && <SeloIA />}
      </div>
      <p className="font-serif text-base font-semibold text-tinta">{item.rotulo}</p>
      <p className="text-sm text-tinta-suave">{item.nota ?? (item.estado === "pronto" ? "Concluído." : acao)}</p>
    </>
  );

  const classeBase =
    "flex min-h-[44px] flex-col gap-1.5 rounded-sm border bg-papel-elevado p-3.5 text-left transition-colors";

  if (!clicavel) {
    // `ainda_nao`: não navega — mas continua no DOM como elemento estático,
    // não como link/botão morto (regra de teclado: nada focável que não faz
    // nada). A nota já explica o "porquê" (`derivar.ts` sempre popula `nota`
    // para os itens que ficam em `ainda_nao`).
    return <div className={`${classeBase} ${cores.borda} cursor-default opacity-90`}>{conteudo}</div>;
  }

  return (
    <a
      href={href!}
      onClick={(evento) => {
        // `next/link`/navegação padrão de âncora só reescrevem
        // `window.location.hash` — não há garantia de que o Next App Router
        // dispare `hashchange` de forma síncrona quando o pathname não muda
        // (confirmado manualmente: só trocar o hash, mesmo por link nativo,
        // não acorda o listener de `ConteudoPastaOuAbas`/`Abas` a tempo).
        // Como o roteamento é 100% local (mesma página, troca de aba), a
        // navegação nativa do navegador já move o hash — só precisamos
        // garantir que o listener seja avisado, então evitamos qualquer
        // interceptação de framework e disparamos o evento nós mesmos.
        evento.preventDefault();
        window.location.hash = href!;
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }}
      className={`${classeBase} ${cores.borda} hover:border-[color:var(--latao)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--latao)]`}
    >
      {conteudo}
    </a>
  );
}

export function PastaDoCliente({ itens }: { itens: ItemPasta[] }) {
  // Contador honesto: o denominador é só o que já é "hora de fazer"
  // (pronto + em_revisao + falta) — `ainda_nao` fica de fora do total tanto
  // quanto do numerador. Contar "3 de 14" para um cliente que acabou de
  // preencher o Formulário faria parecer 11 pendências atrasadas, quando na
  // verdade 9 delas são "ainda não é hora" (dependem da Sessão de
  // Viabilidade acontecer). É a diferença entre "estou atrasado" e "estou no
  // caminho" (plano do arquiteto, Diário 2026-09-04).
  const itensAcionaveis = itens.filter((i) => i.estado !== "ainda_nao");
  const total = itensAcionaveis.length;
  const prontos = itensAcionaveis.filter((i) => i.estado === "pronto").length;
  const aindaNao = itens.length - total;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3 rounded-sm border border-linha-forte bg-papel-elevado px-3.5 py-2.5">
        <p className="text-sm font-medium text-tinta">
          Você já tem <span className="font-semibold">{prontos}</span> de <span className="font-semibold">{total}</span> itens
          desta fase.
          {aindaNao > 0 && (
            <span className="ml-1.5 font-normal text-tinta-fraca">
              ({aindaNao} {aindaNao === 1 ? "item chega" : "itens chegam"} depois da Sessão de Viabilidade.)
            </span>
          )}
        </p>
      </div>

      {MOMENTOS.map((momento) => {
        const itensDoMomento = itens.filter((i) => momento.chaves.includes(i.chave));
        if (itensDoMomento.length === 0) return null;
        return (
          <section key={momento.titulo} aria-labelledby={`momento-${momento.titulo}`} className="flex flex-col gap-3">
            <h2 id={`momento-${momento.titulo}`} className="text-xs font-semibold uppercase tracking-wide text-tinta-fraca">
              {momento.titulo}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {itensDoMomento.map((item) => (
                <CartaoItem key={item.chave} item={item} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
