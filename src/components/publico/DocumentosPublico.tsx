"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { DocumentoRecebidoPublico, TipoDocumentoPublico } from "@/types/publico-ui";
import { abrirLinkDocumentos, conferirTipo, enviarDocumentoPublico, ErroLinkPublico } from "@/components/publico/cliente";
import { useRecurso } from "@/hooks/useRecurso";
import { CarregandoPublico, ErroTemporarioPublico } from "@/components/publico/CarregandoPublico";
import { TelaLinkInvalido } from "@/components/publico/TelaLinkInvalido";
import { formatarData } from "@/lib/formatar";
import { CartaoPublico, RotuloPublico } from "@/components/publico/atomos";

interface EnvioEmAndamento {
  id: string;
  nome: string;
  percentual: number;
  erro: string | null;
}

function validarArquivo(arquivo: File, extensoesAceitas: string[], tamanhoMaximoMb: number): string | null {
  const extensao = arquivo.name.split(".").pop()?.toLowerCase() ?? "";
  if (extensoesAceitas.length > 0 && !extensoesAceitas.includes(extensao)) {
    return `Tipo de arquivo não aceito (.${extensao || "?"}). Aceitamos: ${extensoesAceitas.map((e) => `.${e}`).join(", ")}.`;
  }
  const tamanhoMaximoBytes = tamanhoMaximoMb * 1024 * 1024;
  if (arquivo.size > tamanhoMaximoBytes) {
    return `Arquivo maior que ${tamanhoMaximoMb} MB. Tente uma versão menor ou uma foto em vez de escaneamento.`;
  }
  return null;
}

