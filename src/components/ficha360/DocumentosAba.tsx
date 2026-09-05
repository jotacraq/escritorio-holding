"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { buscarUrlAssinadaDocumento, enviarDocumento, ApiError, type Documento } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { formatarDataHora } from "@/lib/formatar";
import { Botao } from "@/components/ui/Botao";
import { EstadoVazio } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import type { DocumentoTipoRadar, ItemRadar } from "@/types/jornada-automacoes";
import { buscarRadar } from "./api-fase5";

const ROTULOS_TIPO: Record<DocumentoTipoRadar, string> = {
  imposto_renda: "Imposto de Renda",
  contrato_social: "Contrato social",
  matricula_imovel: "Matrícula de imóvel",
  certidao_casamento: "Certidão de casamento",
  certidao_nascimento: "Certidão de nascimento",
  crlv: "Documento do veículo",
  extrato_investimento: "Extrato de investimento",
  balanco: "Balanço",
  comprovante_residencia: "Comprovante de residência",
  outro: "Outro",
};

const MIME_ACEITOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANHO_MAX = 20 * 1024 * 1024;

/** Valor do seletor quando o documento não pertence a nenhum item do radar. */
const SEM_ITEM = "__sem_item__";

function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Documentos da jornada, Fase 5.
 *
 * O que mudou: o upload passa a gravar **`documentos.item_ref`** (coluna da
 * 0065). Sem isso, o radar (`src/lib/radar/derivar.ts`) não consegue casar
 * três matrículas soltas com três imóveis — o casamento lá é exato ou não
 * existe, de propósito — e o item continuava "a pedir" com o arquivo já no
 * Storage. Era a pendência que o M2 deixou explicitamente para esta tela.
 *
 * A pergunta "de qual item é este documento?" é o seletor principal, e as
 * opções são o próprio radar: escolher "Matrícula · Apartamento" define de uma
 * vez o `tipo` e o `item_ref`. "Outro documento" continua existindo, com o
 * seletor de tipo — nada foi tirado de quem envia algo fora da lista.
 */
