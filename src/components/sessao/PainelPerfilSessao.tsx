"use client";

import { useCallback } from "react";
import { buscarBriefing, ApiError, type BriefingResumo } from "@/lib/api";
import type { SessaoViabilidade } from "@/lib/api/sessoes";
import type { Jornada, Pessoa } from "@/lib/api/jornadas";
import type { PrecoCroqui } from "@/types/cenario";
import type { BriefingConteudoV2 } from "@/components/briefing/tipos";
import { rotularDisc } from "@/components/briefing/tipos";
import { useRecurso } from "@/hooks/useRecurso";
import { Quadro } from "@/components/ui/Quadro";
import { Selo } from "@/components/ui/Selo";
import { formatarData, formatarMoeda } from "@/lib/formatar";

const ROTULO_ORIGEM: Record<Jornada["origem"], string> = {
  seminario: "Seminário",
  indicacao: "Indicação",
  organico: "Orgânico",
  trafego_pago: "Tráfego pago",
  outro: "Outro",
};

const ROTULO_RESULTADO_SESSAO: Record<NonNullable<SessaoViabilidade["resultado"]>, { texto: string; tom: "verde" | "vermelho" | "neutro" }> = {
  fechou: { texto: "Fechou", tom: "verde" },
  nao_fechou: { texto: "Não fechou", tom: "vermelho" },
  indefinido: { texto: "Indefinido", tom: "neutro" },
};

/**
 * Redesenho de largura cheia (pedido do Marcio, 14/09): o mock original
 * (14/09, pixel a pixel) juntava 7 quadros numa única coluna esquerda —
 * "SAÚDE AO VIVO", "PERFIL", "LEITURA DECISÓRIA", "MODO", "PREÇO", "ESTADO
 * FINAL DA SESSÃO", "Sessão". Medido de novo: 3 desses 7 campos mostravam
 * "Sem briefing gerado ainda" na captura que ele mandou, e a promessa da
 * rodada é "tudo sobre a sessão em andamento" na primeira dobra — não tudo
 * que existe sobre o cliente. Dividido em dois componentes pela mesma régua
 * que decide o resto da tela:
 *
 *  - `PainelVigilanciaAoVivo` — muda DURANTE a sessão (posição no roteiro,
 *    resultado registrado ao final). Fica na primeira dobra, ao lado do
 *    mosaico do copiloto.
 *  - `PainelPerfilConsulta` — o briefing PRÉ-GERADO antes da sessão (perfil
 *    DISC, leitura decisória, modo, preço, identificação) não muda com o
 *    andamento da conversa; é consultado ocasionalmente, não lido a cada
 *    troca de bloco. Desceu para fora da primeira dobra.
 *
 * Nenhum campo mudou de fonte de dado nem de rótulo — só a composição/
 * posição na tela. Mapeamento para dado real continua o mesmo (nenhum campo
 * inventado):
 *  - Progresso da sessão → indiceAtual/totalBlocos (mesma métrica de
 *    `BarraProgresso`).
 *  - Estado final da sessão → `sessao.resultado`.
 *  - PERFIL → `briefing.conteudo.perfil_disc`.
 *  - LEITURA DECISÓRIA → `briefing.conteudo.resumo_executivo`.
 *  - MODO → `briefing.conteudo.estrategia_sessao.ritmo`.
 *  - PREÇO → `PrecoCroqui` (mesmo dado que `PainelOferta` já usa).
 *  - Sessão → `pessoa.nome`, `sessao.realizada_em`, `jornada.origem`.
 */
export function PainelVigilanciaAoVivo({
  sessao,
  indiceAtual,
  totalBlocos,
}: {
  sessao: SessaoViabilidade;
  indiceAtual: number;
  totalBlocos: number;
}) {
  const percentual = totalBlocos > 1 ? Math.round((indiceAtual / (totalBlocos - 1)) * 100) : 0;
  const resultado = sessao.resultado ? ROTULO_RESULTADO_SESSAO[sessao.resultado] : null;

  return (
    <div className="flex flex-col gap-2">
      <Quadro rotulo="Progresso da sessão">
        <div className="flex items-center gap-3">
          <div
            role="img"
            aria-label={`Parte ${indiceAtual} de ${Math.max(totalBlocos - 1, 0)}, ${percentual}% percorrido`}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-[color:var(--latao-cta)] text-sm font-bold tabular-nums text-tinta"
          >
            {indiceAtual}/{Math.max(totalBlocos - 1, 0)}
          </div>
          <p className="text-sm text-tinta-suave">{percentual}% do roteiro percorrido</p>
        </div>
      </Quadro>

      <Quadro rotulo="Estado final da sessão">
        {!resultado ? (
          <p className="text-sm text-tinta-suave">Sessão em andamento — sem resultado registrado ainda.</p>
        ) : (
          <Selo tom={resultado.tom}>{resultado.texto}</Selo>
        )}
      </Quadro>
    </div>
  );
}

