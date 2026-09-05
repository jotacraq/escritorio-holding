"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { Campo, Selecao } from "@/components/ui/Campo";
import { Passos } from "@/components/ui/Passos";
import { Progresso } from "@/components/ui/Progresso";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { useToast } from "@/hooks/useToast";
import type { Importacao, MapaColunas } from "@/types/importacao";
import { ApiError, criarImportacao, listarImportacoes } from "./api";
import { PASSOS_IMPORTACAO, ROTULO_CAMPO, formatarTamanho, rotuloPergunta, type PassoImportacao } from "./campos";
import { SeletorEdicao } from "./SeletorEdicao";
import { MapeamentoColunas } from "./MapeamentoColunas";
import { lerAmostraCsv, type CsvAmostra } from "./csvCliente";

const TAMANHO_MAXIMO_AVISO_BYTES = 5 * 1024 * 1024; // 5 MiB — valor inicial padrão do backend (config.ts), só um aviso, quem barra de verdade é o servidor.

type Etapa = Exclude<PassoImportacao, "confirmar"> | "enviando";

const ETAPAS_ENVIO = [{ rotulo: "Enviando o arquivo" }, { rotulo: "Lendo as linhas no servidor" }, { rotulo: "Classificando cada pessoa" }];

/**
 * Assistente em passos (§1 do briefing da Fase 2 + Fase 4 "onde estou"):
 * 1) escolher edição + subir CSV; 2) casar coluna→destino; 3) conferir uma
 * amostra com o mapeamento aplicado; só ENTÃO o arquivo vai ao servidor e
 * vira prévia. O 4º passo (confirmar) mora na tela de detalhe, porque a
 * prévia já é uma `Importacao` gravada com `id` e pode ser reaberta depois
 * (reload, voltar mais tarde) sem perder o trabalho de mapeamento.
 */