export function DocumentosAba({
  jornadaId,
  pessoaId,
  documentosIniciais,
  aoAtualizar,
}: {
  jornadaId: string;
  pessoaId: string;
  documentosIniciais: Documento[];
  aoAtualizar: () => void;
}) {
  const buscar = useCallback(() => buscarRadar(jornadaId), [jornadaId]);
  const { dados: radar } = useRecurso(buscar, [jornadaId]);

  const itensDeColeta = useMemo<ItemRadar[]>(
    () => (radar?.estado === "ok" ? radar.dados.itens.filter((i) => i.lado === "coleta") : []),
    [radar],
  );

  const [chaveItem, setChaveItem] = useState<string>(SEM_ITEM);
  const [tipoAvulso, setTipoAvulso] = useState<DocumentoTipoRadar>("outro");
  const [progresso, setProgresso] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastandoSobre, setArrastandoSobre] = useState(false);
  const [urlAbertaId, setUrlAbertaId] = useState<string | null>(null);
  const [urlAtual, setUrlAtual] = useState<{ url: string; expiraEm: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const itemEscolhido = itensDeColeta.find((i) => i.chave === chaveItem) ?? null;
  const tipoParaEnvio: DocumentoTipoRadar = itemEscolhido?.tipo ?? tipoAvulso;

  async function processarArquivo(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    if (!MIME_ACEITOS.includes(arquivo.type)) {
      setErro("Formato não aceito. Envie PDF, JPEG ou PNG.");
      return;
    }
    if (arquivo.size > TAMANHO_MAX) {
      setErro("Arquivo maior que 20 MB.");
      return;
    }
    setProgresso(0);
    try {
      await enviarDocumento(pessoaId, jornadaId, arquivo, tipoParaEnvio, setProgresso, itemEscolhido?.item_ref ?? null);
      aoAtualizar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Falha no envio do documento.");
    } finally {
      setProgresso(null);
    }
  }

  async function abrirUrl(documento: Documento) {
    setUrlAbertaId(documento.id);
    setUrlAtual(null);
    try {
      const res = await buscarUrlAssinadaDocumento(documento.id);
      setUrlAtual({ url: res.url, expiraEm: res.expira_em });
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível gerar o link de visualização.");
      setUrlAbertaId(null);
    }
  }

  return (
    <div className="flex flex-col gap-cartao">
      <p
        role="note"
        title="Bucket privado, link assinado de 5 minutos, todo acesso registrado em auditoria."
        className="text-xs text-tinta-suave"
      >
        Dado sensível · acesso registrado
      </p>

      <div className="flex flex-col gap-item">
        <label htmlFor="item-documento" className="text-sm font-medium text-tinta">
          De qual item é este documento?
        </label>
        <select
          id="item-documento"
          value={chaveItem}
          onChange={(e) => setChaveItem(e.target.value)}
          className="w-full max-w-md rounded-controle border border-linha-controle bg-papel-elevado px-2.5 py-2 text-sm"
        >
          {itensDeColeta.map((item) => (
            <option key={item.chave} value={item.chave}>
              {item.rotulo}
            </option>
          ))}
          <option value={SEM_ITEM}>Outro documento</option>
        </select>

        {itemEscolhido ? (
          <p className="text-xs text-tinta-fraca">{ROTULOS_TIPO[itemEscolhido.tipo]}</p>
        ) : (
          <>
            <label htmlFor="tipo-documento" className="text-sm font-medium text-tinta">
              Tipo
            </label>
            <select
              id="tipo-documento"
              value={tipoAvulso}
              onChange={(e) => setTipoAvulso(e.target.value as DocumentoTipoRadar)}
              className="w-full max-w-md rounded-controle border border-linha-controle bg-papel-elevado px-2.5 py-2 text-sm"
            >
              {(Object.keys(ROTULOS_TIPO) as DocumentoTipoRadar[]).map((v) => (
                <option key={v} value={v}>
                  {ROTULOS_TIPO[v]}
                </option>
              ))}
            </select>
          </>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastandoSobre(true);
          }}
          onDragLeave={() => setArrastandoSobre(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastandoSobre(false);
            processarArquivo(e.dataTransfer.files[0]);
          }}
          className={`flex flex-col items-center gap-2 rounded-controle border-2 border-dashed px-6 py-8 text-center text-sm ${arrastandoSobre ? "border-[color:var(--latao)] bg-[color:var(--latao-fraco)]" : "border-linha-forte text-tinta-suave"}`}
        >
          <Botao variante="secundario" onClick={() => inputRef.current?.click()}>
            Escolher arquivo
          </Botao>
          <input
            ref={inputRef}
            type="file"
            accept={MIME_ACEITOS.join(",")}
            className="sr-only"
            aria-label={`Enviar arquivo — ${itemEscolhido?.rotulo ?? ROTULOS_TIPO[tipoAvulso]}`}
            onChange={(e) => processarArquivo(e.target.files?.[0])}
          />
          <p className="text-xs text-tinta-fraca">PDF, JPEG ou PNG · até 20 MB</p>
        </div>

        {progresso !== null && (
          <div role="progressbar" aria-valuenow={progresso} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-full overflow-hidden rounded-full bg-papel-fundo">
            <div className="h-full bg-[color:var(--latao)] transition-all" style={{ width: `${progresso}%` }} />
          </div>
        )}
        {erro && (
          <p role="alert" className="text-sm text-[color:var(--vermelho)]">
            {erro}
          </p>
        )}
      </div>

      {documentosIniciais.length === 0 ? (
        <EstadoVazio titulo="Nenhum documento enviado" />
      ) : (
        <ul className="flex flex-col gap-item">
          {documentosIniciais.map((doc) => {
            const item = doc.item_ref ? itensDeColeta.find((i) => i.item_ref === doc.item_ref && i.tipo === doc.tipo) : null;
            return (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-controle border border-linha bg-papel-fundo px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-tinta">{doc.nome_arquivo}</p>
                  <p className="text-xs text-tinta-fraca">
                    {ROTULOS_TIPO[doc.tipo] ?? doc.tipo} · {formatarTamanho(doc.tamanho_bytes)} · {formatarDataHora(doc.criado_em)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {item && <Selo tom="verde">{item.rotulo}</Selo>}
                  {doc.item_ref === null && <Selo tom="neutro" title="Sem item: o radar não consegue casar este arquivo com um bem ou familiar.">Sem item</Selo>}
                  {urlAbertaId === doc.id && urlAtual ? (
                    <a href={urlAtual.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-xs font-medium text-[color:var(--latao)] underline">
                      Abrir · expira {formatarDataHora(urlAtual.expiraEm)}
                    </a>
                  ) : (
                    <Botao variante="fantasma" tamanho="compacto" onClick={() => abrirUrl(doc)}>
                      Ver arquivo
                    </Botao>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
