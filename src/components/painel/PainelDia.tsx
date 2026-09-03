"use client";

import { useEffect, useState } from "react";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { ApiError } from "@/lib/api";
import { formatarDataHora } from "@/lib/formatar";
import { usarPainelDia } from "./usarPainelDia";
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
 */
export function PainelDia() {
  const { estado, recarregar } = usarPainelDia();
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date | null>(null);

  // A cada carga bem-sucedida, registra o instante local da busca — não é
  // dado de domínio, é só "quando esta tela foi buscada pela última vez".
  useEffect(() => {
    if (estado.fase === "pronto") setUltimaAtualizacao(new Date());
  }, [estado]);

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
          {ultimaAtualizacao && estado.fase === "pronto" && (
            <span className="text-xs text-tinta-fraca">Atualizado às {formatarDataHora(ultimaAtualizacao.toISOString())}</span>
          )}
          <Botao
            variante="secundario"
            onClick={() => {
              setUltimaAtualizacao(null);
              aoClicarAtualizar();
            }}
            carregando={estado.fase === "carregando"}
          >
            Atualizar
          </Botao>
        </div>
      </div>

      {estado.fase === "carregando" && <EstadoCarregando rotulo="Carregando o painel do dia…" />}

      {estado.fase === "erro" && (
        <EstadoErro
          erro={new ApiError(estado.mensagem, 0)}
          tentarNovamente={() => {
            setUltimaAtualizacao(null);
            recarregar();
          }}
          titulo="Não deu para carregar o painel"
        />
      )}

      {estado.fase === "pronto" && (
        <div className="flex flex-col gap-4">
          <SessoesHoje estado={estado.dados.sessoesDoDia} aoTentarDeNovo={recarregar} />
          <PreparoPendente estado={estado.dados.pendenciasPreparo} aoTentarDeNovo={recarregar} />
          <PagosSemContato estado={estado.dados.pagosSemContato} aoTentarDeNovo={recarregar} />
          <Travado estado={estado.dados.pendenciasSistema} aoTentarDeNovo={recarregar} />
          <NumerosSemana estado={estado.dados.indicadoresSemana} aoTentarDeNovo={recarregar} />
        </div>
      )}
    </div>
  );
}