export function AssistenteImportacao({ aoCriada }: { aoCriada: (importacao: Importacao) => void }) {
  const { notificar } = useToast();
  const [etapa, setEtapa] = useState<Etapa>("arquivo");
  const [edicaoId, setEdicaoId] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [amostra, setAmostra] = useState<CsvAmostra | null>(null);
  const [mapa, setMapa] = useState<MapaColunas>({});
  const [perguntas, setPerguntas] = useState<string[]>([]);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [progresso, setProgresso] = useState(0);
  const [processando, setProcessando] = useState(false);
  const [mapasAnteriores, setMapasAnteriores] = useState<Importacao[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!edicaoId) return;
    let vivo = true;
    listarImportacoes({ edicao_id: edicaoId, pagina: 1 })
      .then((resposta) => {
        if (vivo) setMapasAnteriores(resposta.itens.filter((i) => Object.keys(i.mapa_colunas).length > 0));
      })
      .catch(() => {
        /* atalho de conveniência — falha aqui não impede seguir o mapeamento do zero */
      });
    return () => {
      vivo = false;
    };
  }, [edicaoId]);

  const aoEscolherArquivo = useCallback(async (arquivoEscolhido: File | null) => {
    setErroLeitura(null);
    setArquivo(arquivoEscolhido);
    if (!arquivoEscolhido) {
      setAmostra(null);
      return;
    }
    try {
      const lida = await lerAmostraCsv(arquivoEscolhido);
      if (lida.cabecalho.length === 0) {
        setAmostra(null);
        setErroLeitura("Não achei nenhuma coluna no arquivo. Confira se é um CSV válido — na planilha, use “Salvar como → CSV”.");
        return;
      }
      setAmostra(lida);
      setMapa({});
      setPerguntas([]);
    } catch {
      setAmostra(null);
      setErroLeitura("Não consegui ler este arquivo no navegador. Tente exportar de novo em CSV.");
    }
  }, []);

  function aoSoltar(evento: DragEvent<HTMLLabelElement>) {
    evento.preventDefault();
    setArrastando(false);
    if (!edicaoId) return;
    const solto = evento.dataTransfer.files?.[0] ?? null;
    if (solto) void aoEscolherArquivo(solto);
  }

  function reusarMapa(importacaoAnteriorId: string) {
    const anterior = mapasAnteriores.find((i) => i.id === importacaoAnteriorId);
    if (!anterior || !amostra) return;
    const proximo: MapaColunas = {};
    const proximasPerguntas: string[] = [];
    for (const coluna of amostra.cabecalho) {
      if (anterior.mapa_colunas[coluna]) proximo[coluna] = anterior.mapa_colunas[coluna];
      else if (anterior.perguntas_seminario?.includes(coluna)) proximasPerguntas.push(coluna);
    }
    setMapa(proximo);
    setPerguntas(proximasPerguntas);
    notificar({ tom: "info", titulo: "Mapeamento reaproveitado", descricao: `${Object.keys(proximo).length + proximasPerguntas.length} colunas casadas a partir de “${anterior.arquivo_nome}”.` });
  }

  const nomeMapeado = Object.values(mapa).includes("nome");
  const podeMapear = Boolean(edicaoId && arquivo && amostra);
  const podeConferir = podeMapear && nomeMapeado;
  const passoAtual: PassoImportacao = etapa === "enviando" ? "conferir" : etapa;

  function irPara(id: string) {
    if (etapa === "enviando") return;
    const alvo = id as PassoImportacao;
    if (alvo === "arquivo") setEtapa("arquivo");
    if (alvo === "mapear" && podeMapear) setEtapa("mapear");
    if (alvo === "conferir" && podeConferir) setEtapa("conferir");
  }

  async function enviar() {
    if (!arquivo || !edicaoId) return;
    setErroEnvio(null);
    setEtapa("enviando");
    setProgresso(0);
    setProcessando(false);
    try {
      const resposta = await criarImportacao({ arquivo, edicaoId, mapaColunas: mapa, perguntasSeminario: perguntas }, (percentual) => {
        setProgresso(percentual);
        if (percentual >= 100) setProcessando(true);
      });
      notificar({ tom: "sucesso", titulo: "Prévia gerada", descricao: "Nada foi gravado ainda. Confira o que entra e confirme." });
      aoCriada(resposta.importacao);
    } catch (e) {
      const mensagem = e instanceof ApiError ? e.message : "Não foi possível enviar o arquivo. Confira a internet e tente de novo.";
      setErroEnvio(mensagem);
      notificar({ tom: "erro", titulo: "Não deu para gerar a prévia", descricao: mensagem });
      setEtapa("conferir");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Passos passos={[...PASSOS_IMPORTACAO]} atual={passoAtual} aoEscolher={irPara} rotulo="Etapas da importação" />

      {/* ------------------------------------------------------ 1 · arquivo */}
      {etapa === "arquivo" && (
        <Cartao rotulo="Passo 1 de 4" titulo="Enviar arquivo" descricao="Nada sai do seu computador neste passo: só o cabeçalho e cinco linhas de amostra são lidos aqui, para montar o mapeamento.">
          <div className="flex flex-col gap-5">
            <SeletorEdicao valor={edicaoId} aoMudar={setEdicaoId} />

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-tinta" id="rotulo-arquivo-csv">
                Arquivo CSV <span className="text-[color:var(--latao)]" aria-hidden="true">*</span>
              </span>
              <p id="arquivo-csv-ajuda" className="text-xs text-tinta-suave">
                Exportado da planilha em CSV — separador vírgula ou ponto e vírgula, UTF-8 ou Windows-1252, tanto faz.
              </p>
              <label
                htmlFor="arquivo-csv"
                onDragOver={(e) => {
                  e.preventDefault();
                  if (edicaoId) setArrastando(true);
                }}
                onDragLeave={() => setArrastando(false)}
                onDrop={aoSoltar}
                className={`flex min-h-[7.5rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-controle border-2 border-dashed px-4 py-6 text-center transition-[border-color,background-color] duration-[var(--transicao-rapida)] has-[:focus-visible]:shadow-foco ${
                  !edicaoId
                    ? "cursor-not-allowed border-linha bg-papel text-tinta-fraca"
                    : arrastando
                      ? "border-[color:var(--latao)] bg-latao-fraco"
                      : "border-linha-controle bg-papel-elevado hover:border-[color:var(--latao)] hover:bg-papel"
                }`}
              >
                <input
                  ref={inputArquivoRef}
                  id="arquivo-csv"
                  type="file"
                  accept=".csv,text/csv"
                  disabled={!edicaoId}
                  onChange={(e) => void aoEscolherArquivo(e.target.files?.[0] ?? null)}
                  className="sr-only"
                  aria-labelledby="rotulo-arquivo-csv"
                  aria-describedby="arquivo-csv-ajuda"
                />
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 text-[color:var(--latao)]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 16V4m0 0-4 4m4-4 4 4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                </svg>
                {arquivo && amostra ? (
                  <span className="flex flex-col items-center gap-1">
                    <span className="text-sm font-bold text-tinta">{arquivo.name}</span>
                    <span className="text-xs text-tinta-suave">
                      {formatarTamanho(arquivo.size)} · {amostra.cabecalho.length} colunas · {amostra.totalLinhas} linha{amostra.totalLinhas === 1 ? "" : "s"} de dado
                    </span>
                    <span className="text-xs text-[color:var(--latao)] underline underline-offset-4">Trocar arquivo</span>
                  </span>
                ) : (
                  <span className="flex flex-col items-center gap-1">
                    <span className="text-sm font-bold text-tinta">{edicaoId ? "Escolher o arquivo CSV" : "Escolha a edição primeiro"}</span>
                    <span className="text-xs text-tinta-suave">{edicaoId ? "ou arraste e solte aqui" : "o arquivo só pode ser lido depois de saber a edição de origem"}</span>
                  </span>
                )}
              </label>
              {erroLeitura && (
                <p role="alert" className="text-xs font-medium text-[color:var(--vermelho)]">
                  {erroLeitura}
                </p>
              )}
              {arquivo && arquivo.size > TAMANHO_MAXIMO_AVISO_BYTES && (
                <p className="text-xs text-[color:var(--ambar)]">
                  Arquivo com {formatarTamanho(arquivo.size)} — acima dos 5 MB configurados hoje. O servidor pode recusar; se precisar de um teto maior, ajuste em Admin → Configurações.
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <Botao variante="primario" disabled={!podeMapear} onClick={() => setEtapa("mapear")}>
                Mapear colunas
              </Botao>
            </div>
          </div>
        </Cartao>
      )}

      {/* ------------------------------------------------------ 2 · mapear */}
      {etapa === "mapear" && amostra && (
        <Cartao
          rotulo="Passo 2 de 4"
          titulo="Mapear colunas"
          descricao="Para cada coluna do arquivo, diga o que ela vira no sistema. Só o nome é obrigatório; o resto enriquece o cadastro e o Briefing."
          acao={
            mapasAnteriores.length > 0 ? (
              <Campo rotulo="Reaproveitar mapeamento" className="min-w-[14rem]">
                <Selecao defaultValue="" onChange={(e) => e.target.value && reusarMapa(e.target.value)}>
                  <option value="">de uma importação anterior…</option>
                  {mapasAnteriores.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.arquivo_nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-5">
            <MapeamentoColunas
              cabecalho={amostra.cabecalho}
              linhasAmostra={amostra.linhasAmostra}
              mapa={mapa}
              perguntas={perguntas}
              aoMudarMapa={setMapa}
              aoMudarPerguntas={setPerguntas}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Botao variante="fantasma" onClick={() => setEtapa("arquivo")}>
                Voltar
              </Botao>
              <Botao variante="primario" disabled={!podeConferir} onClick={() => setEtapa("conferir")}>
                Conferir amostra
              </Botao>
            </div>
          </div>
        </Cartao>
      )}

      {/* ---------------------------------------------- 3 · conferir / enviar */}
      {(etapa === "conferir" || etapa === "enviando") && amostra && arquivo && (
        <Cartao rotulo="Passo 3 de 4" titulo="Conferir" descricao="Assim ficam as primeiras linhas com o mapeamento aplicado. Se estiver certo, gere a prévia — o arquivo inteiro vai ao servidor, mas nada é gravado em pessoas ou jornadas ainda.">
          <div className="flex flex-col gap-5">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-rotulo font-medium uppercase text-tinta-fraca">Arquivo</dt>
                <dd className="mt-0.5 break-all font-medium text-tinta">{arquivo.name}</dd>
                <dd className="text-xs text-tinta-suave">{formatarTamanho(arquivo.size)} · {amostra.totalLinhas} linha{amostra.totalLinhas === 1 ? "" : "s"} de dado (contagem do navegador; a oficial vem do servidor)</dd>
              </div>
              <div>
                <dt className="text-rotulo font-medium uppercase text-tinta-fraca">Campos do cadastro</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {Object.entries(mapa).map(([coluna, campo]) => (
                    <Selo key={coluna} tom={campo === "nome" ? "verde" : "neutro"}>
                      {coluna} → {ROTULO_CAMPO[campo].replace(" (obrigatório)", "")}
                    </Selo>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-rotulo font-medium uppercase text-tinta-fraca">Respostas do seminário</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {perguntas.length === 0 ? (
                    <span className="text-tinta-fraca">nenhuma coluna marcada</span>
                  ) : (
                    perguntas.map((coluna) => (
                      <Selo key={coluna} tom="latao">
                        {rotuloPergunta(coluna)}
                      </Selo>
                    ))
                  )}
                </dd>
              </div>
            </dl>

            {perguntas.length > 0 && (
              <SeloStub texto="A gravação das respostas do seminário depende do servidor desta versão estar com o recurso ligado. Se ainda não estiver, as colunas continuam guardadas no rastro de cada linha — nada se perde, e a tela de detalhe mostra o que foi gravado." />
            )}

            <PreviaAmostra amostra={amostra} mapa={mapa} perguntas={perguntas} />

            {erroEnvio && (
              <p role="alert" className="rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-3.5 py-2.5 text-sm text-[color:var(--vermelho)]">
                {erroEnvio}
              </p>
            )}

            {etapa === "enviando" ? (
              <Progresso
                rotulo={processando ? "Arquivo enviado. Gerando a prévia no servidor…" : "Enviando o arquivo…"}
                valor={processando ? undefined : progresso}
                etapas={ETAPAS_ENVIO}
                etapaAtual={processando ? 1 : 0}
                tempoEsperado="costuma levar alguns segundos; arquivos grandes, até um minuto"
                cronometro
              />
            ) : (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Botao variante="fantasma" onClick={() => setEtapa("mapear")}>
                  Voltar ao mapeamento
                </Botao>
                <Botao variante="primario" onClick={enviar}>
                  Gerar prévia
                </Botao>
              </div>
            )}
          </div>
        </Cartao>
      )}
    </div>
  );
}

/** As linhas de amostra com só as colunas mapeadas — "é isto que o sistema vai ler". */
function PreviaAmostra({ amostra, mapa, perguntas }: { amostra: CsvAmostra; mapa: MapaColunas; perguntas: string[] }) {
  const colunas = amostra.cabecalho
    .map((coluna, indice) => ({ coluna, indice, destino: mapa[coluna] ? ROTULO_CAMPO[mapa[coluna]].replace(" (obrigatório)", "") : perguntas.includes(coluna) ? rotuloPergunta(coluna) : null }))
    .filter((c) => c.destino !== null);

  if (colunas.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-controle border border-linha">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="sr-only">Amostra das primeiras linhas com o mapeamento aplicado</caption>
        <thead>
          <tr className="border-b border-linha bg-papel text-left">
            <th scope="col" className="px-4 py-3 text-rotulo font-medium uppercase text-tinta-fraca">
              #
            </th>
            {colunas.map((c) => (
              <th key={c.coluna} scope="col" className="px-4 py-3 text-rotulo font-medium uppercase text-tinta-fraca">
                {c.destino}
                <span className="block text-legenda normal-case tracking-normal text-tinta-fraca">{c.coluna}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-linha">
          {amostra.linhasAmostra.map((linha, i) => (
            <tr key={i} className="align-top">
              <td className="px-4 py-2.5 tabular-nums text-tinta-fraca">{i + 1}</td>
              {colunas.map((c) => (
                <td key={c.coluna} className="px-4 py-2.5 text-tinta">
                  {linha[c.indice]?.trim() || <span className="text-tinta-fraca">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
