"use client";

import { useRef, useState } from "react";
import { buscarUrlAssinadaDocumento, enviarDocumento, ApiError, type Documento } from "@/lib/api";
import { formatarDataHora } from "@/lib/formatar";
import { Botao } from "@/components/ui/Botao";
import { EstadoVazio } from "@/components/ui/Estado";

const ROTULOS_TIPO: Record<Documento["tipo"], string> = {
  imposto_renda: "Imposto de Renda",
  contrato_social: "Contrato social",
  matricula_imovel: "Matrícula de imóvel",
  outro: "Outro",
};

const MIME_ACEITOS = ["application/pdf", "image/jpeg", "image/png"];
const TAMANHO_MAX = 20 * 1024 * 1024;

function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [tipoSelecionado, setTipoSelecionado] = useState<Documento["tipo"]>("imposto_renda");
  const [progresso, setProgresso] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastandoSobre, setArrastandoSobre] = useState(false);
  const [urlAbertaId, setUrlAbertaId] = useState<string | null>(null);
  const [urlAtual, setUrlAtual] = useState<{ url: string; expiraEm: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      await enviarDocumento(pessoaId, jornadaId, arquivo, tipoSelecionado, setProgresso);
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
    <div className="flex flex-col gap-5">
      <p role="note" className="rounded-sm border border-linha bg-papel-fundo px-3 py-2 text-xs text-tinta-suave">
        Documento com dado pessoal sensível (IR, contrato social). Fica em armazenamento privado; a visualização usa link assinado de 5 minutos, e todo acesso é registrado.
      </p>

      <div className="flex flex-col gap-2">
        <label htmlFor="tipo-documento" className="text-sm font-medium text-tinta">Tipo de documento a enviar</label>
        <select id="tipo-documento" value={tipoSelecionado} onChange={(e) => setTipoSelecionado(e.target.value as Documento["tipo"])} className="w-fit rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm">
          {Object.entries(ROTULOS_TIPO).map(([v, r]) => (
            <option key={v} value={v}>{r}</option>
          ))}
        </select>

        <div
          onDragOver={(e) => { e.preventDefault(); setArrastandoSobre(true); }}
          onDragLeave={() => setArrastandoSobre(false)}
          onDrop={(e) => { e.preventDefault(); setArrastandoSobre(false); processarArquivo(e.dataTransfer.files[0]); }}
          className={`flex flex-col items-center gap-2 rounded-sm border-2 border-dashed px-6 py-8 text-center text-sm ${arrastandoSobre ? "border-[color:var(--latao)] bg-[color:var(--latao-fraco)]" : "border-linha-forte text-tinta-suave"}`}
        >
          <p>Arraste o arquivo aqui, ou</p>
          <Botao variante="secundario" onClick={() => inputRef.current?.click()}>Escolher arquivo</Botao>
          <input ref={inputRef} type="file" accept={MIME_ACEITOS.join(",")} className="sr-only" onChange={(e) => processarArquivo(e.target.files?.[0])} />
          <p className="text-xs text-tinta-fraca">PDF, JPEG ou PNG · até 20 MB</p>
        </div>

        {progresso !== null && (
          <div role="progressbar" aria-valuenow={progresso} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-full overflow-hidden rounded-full bg-papel-fundo">
            <div className="h-full bg-[color:var(--latao)] transition-all" style={{ width: `${progresso}%` }} />
          </div>
        )}
        {erro && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erro}</p>}
      </div>

      {documentosIniciais.length === 0 ? (
        <EstadoVazio titulo="Nenhum documento enviado" />
      ) : (
        <ul className="flex flex-col gap-2">
          {documentosIniciais.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-linha bg-papel-fundo px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-tinta">{doc.nome_arquivo}</p>
                <p className="text-xs text-tinta-fraca">{ROTULOS_TIPO[doc.tipo]} · {formatarTamanho(doc.tamanho_bytes)} · enviado em {formatarDataHora(doc.criado_em)}</p>
              </div>
              {urlAbertaId === doc.id && urlAtual ? (
                <a href={urlAtual.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-[color:var(--latao)] underline">
                  Abrir (expira {formatarDataHora(urlAtual.expiraEm)})
                </a>
              ) : (
                <Botao variante="fantasma" className="text-xs" onClick={() => abrirUrl(doc)}>
                  Gerar link de visualização
                </Botao>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
