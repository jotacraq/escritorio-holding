"use client";

import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { formatarDataHora } from "@/lib/formatar";
import { usePainelDia } from "./usePainelDia";
import { SessoesHoje } from "./SessoesHoje";
import { PreparoPendente } from "./PreparoPendente";
import { PagosSemContato } from "./PagosSemContato";
import { Travado } from "./Travado";
import { NumerosSemana } from "./NumerosSemana";

const FORMATADOR_DATA_TITULO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "long",
  day: "2-digit",
  month: "long",
});

/**
 * Painel do dia — a primeira tela que a Dra. Elaine vê. Fila do dia em
 * ordem de urgência, não kanban para varrer (ARQUITETURA-FASE-2 §4.6 / §8 UX).
 *
 * Sem polling: uma busca ao montar, e uma sob clique em "Atualizar". O
 * egress do Supabase é da organização inteira e já custou caro num sistema
 * desta casa com aba parada fazendo polling.
 *
 * "Atualizado às" usa `gerado_em` — o instante que o servidor calculou o
 * painel, não o relógio do navegador — para não afirmar uma frescura que
 * ninguém mediu. Sem esse campo na resposta, o rótulo simplesmente não
 * aparece (vazio nunca vira dado inventado).
 */
export function PainelDia() {
  const { dados, carregando, erro, recarregar } = usePainelDia();
  const semNenhumaCargaAinda = !dados;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold capitalize text-tinta">
            {FORMATADOR_DATA_TITULO.format(new Date())}
          </h1>
          <p className="text-sm text-tinta-suave">
            O que precisa da sua atenção agora, em ordem de urgência — não o quadro inteiro para varrer.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dados?.geradoEm && <span className="text-xs text-tinta-fraca">Atualizado às {formatarDataHora(dados.geradoEm)}</span>}
          <Botao variante="secundario" onClick={recarregar} carregando={carregando}>
            Atualizar
          </Botao>
        </div>
      </div>

      {carregando && semNenhumaCargaAinda && <EstadoCarregando rotulo="Carregando o painel do dia…" />}

      {Boolean(erro) && semNenhumaCargaAinda && (
        <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para carregar o painel" />
      )}

      {Boolean(erro) && !semNenhumaCargaAinda && (
        <p role="alert" className="text-xs text-[color:var(--vermelho)]">
          Não foi possível atualizar agora — mostrando a última carga bem-sucedida.
        </p>
      )}

      {dados && (
        <div className="flex flex-col gap-4">
          <SessoesHoje estado={dados.sessoesDoDia} aoTentarDeNovo={recarregar} />
          <PreparoPendente estado={dados.pendenciasPreparo} aoTentarDeNovo={recarregar} />
          <PagosSemContato estado={dados.pagosSemContato} aoTentarDeNovo={recarregar} />
          <Travado estado={dados.pendenciasSistema} aoTentarDeNovo={recarregar} />
          <NumerosSemana estado={dados.indicadoresSemana} aoTentarDeNovo={recarregar} />
        </div>
      )}
    </div>
  );
}
