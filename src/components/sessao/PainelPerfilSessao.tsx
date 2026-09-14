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
 * Coluna esquerda do mock do Marcio (14/09, pixel a pixel): "SAÚDE AO VIVO"
 * (círculo com progresso), "PERFIL" (badge DISC), "LEITURA DECISÓRIA",
 * "MODO", "PREÇO", "ESTADO FINAL DA SESSÃO", "Sessão" (cliente/data/origem).
 *
 * Mapeamento para dado real (nenhum campo inventado — ver Diário/entrega):
 *  - SAÚDE AO VIVO → não existe métrica de "saúde da sessão" em nenhuma
 *    tabela do domínio. Usa o PROGRESSO real do roteiro (indiceAtual/total,
 *    a mesma métrica de `BarraProgresso`) — é a única contagem "X/Y" que
 *    existe de fato. Rotulado "Progresso da sessão", nunca "saúde", para não
 *    prometer um dado que não existe.
 *  - PERFIL → `briefing.conteudo.perfil_disc` (predominante/secundário).
 *  - LEITURA DECISÓRIA → `briefing.conteudo.resumo_executivo` (já é a
 *    leitura de uma frase que a IA produz sobre a pessoa/família).
 *  - MODO → `briefing.conteudo.estrategia_sessao.ritmo` (a recomendação de
 *    condução mais próxima de "modo" que existe — não existe um campo
 *    "presencial/online" no domínio).
 *  - PREÇO → `PrecoCroqui` (mesmo dado que `PainelOferta` já usa).
 *  - ESTADO FINAL DA SESSÃO → `sessao.resultado` (fechou/não fechou/
 *    indefinido/null — null = ainda em andamento).
 *  - Sessão → `pessoa.nome`, `sessao.realizada_em` (ou "ainda não
 *    realizada"), `jornada.origem`.
 *
 * Busca o briefing completo em PARALELO com `PainelBriefingSessao` (que já
 * faz o mesmo GET para o próprio conteúdo expandido) — custo aceitável: é
 * uma 2ª chamada CONSTANTE por abertura de tela (não cresce com volume de
 * dado, não é N×M), e refatorar `PainelBriefingSessao` para aceitar o
 * briefing como prop está fora do escopo desta entrega (mudança de
 * contrato de outro componente, não de layout).
 */
export function PainelPerfilSessao({
  pessoa,
  jornada,
  sessao,
  briefingAtual,
  preco,
  indiceAtual,
  totalBlocos,
}: {
  pessoa: Pessoa;
  jornada: Jornada;
  sessao: SessaoViabilidade;
  briefingAtual: BriefingResumo | null;
  preco: PrecoCroqui | null;
  indiceAtual: number;
  totalBlocos: number;
}) {
  const buscar = useCallback(() => (briefingAtual ? buscarBriefing(briefingAtual.id) : Promise.resolve(null)), [briefingAtual]);
  const { dados: briefing, erro } = useRecurso(buscar, [briefingAtual?.id ?? null]);
  const c = briefing && !(erro instanceof ApiError) ? (briefing.conteudo as unknown as BriefingConteudoV2) : null;

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

      <Quadro rotulo="Estado final da sessão">
        {!resultado ? (
          <p className="text-sm text-tinta-suave">Sessão em andamento — sem resultado registrado ainda.</p>
        ) : (
          <Selo tom={resultado.tom}>{resultado.texto}</Selo>
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