/**
 * Consulta do briefing (ver comentário de topo) — fora da primeira dobra.
 * Busca o briefing completo em PARALELO com `PainelBriefingSessao` (que já
 * faz o mesmo GET para o próprio conteúdo expandido) — custo aceitável: é
 * uma 2ª chamada CONSTANTE por abertura de tela (não cresce com volume de
 * dado, não é N×M), e refatorar `PainelBriefingSessao` para aceitar o
 * briefing como prop está fora do escopo desta entrega (mudança de
 * contrato de outro componente, não de layout).
 */
export function PainelPerfilConsulta({
  pessoa,
  jornada,
  sessao,
  briefingAtual,
  preco,
}: {
  pessoa: Pessoa;
  jornada: Jornada;
  sessao: SessaoViabilidade;
  briefingAtual: BriefingResumo | null;
  preco: PrecoCroqui | null;
}) {
  const buscar = useCallback(() => (briefingAtual ? buscarBriefing(briefingAtual.id) : Promise.resolve(null)), [briefingAtual]);
  const { dados: briefing, erro } = useRecurso(buscar, [briefingAtual?.id ?? null]);
  const c = briefing && !(erro instanceof ApiError) ? (briefing.conteudo as unknown as BriefingConteudoV2) : null;

  return (
    <div className="flex flex-col gap-2">
      <Quadro rotulo="Perfil" acao={c && <Selo tom="neutro">{c.perfil_disc.predominante}{c.perfil_disc.secundario ? `/${c.perfil_disc.secundario}` : ""}</Selo>}>
        {!c ? (
          <p className="text-sm text-tinta-suave">{briefingAtual ? "Carregando…" : "Sem briefing gerado ainda."}</p>
        ) : (
          <p className="text-sm text-tinta">
            {rotularDisc(c.perfil_disc.predominante)}
            {c.perfil_disc.secundario && <> · {rotularDisc(c.perfil_disc.secundario)}</>}
          </p>
        )}
      </Quadro>

      <Quadro rotulo="Leitura decisória">
        <p className="text-sm text-tinta-suave">{c ? c.resumo_executivo : briefingAtual ? "Carregando…" : "Sem briefing gerado ainda."}</p>
      </Quadro>

      <Quadro rotulo="Modo">
        <p className="text-sm text-tinta-suave">{c ? c.estrategia_sessao.ritmo : briefingAtual ? "Carregando…" : "Sem briefing gerado ainda."}</p>
      </Quadro>

      <Quadro rotulo="Preço">
        {!preco || (preco.padrao === null && preco.incentivo === null) ? (
          <p className="text-sm text-tinta-suave">Parâmetro de preço não configurado.</p>
        ) : (
          <p className="text-sm text-tinta">
            {preco.incentivo !== null ? formatarMoeda(preco.incentivo) : formatarMoeda(preco.padrao)}
            {preco.incentivo !== null && preco.padrao !== null && preco.incentivo !== preco.padrao && (
              <span className="ml-1.5 text-legenda text-tinta-fraca line-through">{formatarMoeda(preco.padrao)}</span>
            )}
          </p>
        )}
      </Quadro>

      <Quadro rotulo="Sessão">
        <div className="flex flex-col gap-1 text-sm text-tinta-suave">
          <p className="text-tinta">{pessoa.nome}</p>
          <p>{sessao.realizada_em ? formatarData(sessao.realizada_em) : "Ainda não realizada"}</p>
          <p>{ROTULO_ORIGEM[jornada.origem]}</p>
        </div>
      </Quadro>
    </div>
  );
}
