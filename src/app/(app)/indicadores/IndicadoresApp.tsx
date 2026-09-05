"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { buscarIndicadores, type IndicadoresEdicao } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { useTema } from "@/hooks/useTema";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { Cartao } from "@/components/ui/Cartao";
import { Campo, Selecao } from "@/components/ui/Campo";
import { EsqueletoCartao } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Kpi } from "@/components/ui/Kpi";
import { FunilEtapas, ProporcaoMini, type EtapaFunil } from "./FunilEtapas";

const TODAS = "__todas__";
const SEM_EDICAO = "__sem_edicao__";

type Chave = Exclude<keyof IndicadoresEdicao, "edicao_id" | "edicao_codigo" | "edicao_nome">;

/** As etapas do funil, na ordem da esteira (`Esteira do cliente.md`). */
const ETAPAS: { chave: Chave; rotulo: string; base?: Chave; baseDescricao?: string }[] = [
  { chave: "jornadas", rotulo: "Entraram na coorte" },
  { chave: "sessoes_contratadas", rotulo: "Contrataram a sessão", base: "jornadas", baseDescricao: "de quem entrou" },
  { chave: "sessoes_realizadas", rotulo: "Realizaram a sessão", base: "sessoes_contratadas", baseDescricao: "de quem contratou" },
  { chave: "croquis_contratados", rotulo: "Contrataram o croqui", base: "sessoes_realizadas", baseDescricao: "de quem realizou" },
  { chave: "holdings", rotulo: "Contrataram a holding", base: "croquis_contratados", baseDescricao: "de quem tem croqui" },
];

const PREPARACAO: { chave: Chave; rotulo: string; base: Chave; baseDescricao: string }[] = [
  { chave: "formularios_respondidos", rotulo: "Formulários respondidos", base: "sessoes_contratadas", baseDescricao: "de quem contratou a sessão" },
  { chave: "ligacoes_feitas", rotulo: "Ligações Estratégicas feitas", base: "sessoes_contratadas", baseDescricao: "de quem contratou a sessão" },
];

const COLUNAS_TABELA: { chave: Chave; rotulo: string }[] = [
  { chave: "jornadas", rotulo: "Coorte" },
  { chave: "sessoes_contratadas", rotulo: "Sessões contratadas" },
  { chave: "sessoes_realizadas", rotulo: "Sessões realizadas" },
  { chave: "croquis_contratados", rotulo: "Croquis" },
  { chave: "holdings", rotulo: "Holdings" },
  { chave: "formularios_respondidos", rotulo: "Formulários" },
  { chave: "ligacoes_feitas", rotulo: "Ligações" },
];

function nomeDaEdicao(item: IndicadoresEdicao): string {
  if (!item.edicao_id) return "Sem edição de origem";
  return item.edicao_nome ?? item.edicao_codigo ?? "Edição sem nome cadastrado";
}

function idDaEdicao(item: IndicadoresEdicao): string {
  return item.edicao_id ?? SEM_EDICAO;
}