function CartaoTipoDocumento({
  token,
  tipo,
  rotulo,
  obrigatorio,
  recebidos,
  extensoesAceitas,
  tamanhoMaximoMb,
  bloqueado,
  motivoBloqueio,
  aoReceber,
}: {
  token: string;
  /**
   * O que o servidor espera de volta no upload: a **chave opaca** do item do
   * radar (0068), não o tipo do documento. É `string` de propósito — o valor é
   * emitido pelo servidor e devolvido intacto; o navegador nunca escolhe.
   */
  tipo: string;
  rotulo: string;
  obrigatorio: boolean;
  recebidos: DocumentoRecebidoPublico[];
  extensoesAceitas: string[];
  tamanhoMaximoMb: number;
  bloqueado: boolean;
  motivoBloqueio: string | null;
  aoReceber: (doc: DocumentoRecebidoPublico) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastandoSobre, setArrastandoSobre] = useState(false);
  const [envios, setEnvios] = useState<EnvioEmAndamento[]>([]);

  const enviarArquivos = useCallback(
    (arquivos: FileList | File[]) => {
      for (const arquivo of Array.from(arquivos)) {
        const erroValidacao = validarArquivo(arquivo, extensoesAceitas, tamanhoMaximoMb);
        const id = `${arquivo.name}-${arquivo.size}-${Date.now()}`;
        if (erroValidacao) {
          setEnvios((atual) => [...atual, { id, nome: arquivo.name, percentual: 0, erro: erroValidacao }]);
          continue;
        }
        setEnvios((atual) => [...atual, { id, nome: arquivo.name, percentual: 0, erro: null }]);
        enviarDocumentoPublico(token, arquivo, tipo, (percentual) => {
          setEnvios((atual) => atual.map((e) => (e.id === id ? { ...e, percentual } : e)));
        })
          .then((resposta) => {
            setEnvios((atual) => atual.filter((e) => e.id !== id));
            aoReceber(resposta.documento);
          })
          .catch((e) => {
            let mensagem = "Não foi possível enviar. Tente de novo.";
            if (e instanceof ErroLinkPublico) {
              if (e.codigo === "envio_indisponivel") mensagem = "Envio indisponível no momento — a equipe entrará em contato.";
              else if (e.codigo === "arquivo_invalido") mensagem = "Este arquivo não pôde ser aceito. Confira o tipo e tente outro.";
              else if (e.codigo === "limite_excedido") mensagem = "Limite de arquivos deste link atingido.";
            }
            setEnvios((atual) => atual.map((e) => (e.id === id ? { ...e, erro: mensagem } : e)));
          });
      }
    },
    [token, tipo, extensoesAceitas, tamanhoMaximoMb, aoReceber],
  );

  return (
    <CartaoPublico como="section" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-subtitulo font-bold text-tinta">
          {rotulo}
          {obrigatorio && (
            <span aria-hidden="true" className="text-[color:var(--vermelho)]">
              {" "}
              *
            </span>
          )}
        </p>
        {recebidos.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-verde-fraco px-2.5 py-1 text-sm font-medium text-[color:var(--verde)]">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current">
              <path d="M8.5 13.5 4.7 9.7l1.4-1.4 2.4 2.4 5.4-5.4 1.4 1.4z" />
            </svg>
            Recebido
          </span>
        )}
      </div>

      {recebidos.map((doc, i) => (
        <p key={`${doc.nome_arquivo}-${i}`} className="text-sm text-tinta-suave">
          {doc.nome_arquivo} · enviado em {formatarData(doc.enviado_em)}
        </p>
      ))}

      {bloqueado ? (
        <p className="text-sm text-tinta-suave">{motivoBloqueio}</p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setArrastandoSobre(true);
            }}
            onDragLeave={() => setArrastandoSobre(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastandoSobre(false);
              if (e.dataTransfer.files.length > 0) enviarArquivos(e.dataTransfer.files);
            }}
            className={`flex min-h-[3.25rem] flex-col items-center gap-1.5 rounded-controle border-2 border-dashed px-4 py-6 text-center transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao-cta)] ${
              arrastandoSobre ? "border-[color:var(--latao-cta)] bg-latao-fraco" : "border-linha-forte bg-papel"
            }`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-tinta-suave stroke-[1.5]">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14" />
            </svg>
            <span className="text-base font-bold text-tinta">Toque para escolher o arquivo</span>
            <span className="text-sm text-tinta-suave">ou arraste aqui · {extensoesAceitas.map((e) => `.${e}`).join(", ")} · até {tamanhoMaximoMb} MB</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={extensoesAceitas.map((e) => `.${e}`).join(",")}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) enviarArquivos(e.target.files);
              e.target.value = "";
            }}
            className="sr-only"
            aria-label={`Enviar arquivo — ${rotulo}`}
          />
        </>
      )}

      {envios.map((envio) => (
        <div key={envio.id} className="flex flex-col gap-1">
          <p className="truncate text-sm text-tinta-suave">{envio.nome}</p>
          {envio.erro ? (
            <p role="alert" className="text-sm font-medium text-[color:var(--vermelho)]">
              {envio.erro}
            </p>
          ) : (
            <div
              role="progressbar"
              aria-valuenow={envio.percentual}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Enviando ${envio.nome}`}
              className="h-2 w-full overflow-hidden rounded-full bg-linha"
            >
              <div className="h-full rounded-full bg-[color:var(--latao-cta)] transition-[width]" style={{ width: `${envio.percentual}%` }} />
            </div>
          )}
        </div>
      ))}
    </CartaoPublico>
  );
}

export function DocumentosPublico({ token }: { token: string }) {
  const buscar = useCallback(() => abrirLinkDocumentos(token).then((res) => conferirTipo(res, "documentos")), [token]);
  const { dados: abertura, carregando, erro, recarregar } = useRecurso(buscar, [token]);
  const [recebidosAdicionados, setRecebidosAdicionados] = useState<DocumentoRecebidoPublico[]>([]);

  const recebidosLocais = useMemo(
    () => [...(abertura?.payload.recebidos ?? []), ...recebidosAdicionados],
    [abertura, recebidosAdicionados],
  );

  const totalRecebido = recebidosLocais.length;
  const limiteAtingido = abertura ? totalRecebido >= abertura.payload.limite_arquivos : false;

  const porTipo = useMemo(() => {
    const mapa = new Map<TipoDocumentoPublico, DocumentoRecebidoPublico[]>();
    for (const doc of recebidosLocais) {
      if (!mapa.has(doc.tipo)) mapa.set(doc.tipo, []);
      mapa.get(doc.tipo)!.push(doc);
    }
    return mapa;
  }, [recebidosLocais]);

  if (carregando) return <CarregandoPublico />;
  if (erro instanceof ErroLinkPublico && erro.codigo === "link_invalido") return <TelaLinkInvalido />;
  if (erro) return <ErroTemporarioPublico aoTentarNovamente={recarregar} />;
  if (!abertura) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <RotuloPublico>Documentos</RotuloPublico>
        <h1 className="text-tinta">Envio de documentos</h1>
        <p className="text-tinta-suave">Olá, {abertura.primeiro_nome}. Estes são os documentos que a equipe precisa para dar andamento.</p>
      </div>

      <div className="flex items-start gap-2.5 rounded-controle border border-linha-forte bg-papel px-4 py-3 text-sm text-tinta-suave">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 fill-current text-tinta-fraca">
          <path d="M10 2a5 5 0 0 0-5 5v2H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1V7a5 5 0 0 0-5-5Zm-3 7V7a3 3 0 1 1 6 0v2Z" />
        </svg>
        <p>
          São documentos sensíveis (dados pessoais e financeiros). O escritório trata tudo em sigilo — o acesso é restrito à equipe
          responsável pelo seu caso. Até {abertura.payload.limite_arquivos} arquivos no total, {abertura.payload.tamanho_maximo_mb} MB cada,
          nos formatos {abertura.payload.extensoes_aceitas.map((e) => `.${e}`).join(", ")}.
        </p>
      </div>

      {limiteAtingido && (
        <p role="status" className="rounded-controle border border-ambar-borda bg-ambar-fraco px-4 py-3 text-sm font-medium text-[color:var(--ambar)]">
          Você já enviou o máximo de arquivos permitido neste link ({abertura.payload.limite_arquivos}).
        </p>
      )}

      <div className="flex flex-col gap-4">
        {abertura.payload.tipos_pedidos.map((pedido) => (
          <CartaoTipoDocumento
            // `chave` é única por ITEM (três matrículas colidiam nesta key
            // quando o cartão era por tipo); `tipo` é a categoria, e é por ela
            // que os arquivos já recebidos se agrupam sob o cartão certo.
            key={pedido.chave}
            token={token}
            tipo={pedido.chave}
            rotulo={pedido.rotulo}
            obrigatorio={pedido.obrigatorio}
            recebidos={porTipo.get(pedido.tipo) ?? []}
            extensoesAceitas={abertura.payload.extensoes_aceitas}
            tamanhoMaximoMb={abertura.payload.tamanho_maximo_mb}
            bloqueado={limiteAtingido}
            motivoBloqueio="Limite de arquivos deste link atingido."
            aoReceber={(doc) => setRecebidosAdicionados((atual) => [...atual, doc])}
          />
        ))}
      </div>
    </div>
  );
}
