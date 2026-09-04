"use client";

import { useEffect, useState } from "react";
import { Botao } from "@/components/ui/Botao";
import type { Importacao, MapaColunas } from "@/types/importacao";
import { ApiError, criarImportacao, listarImportacoes } from "./api";
import { SeletorEdicao } from "./SeletorEdicao";
import { MapeamentoColunas } from "./MapeamentoColunas";
import { lerAmostraCsv, type CsvAmostra } from "./csvCliente";

const TAMANHO_MAXIMO_AVISO_BYTES = 5 * 1024 * 1024; // 5 MiB — valor inicial padrão do backend (config.ts), só um aviso, quem barra de verdade é o servidor.

type Etapa = "arquivo" | "mapear" | "enviando";

/**
 * Assistente de duas fases (§1 do briefing): 1) escolher edição + subir CSV +
 * casar coluna→campo; 2) só DEPOIS disso existe prévia — esta tela cuida só
 * da fase 1. A fase 2 (ver o estrago, confirmar) mora na tela de detalhe,
 * porque a prévia já é uma `Importacao` gravada com `id` e pode ser reaberta
 * depois (reload, voltar mais tarde) sem perder o trabalho de mapeamento.
 */
export function AssistenteImportacao({ aoCriada }: { aoCriada: (importacao: Importacao) => void }) {
  const [etapa, setEtapa] = useState<Etapa>("arquivo");
  const [edicaoId, setEdicaoId] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [amostra, setAmostra] = useState<CsvAmostra | null>(null);
  const [mapa, setMapa] = useState<MapaColunas>({});
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [progresso, setProgresso] = useState(0);
  const [processando, setProcessando] = useState(false);
  const [mapasAnteriores, setMapasAnteriores] = useState<Importacao[]>([]);

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

  async function aoEscolherArquivo(arquivoEscolhido: File | null) {
    setErroLeitura(null);
    setArquivo(arquivoEscolhido);
    if (!arquivoEscolhido) {
      setAmostra(null);
      return;
    }
    try {
      const lida = await lerAmostraCsv(arquivoEscolhido);
      if (lida.cabecalho.length === 0) {
        setErroLeitura("Não achei nenhuma coluna no arquivo. Confira se é um CSV válido.");
        return;
      }
      setAmostra(lida);
      setMapa({});
      setEtapa("mapear");
    } catch {
      setErroLeitura("Não consegui ler este arquivo no navegador. Tente exportar de novo em CSV.");
    }
  }

  function reusarMapa(importacaoAnteriorId: string) {
    const anterior = mapasAnteriores.find((i) => i.id === importacaoAnteriorId);
    if (!anterior || !amostra) return;
    const proximo: MapaColunas = {};
    for (const coluna of amostra.cabecalho) {
      if (anterior.mapa_colunas[coluna]) proximo[coluna] = anterior.mapa_colunas[coluna];
    }
    setMapa(proximo);
  }

  const nomeMapeado = Object.values(mapa).includes("nome");
  const podeEnviar = Boolean(edicaoId && arquivo && amostra && nomeMapeado);

  async function enviar() {
    if (!arquivo || !edicaoId) return;
    setErroEnvio(null);
    setEtapa("enviando");
    setProgresso(0);
    setProcessando(false);
    try {
      const resposta = await criarImportacao({ arquivo, edicaoId, mapaColunas: mapa }, (percentual) => {
        setProgresso(percentual);
        if (percentual >= 100) setProcessando(true);
      });
      aoCriada(resposta.importacao);
    } catch (e) {
      setErroEnvio(e instanceof ApiError ? e.message : "Não foi possível enviar o arquivo. Tente de novo.");
      setEtapa("mapear");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-sm border border-linha bg-papel-elevado p-4">
        <SeletorEdicao valor={edicaoId} aoMudar={setEdicaoId} />

        <label className="flex flex-col gap-1 text-sm" htmlFor="arquivo-csv">
          Arquivo CSV
          <input
            id="arquivo-csv"
            type="file"
            accept=".csv,text/csv"
            disabled={!edicaoId || etapa === "enviando"}
            onChange={(e) => aoEscolherArquivo(e.target.files?.[0] ?? null)}
            className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm file:mr-3 file:rounded-sm file:border-0 file:bg-[color:var(--latao-fraco)] file:px-2.5 file:py-1 file:text-tinta"
            aria-describedby="arquivo-csv-ajuda"
          />
        </label>
        <p id="arquivo-csv-ajuda" className="text-xs text-tinta-fraca">
          Aceita separador vírgula ou ponto e vírgula, UTF-8 ou planilha exportada em Windows-1252. Só a leitura do
          cabeçalho acontece aqui no navegador — o arquivo inteiro só é processado depois de você mapear as colunas.
        </p>
        {!edicaoId && <p className="text-xs text-tinta-fraca">Escolha a edição do seminário antes de escolher o arquivo.</p>}
        {erroLeitura && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erroLeitura}</p>}
        {arquivo && arquivo.size > TAMANHO_MAXIMO_AVISO_BYTES && (
          <p className="text-xs text-[color:var(--ambar)]">
            Arquivo com {(arquivo.size / (1024 * 1024)).toFixed(1)} MB — acima do valor inicial de 5 MB configurado hoje.
            O envio pode ser recusado pelo servidor; ajuste em Admin se precisar de um teto maior.
          </p>
        )}
      </div>

      {amostra && (etapa === "mapear" || etapa === "enviando") && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-lg font-bold text-tinta">Casar coluna do arquivo com campo do sistema</h2>
            {mapasAnteriores.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-tinta-suave" htmlFor="reusar-mapa">
                Reusar mapa de:
                <select
                  id="reusar-mapa"
                  defaultValue=""
                  onChange={(e) => e.target.value && reusarMapa(e.target.value)}
                  className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1"
                >
                  <option value="">selecionar…</option>
                  {mapasAnteriores.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.arquivo_nome}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <p className="text-sm text-tinta-suave">
            {amostra.totalLinhas} linha{amostra.totalLinhas === 1 ? "" : "s"} de dado encontrada
            {amostra.totalLinhas === 1 ? "" : "s"} no arquivo (contagem lida aqui no navegador; a prévia oficial vem do
            servidor no próximo passo).
          </p>

          <MapeamentoColunas cabecalho={amostra.cabecalho} linhasAmostra={amostra.linhasAmostra} mapa={mapa} aoMudarMapa={setMapa} />

          {erroEnvio && (
            <p role="alert" className="rounded-sm border border-vermelho-fraco bg-vermelho-fraco px-2.5 py-1.5 text-sm text-[color:var(--vermelho)]">
              {erroEnvio}
            </p>
          )}

          {etapa === "enviando" ? (
            <div role="status" aria-live="polite" className="flex flex-col gap-2 rounded-sm border border-linha bg-papel-fundo p-3 text-sm">
              <div className="flex items-center justify-between">
                <span>{processando ? "Arquivo enviado. Processando a prévia no servidor…" : `Enviando arquivo… ${progresso}%`}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-linha">
                <div
                  className={`h-full bg-[color:var(--latao)] transition-[width] ${processando ? "animate-pulse" : ""}`}
                  style={{ width: `${processando ? 100 : progresso}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <Botao variante="fantasma" onClick={() => setEtapa("arquivo")}>
                Trocar arquivo
              </Botao>
              <Botao variante="primario" disabled={!podeEnviar} onClick={enviar}>
                Gerar prévia
              </Botao>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
