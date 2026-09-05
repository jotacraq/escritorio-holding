/**
 * Camada de acesso à superfície pública (`/api/publico/[token]/**`).
 *
 * Deliberadamente separada de `src/lib/api.ts`: aquela camada manda `credentials: "include"`
 * (sessão Supabase) e serve a equipe autenticada. Aqui não existe sessão nem cookie — a página
 * pública nunca monta cliente de sessão (docs/ARQUITETURA-FASE-2.md §2.5) — então o único
 * "crachá" de cada requisição é o token que já está na URL.
 *
 * Erro de link é sempre o mesmo objeto (`{erro:'link_invalido'}`, ver `src/types/publico-ui.ts`).
 * Esta camada não tenta adivinhar o motivo — só repassa o que a rota disser, ou classifica como
 * `erro_desconhecido` quando a resposta não é JSON (rota fora do ar, 500 de proxy, etc.), porque
 * o backend público ainda está em construção em paralelo (B-1A).
 */

import type {
  AberturaAgendamentoPublico,
  AberturaConfirmacaoPublico,
  AberturaDocumentosPublico,
  AberturaFormularioPublico,
  AberturaMaterialPublico,
  CorpoEscolherHorarioPublico,
  CorpoResponderFormularioPublico,
  ErroPublico,
  EstadoPdfMaterialPublico,
  RespostaConfirmarPresencaPublico,
  RespostaEscolherHorarioPublico,
  RespostaRegistrarDocumentoPublico,
  RespostaResponderFormularioPublico,
  TipoDocumentoPublico,
  TipoLinkQualquer,
} from "@/types/publico-ui";

/** Todos os códigos que o backend público nomeia (`src/types/publico.ts`). Qualquer outro vira `erro_desconhecido`. */
const CODIGOS_CONHECIDOS: ReadonlySet<string> = new Set<ErroPublico["erro"]>([
  "link_invalido",
  "limite_excedido",
  "horario_indisponivel",
  "envio_indisponivel",
  "arquivo_invalido",
  "erro_desconhecido",
  "respostas_invalidas",
  "formulario_indisponivel",
  "limite_remarcacoes",
  "agendamento_indisponivel",
  "limite_arquivos_atingido",
  "arquivo_duplicado",
  "pdf_indisponivel",
]);

function normalizarCodigo(codigo: unknown): ErroPublico["erro"] {
  return typeof codigo === "string" && CODIGOS_CONHECIDOS.has(codigo) ? (codigo as ErroPublico["erro"]) : "erro_desconhecido";
}

export class ErroLinkPublico extends Error {
  codigo: ErroPublico["erro"];
  constructor(codigo: ErroPublico["erro"]) {
    super(codigo);
    this.name = "ErroLinkPublico";
    this.codigo = codigo;
  }
}

async function lerCorpo<T>(resposta: Response): Promise<T> {
  try {
    return (await resposta.json()) as T;
  } catch {
    throw new ErroLinkPublico("erro_desconhecido");
  }
}

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      ...init,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ErroLinkPublico("erro_desconhecido");
  }

  if (!resposta.ok) {
    const corpo = await lerCorpo<Partial<ErroPublico>>(resposta).catch(() => ({}) as Partial<ErroPublico>);
    throw new ErroLinkPublico(normalizarCodigo(corpo.erro));
  }

  return lerCorpo<T>(resposta);
}

function caminhoAbertura(token: string): string {
  return `/api/publico/${encodeURIComponent(token)}`;
}

export function abrirLinkFormulario(token: string) {
  return chamar<AberturaFormularioPublico>(caminhoAbertura(token));
}
export function abrirLinkAgendamento(token: string) {
  return chamar<AberturaAgendamentoPublico>(caminhoAbertura(token));
}
export function abrirLinkDocumentos(token: string) {
  return chamar<AberturaDocumentosPublico>(caminhoAbertura(token));
}
export function abrirLinkMaterial(token: string) {
  return chamar<AberturaMaterialPublico>(caminhoAbertura(token));
}
/** `/p/c/[token]` — link de confirmação de presença (0051). Mesma abertura, `tipo='confirmacao'`. */
export function abrirLinkConfirmacao(token: string) {
  return chamar<AberturaConfirmacaoPublico>(caminhoAbertura(token));
}

/** Verifica que o link aberto é do tipo esperado pela rota — divergência vira link_invalido (§2.2, regra 3: sem oráculo). */
export function conferirTipo<T extends { tipo: TipoLinkQualquer }>(abertura: T, esperado: TipoLinkQualquer): T {
  if (abertura.tipo !== esperado) throw new ErroLinkPublico("link_invalido");
  return abertura;
}

/**
 * Um toque: `POST /api/publico/[token]/confirmar`, sem corpo. Erros que a tela
 * trata por nome: `agendamento_indisponivel` (409, horário remarcado — a equipe
 * manda link novo), `limite_excedido` (429), `link_invalido` (404).
 */