/** Lê um contador da view; `null` quando a view não trouxe (vazio é vazio, nunca zero). */
function contador(item: IndicadoresEdicao | null, chave: Chave): number | null {
  if (!item) return null;
  const valor = item[chave];
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

/** Soma das coortes selecionadas — cada pessoa continua contada na edição de onde veio. */
function somar(itens: IndicadoresEdicao[]): IndicadoresEdicao | null {
  if (itens.length === 0) return null;
  const soma: IndicadoresEdicao = {
    edicao_id: null,
    edicao_codigo: null,
    edicao_nome: null,
    jornadas: 0,
    sessoes_contratadas: 0,
    sessoes_realizadas: 0,
    croquis_contratados: 0,
    holdings: 0,
    formularios_respondidos: 0,
    ligacoes_feitas: 0,
  };
  for (const item of itens) {
    for (const coluna of COLUNAS_TABELA) soma[coluna.chave] += contador(item, coluna.chave) ?? 0;
  }
  return soma;
}

export function IndicadoresApp() {
  const { tema } = useTema();
  const buscar = useCallback(() => buscarIndicadores(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);
  const [edicaoSelecionada, setEdicaoSelecionada] = useState<string>(TODAS);

  const itens = useMemo(() => dados?.itens ?? [], [dados]);

  const selecionado = useMemo(() => {
    if (edicaoSelecionada === TODAS) return somar(itens);
    return itens.find((i) => idDaEdicao(i) === edicaoSelecionada) ?? null;
  }, [itens, edicaoSelecionada]);

  const tituloSelecao = edicaoSelecionada === TODAS ? "Todas as edições" : selecionado ? nomeDaEdicao(selecionado) : "";
  const coorte = contador(selecionado, "jornadas");
  const coorteVazia = coorte === null || coorte === 0;

  const etapasFunil: EtapaFunil[] = ETAPAS.map((e) => ({
    id: e.chave,
    rotulo: e.rotulo,
    valor: contador(selecionado, e.chave),
    baseDescricao: e.baseDescricao,
  }));

  return (
    <div className="flex flex-col gap-10">
      <CabecalhoPagina
        rotulo="Método"
        titulo="Indicadores"
        descricao="O funil por coorte: cada pessoa conta na edição do seminário de onde veio, mesmo que a sessão aconteça meses depois. Por isso os números de uma edição recente ainda crescem — e nunca comparam gente diferente."
        acoes={
          !carregando && !erro && itens.length > 0 ? (
            <Campo rotulo="Edição do seminário" className="min-w-[16rem]">
              <Selecao value={edicaoSelecionada} onChange={(e) => setEdicaoSelecionada(e.target.value)}>
                <option value={TODAS}>Todas as edições (soma das coortes)</option>
                {itens.map((item) => (
                  <option key={idDaEdicao(item)} value={idDaEdicao(item)}>
                    {item.edicao_codigo ? `${item.edicao_codigo} — ` : ""}
                    {nomeDaEdicao(item)}
                  </option>
                ))}
              </Selecao>
            </Campo>
          ) : undefined
        }
        meta={<span>POP 08 — só o que a view calcula de fato. Sem fonte de dado, o indicador aparece vazio, não zero.</span>}
      />

      {carregando && <EsqueletoCartao quantidade={4} rotulo="Carregando os indicadores…" />}
      {!carregando && erro ? <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para carregar os indicadores" /> : null}

      {!carregando && !erro && itens.length === 0 && (
        <EstadoVazio
          ilustracao="lista"
          titulo="Nenhuma coorte ainda"
          descricao="A view de indicadores só tem linha quando existe jornada ligada a uma edição do seminário. Importe os leads de uma edição para a primeira coorte nascer."
          acao={
            <Link href="/importacoes/nova" className="inline-flex min-h-11 items-center font-medium text-[color:var(--latao)] underline-offset-4 hover:underline">
              Importar leads de uma edição
            </Link>
          }
        />
      )}

      {!carregando && !erro && itens.length > 0 && (
        <>
          {/* --------------------------------------------------------- KPIs */}
          <section aria-labelledby="titulo-kpis" className="flex flex-col gap-4">
            <h2 id="titulo-kpis" className="text-subtitulo font-bold text-tinta">
              {tituloSelecao}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi rotulo="Pessoas na coorte" valor={coorte} unidade={coorte === 1 ? "pessoa" : "pessoas"} motivoVazio="nenhuma jornada ligada a esta edição" />
              {ETAPAS.slice(1, 4).map((etapa) => {
                const valor = contador(selecionado, etapa.chave);
                const base = etapa.base ? contador(selecionado, etapa.base) : null;
                const fracao = valor !== null && base !== null && base > 0 ? valor / base : null;
                return (
                  <Kpi
                    key={etapa.chave}
                    rotulo={etapa.rotulo}
                    valor={coorteVazia ? null : valor}
                    unidade={valor === 1 ? "pessoa" : "pessoas"}
                    motivoVazio={coorteVazia ? "sem coorte, não há o que medir" : "a view não trouxe este dado"}
                    comparacao={fracao !== null ? { delta: `${Math.round(fracao * 100)}%`, sentido: "neutro", contra: etapa.baseDescricao ?? "" } : undefined}
                    visual={fracao !== null ? <ProporcaoMini fracao={fracao} tema={tema} /> : undefined}
                  />
                );
              })}
            </div>
          </section>

          {/* -------------------------------------------------------- funil */}
          <Cartao rotulo="Funil da coorte" titulo="De quem entrou a quem contratou a holding" descricao="Cada barra é um subconjunto da anterior. A taxa ao lado é a passagem entre etapas vizinhas; a segunda, quando aparece, é sobre a coorte inteira.">
            {coorteVazia ? (
              <EstadoVazio compacto titulo="Sem coorte para desenhar" descricao="Esta edição ainda não tem jornada ligada a ela." />
            ) : (
              <FunilEtapas etapas={etapasFunil} tema={tema} rotulo={`Funil da coorte — ${tituloSelecao}`} />
            )}
          </Cartao>

          {/* --------------------------------------------------- preparação */}
          <section aria-labelledby="titulo-preparacao" className="flex flex-col gap-4">
            <div>
              <h2 id="titulo-preparacao" className="text-subtitulo font-bold text-tinta">
                Preparação antes da sessão
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-tinta-suave">Formulário Estratégico (POP 02) e Ligação Estratégica (POP 03) — o que alimenta o Briefing. Base: quem contratou a sessão.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {PREPARACAO.map((item) => {
                const valor = contador(selecionado, item.chave);
                const base = contador(selecionado, item.base);
                const fracao = valor !== null && base !== null && base > 0 ? valor / base : null;
                return (
                  <Kpi
                    key={item.chave}
                    rotulo={item.rotulo}
                    valor={coorteVazia ? null : valor}
                    motivoVazio={coorteVazia ? "sem coorte, não há o que medir" : "a view não trouxe este dado"}
                    comparacao={fracao !== null ? { delta: `${Math.round(fracao * 100)}%`, sentido: "neutro", contra: item.baseDescricao } : undefined}
                    visual={fracao !== null ? <ProporcaoMini fracao={fracao} tema={tema} /> : undefined}
                  />
                );
              })}
            </div>
          </section>

          {/* -------------------------------------------------------- tabela */}
          <Cartao preenchimento="sem" rotulo="Todas as coortes" titulo="Edição por edição" descricao="A mesma leitura, em tabela — uma linha por edição. Em tela estreita a tabela rola de lado; a primeira coluna fica fixa.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse text-sm">
                <caption className="sr-only">Indicadores por edição do seminário</caption>
                <thead>
                  <tr className="border-b border-linha bg-papel text-left">
                    <th scope="col" className="sticky left-0 z-[1] bg-papel px-5 py-3 text-rotulo font-medium uppercase text-tinta-fraca sm:px-6">
                      Edição
                    </th>
                    {COLUNAS_TABELA.map((coluna) => (
                      <th key={coluna.chave} scope="col" className="px-4 py-3 text-right text-rotulo font-medium uppercase text-tinta-fraca">
                        {coluna.rotulo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-linha">
                  {itens.map((item) => {
                    const ativo = edicaoSelecionada === idDaEdicao(item);
                    return (
                      <tr key={idDaEdicao(item)} className={`transition-colors duration-[var(--transicao-rapida)] hover:bg-papel ${ativo ? "bg-latao-fraco" : ""}`}>
                        <th scope="row" className={`sticky left-0 z-[1] px-5 py-3 text-left font-medium text-tinta sm:px-6 ${ativo ? "bg-latao-fraco" : "bg-papel-elevado"}`}>
                          <button type="button" onClick={() => setEdicaoSelecionada(idDaEdicao(item))} aria-pressed={ativo} className="inline-flex min-h-11 items-center gap-2 text-left underline-offset-4 hover:underline">
                            {nomeDaEdicao(item)}
                            {item.edicao_codigo && <span className="text-legenda uppercase tracking-wide text-tinta-fraca">{item.edicao_codigo}</span>}
                          </button>
                        </th>
                        {COLUNAS_TABELA.map((coluna) => {
                          const valor = contador(item, coluna.chave);
                          return (
                            <td key={coluna.chave} className={`px-4 py-3 text-right tabular-nums ${valor === null ? "text-tinta-fraca" : "text-tinta"}`}>
                              {valor === null ? "—" : valor}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Cartao>
        </>
      )}
    </div>
  );
}
