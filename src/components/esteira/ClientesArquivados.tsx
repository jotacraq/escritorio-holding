"use client";

import { useCallback, useMemo, useState } from "react";
import { listarJornadas, type EtapaOrdem, type FiltrosJornadas, type JornadaKanban } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { rotulo } from "@/lib/vocabulario";
import { useComprasDosProcessos, usePrazosAbertos } from "@/components/painel/dadosDeUrgencia";
import { ErroArquivamento, desarquivarProcesso, resumoDoDesarquivamento } from "@/components/ficha360/api-arquivar";
import { TabelaClientes } from "./TabelaClientes";
import type { ChaveFase } from "./sessaoDaEtapa";
import { faseDaEtapa } from "./sessaoDaEtapa";

/**
 * Aba **Arquivados** — os processos que não andaram (Fase 8, §B2 / D15).
 *
 * "Arquivar" no SIC-HF é `jornadas.desfecho = 'congelada'`: o único desfecho
 * que não afirma resultado comercial (não é ganho, não é perdido, não é
 * descarte) e por isso é o único que pode ser desfeito sem reescrever a
 * história. Por isso ele tem lista própria: um processo arquivado não é lixo,
 * é um processo que voltará quando o cliente voltar.
 *
 * A lista é a MESMA `TabelaClientes` da aba Ativos — mesmas colunas, mesmos
 * rótulos, mesma ordem. Só a ação de linha muda: em vez de "Mover de fase",
 * **Desarquivar**.
 *
 * O Desfazer é o `desarquivarProcesso` da frente do arquivamento
 * (`ficha360/api-arquivar.ts`): a MESMA chamada que a Ficha usa, com o mesmo
 * resumo contado pela RPC ("2 mensagens voltaram para a fila"). Nunca um
 * sucesso genérico, e nunca um processo que sai da lista sem ter voltado —
 * falhou, a linha continua onde estava e o toast diz por quê.
 */
export function ClientesArquivados({
  filtros,
  etapas,
  fase,
}: {
  /** Os mesmos filtros da aba Ativos (busca, edição, origem, responsável). */
  filtros: FiltrosJornadas;
  etapas: readonly EtapaOrdem[];
  fase: ChaveFase | null;
}) {
  const { notificar } = useToast();
  const [desarquivando, setDesarquivando] = useState<string | null>(null);

  const chaveFiltros = JSON.stringify({ ...filtros, desfecho: "congelada", incluir_fechadas: true });
  const buscar = useCallback(() => listarJornadas(JSON.parse(chaveFiltros)), [chaveFiltros]);
  const { dados, carregando, erro, recarregar, setDados } = useRecurso(buscar, [chaveFiltros]);

  const itens = useMemo(() => dados?.itens ?? [], [dados]);
  const visiveis = useMemo(() => (fase ? itens.filter((j) => faseDaEtapa(j.etapa) === fase) : itens), [itens, fase]);
  const ids = useMemo(() => visiveis.map((j) => j.id), [visiveis]);

  const { fonte: fontePrazos } = usePrazosAbertos();
  const { fonte: fonteCompras } = useComprasDosProcessos({ jornadaIds: ids });

  async function desarquivar(jornada: JornadaKanban) {
    setDesarquivando(jornada.id);
    try {
      const resultado = await desarquivarProcesso(jornada.id);
      setDados((atual) => (atual ? { ...atual, itens: atual.itens.filter((j) => j.id !== jornada.id), total: Math.max(0, atual.total - 1) } : atual));
      notificar({
        tom: "sucesso",
        titulo: `${jornada.nome} voltou para a lista ativa`,
        descricao: resumoDoDesarquivamento(resultado),
      });
    } catch (e) {
      notificar({
        tom: "erro",
        titulo: `Não deu para desarquivar ${jornada.nome}`,
        descricao:
          e instanceof ErroArquivamento
            ? e.message
            : "Confira a internet e tente de novo. O processo continua arquivado.",
      });
    } finally {
      setDesarquivando(null);
    }
  }

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo={`Não foi possível carregar os ${rotulo("arquivado").toLowerCase()}s`} />;

  return (
    <TabelaClientes
      legenda={`Processos arquivados${fase ? " nesta fase" : ""}`}
      itens={visiveis}
      etapas={etapas}
      fontePrazos={fontePrazos}
      fonteCompras={fonteCompras}
      carregando={carregando && itens.length === 0}
      acaoExtra={{
        rotulo: "Desarquivar",
        aoClicar: desarquivar,
        ocupado: (j) => desarquivando === j.id,
      }}
      vazio={
        <EstadoVazio
          ilustracao="lista"
          titulo={fase ? "Nenhum processo arquivado nesta fase" : "Nenhum processo arquivado"}
          descricao={
            fase
              ? "Nenhum processo desta fase foi arquivado. Tire o filtro para ver os arquivados de todas as fases."
              : "Arquivar tira o processo da lista ativa sem afirmar ganho nem perda — e é reversível. O campo “Situação”, no topo da ficha, faz isso."
          }
          acao={
            <Botao variante="secundario" onClick={recarregar}>
              Recarregar
            </Botao>
          }
        />
      }
    />
  );
}