export function confirmarPresencaPublico(token: string) {
  return chamar<RespostaConfirmarPresencaPublico>(`/api/publico/${encodeURIComponent(token)}/confirmar`, { method: "POST" });
}

export function caminhoPdfMaterial(token: string): string {
  return `/api/publico/${encodeURIComponent(token)}/material-pdf`;
}

/**
 * "Baixar PDF" da página `/p/m`. A rota responde 302 para uma URL assinada de
 * 5 minutos (`Content-Disposition: attachment`). Chamada SÓ no clique — nunca
 * na abertura da página: cada chamada gera URL assinada e linha de auditoria,
 * e conta no rate limit do token.
 *
 * Caminho principal: `fetch` seguindo o redirect, PDF vira `Blob` e um `<a download>`
 * dispara o download sem sair da página (funciona com bloqueador de pop-up, já
 * que nada abre em nova janela). Se o navegador recusar o salto de origem
 * (CORS do Storage), `fallback` navega direto para a rota — o `attachment`
 * faz o navegador baixar sem trocar de página.
 *
 * Os estados ruins (409 `pdf_indisponivel`, 503 `envio_indisponivel`, 404, 429)
 * chegam como JSON da mesma origem ANTES do redirect — por isso dá para
 * distingui-los e devolver ao chamador, que mantém a impressão como caminho.
 */
export async function baixarPdfMaterialPublico(token: string): Promise<{ estado: EstadoPdfMaterialPublico }> {
  const caminho = caminhoPdfMaterial(token);
  let resposta: Response;
  try {
    resposta = await fetch(caminho, { method: "GET", cache: "no-store", redirect: "follow", headers: { Accept: "application/pdf, application/json" } });
  } catch {
    // O salto para o Storage foi recusado pelo navegador (CORS/rede) — a rota
    // em si pode estar boa. Navegar direto deixa o `attachment` baixar.
    window.location.assign(caminho);
    return { estado: "disponivel" };
  }

  const tipo = resposta.headers.get("content-type") ?? "";
  if (resposta.ok && (resposta.redirected || tipo.includes("application/pdf") || tipo.includes("octet-stream"))) {
    const blob = await resposta.blob();
    const url = URL.createObjectURL(blob);
    const ancora = document.createElement("a");
    ancora.href = url;
    ancora.download = "material-sessao-de-viabilidade.pdf";
    ancora.rel = "noopener";
    document.body.appendChild(ancora);
    ancora.click();
    ancora.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { estado: "disponivel" };
  }

  const corpo = await lerCorpo<Partial<ErroPublico>>(resposta).catch(() => ({}) as Partial<ErroPublico>);
  const codigo = normalizarCodigo(corpo.erro);
  if (codigo === "pdf_indisponivel" || codigo === "envio_indisponivel" || codigo === "limite_excedido" || codigo === "link_invalido") {
    return { estado: codigo };
  }
  return { estado: "erro_desconhecido" };
}

export function responderFormularioPublico(token: string, corpo: CorpoResponderFormularioPublico) {
  return chamar<RespostaResponderFormularioPublico>(`/api/publico/${encodeURIComponent(token)}/formulario`, {
    method: "POST",
    body: JSON.stringify(corpo),
  });
}

export function escolherHorarioPublico(token: string, corpo: CorpoEscolherHorarioPublico) {
  return chamar<RespostaEscolherHorarioPublico>(`/api/publico/${encodeURIComponent(token)}/horario`, {
    method: "POST",
    body: JSON.stringify(corpo),
  });
}

/**
 * Upload multipart via `XMLHttpRequest` (não `fetch`): é a única API do navegador que expõe
 * progresso de envio, e o método pede "arrastar ou escolher, com progresso" explicitamente.
 * `service_role` ausente no servidor responde 503 → mapeado para `envio_indisponivel`, nunca
 * um sucesso fingido (§2.4).
 */
export function enviarDocumentoPublico(
  token: string,
  arquivo: File,
  tipo: TipoDocumentoPublico,
  aoProgredir: (percentual: number) => void,
): Promise<RespostaRegistrarDocumentoPublico> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/publico/${encodeURIComponent(token)}/documento`);

    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable) aoProgredir(Math.round((evento.loaded / evento.total) * 100));
    };

    xhr.onerror = () => reject(new ErroLinkPublico("erro_desconhecido"));

    xhr.onload = () => {
      let corpo: unknown = null;
      try {
        corpo = JSON.parse(xhr.responseText);
      } catch {
        reject(new ErroLinkPublico("erro_desconhecido"));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(corpo as RespostaRegistrarDocumentoPublico);
        return;
      }
      reject(new ErroLinkPublico(normalizarCodigo((corpo as Partial<ErroPublico>)?.erro)));
    };

    const forma = new FormData();
    forma.append("arquivo", arquivo);
    forma.append("tipo", tipo);
    xhr.send(forma);
  });
}
