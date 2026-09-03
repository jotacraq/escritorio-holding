/**
 * scripts/importar-transcricoes.ts
 *
 * Ingestão determinística das transcrições do Módulo 4 (Base de Conhecimento,
 * docs/ARQUITETURA-FASE-2.md §4.5, BLOQUEIO B13 / CONFLITO C13-C14).
 *
 * O QUE ESTE SCRIPT FAZ:
 *   1. Lê os arquivos `transcricao-*.md` (Sessão de Viabilidade) e
 *      `transcricao_completa_*.md` (apresentação de Croqui Estrutural, cujo
 *      áudio de origem é sempre prefixado "CE") de um diretório.
 *   2. Para cada arquivo: extrai tipo (pelo padrão do NOME do arquivo — nunca
 *      pelo conteúdo, que mistura registro de SV e de croqui e não é sinal
 *      confiável de tipo), rótulo (nome como aparece no cabeçalho), data da
 *      reunião (best-effort) e consultor; calcula sha256 e tamanho.
 *   3. Pareia cada apresentação de Croqui com a Sessão de Viabilidade da
 *      MESMA pessoa, por TOKEN DE NOME (não por nome inteiro — dois clientes
 *      reais deste material comprovadamente compartilham nome completo,
 *      "Rejane Pamplona de Campos Bonavita", em duas Sessões de Viabilidade
 *      distintas; ver comentário de `parear()` abaixo).
 *   4. Grava em `transcricoes` e `casos_conhecimento` — IDEMPOTENTE: rodar
 *      duas vezes não duplica (upsert por `arquivo_origem`/`rotulo`) e NUNCA
 *      sobrescreve um caso que já foi revisado por um humano
 *      (`revisado_por is not null` trava a atualização automática).
 *
 * O QUE ESTE SCRIPT NUNCA FAZ:
 *   - Não chama a Anthropic. Não grava em `analises_transcricao` nem em
 *     `padroes_conhecimento` — essas tabelas não têm produtor nesta entrega
 *     (BLOQUEIO B13) e o banco recusaria a escrita de qualquer forma (trigger
 *     `app.exige_flag_analise_ia_habilitada`, 0032).
 *   - Não faz DELETE em lugar nenhum.
 *   - Não rotula um caso como "não converteu" — o enum do banco também não
 *     aceita (CONFLITO C13). O default é sempre 'indefinido'.
 *   - Não decide um pareamento ambíguo por chute: quando dois candidatos
 *     empatam, tenta desempatar por data (SV mais recente que precede a
 *     apresentação de croqui) e, se mesmo assim não houver candidato único,
 *     REPORTA e deixa o caso sem par — nunca inventa.
 *
 * MODO DE USO:
 *   npx tsx scripts/importar-transcricoes.ts                    # dry-run (só relatório, nada é escrito)
 *   npx tsx scripts/importar-transcricoes.ts --aplicar           # grava de verdade
 *   npx tsx scripts/importar-transcricoes.ts --aplicar "<dir>"   # aponta para outro diretório de transcrições
 *
 * Exige `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente
 * (ou em `.env.local`, na raiz do projeto — este script faz um parse mínimo
 * do arquivo, sem depender de `dotenv`, que não é dependência do projeto).
 * Sem a service_role key, o script recusa e não tenta cair para a chave
 * publicável em silêncio (mesma trava de `src/lib/supabase/admin.ts`) — RLS
 * de `transcricoes`/`casos_conhecimento` bloquearia toda escrita de qualquer
 * forma, e o script prefere falhar cedo com uma mensagem clara.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Configuração / CLI
// ---------------------------------------------------------------------------

const DIRETORIO_PADRAO =
  "C:\\Users\\João\\sic-hf-brain\\06 - Materiais\\Transcricoes";

const argumentos = process.argv.slice(2);
const APLICAR = argumentos.includes("--aplicar");
const diretorioArg = argumentos.find((a) => !a.startsWith("--"));
const DIRETORIO_TRANSCRICOES = diretorioArg ?? DIRETORIO_PADRAO;

const PREFIXO_SV = "transcricao-";
const PREFIXO_CROQUI = "transcricao_completa_";
const LINHAS_CABECALHO = 15; // metadados (título, data, participantes) sempre cabem aqui

// ---------------------------------------------------------------------------
// Utilitários de texto (sem dependência nova — tudo com `String`/`Intl` nativo)
// ---------------------------------------------------------------------------

function removerAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function primeirasLinhas(conteudo: string, n: number): string {
  return conteudo.split(/\r?\n/).slice(0, n).join("\n");
}

function humanizarSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(" ");
}

const STOPWORDS_NOME = new Set([
  "de", "da", "do", "dos", "das", "e", "filho", "filha", "junior", "jr", "neto", "netos",
]);

/** Tokens significativos do SLUG do arquivo (não do conteúdo) — nome/sobrenome
 * em minúsculo, sem acento, com pelo menos 3 letras, sem preposição/sufixo
 * de parentesco. É a unidade mínima usada para casar SV com Croqui. */
function tokensDoSlug(slug: string): string[] {
  return slug
    .split(/[-_]+/)
    .map((parte) => removerAcentos(parte).toLowerCase())
    .filter((parte) => parte.length >= 3 && !STOPWORDS_NOME.has(parte));
}

// ---------------------------------------------------------------------------
// Extração de metadados do cabeçalho
// ---------------------------------------------------------------------------

const MESES: Record<string, string> = {
  janeiro: "01", fevereiro: "02", marco: "03", abril: "04", maio: "05", junho: "06",
  julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12",
};

/**
 * Data da reunião, best-effort, em ordem de confiabilidade decrescente:
 *   1. `GMT<yyyymmdd>-` embutido no nome do arquivo de gravação (Zoom) —
 *      presente em 57 dos 70 arquivos de hoje, é o dado mais confiável porque
 *      não depende de digitação humana no cabeçalho.
 *   2. `DD/MM/AAAA` explícito (padrão das apresentações de Croqui).
 *   3. "N de <mês> de AAAA" por extenso, COM dia (padrão das SVs).
 * Quando o cabeçalho só cita mês/ano (ex.: "Agosto de 2026", sem dia), a
 * função devolve `null` — nunca inventamos o dia dentro do mês.
 */
function extrairDataReuniao(cabecalho: string): string | null {
  const gmt = cabecalho.match(/GMT(\d{4})(\d{2})(\d{2})-/);
  if (gmt) return `${gmt[1]}-${gmt[2]}-${gmt[3]}`;

  const numerica = cabecalho.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (numerica) {
    const [, dia, mes, ano] = numerica;
    return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
  }

  const extenso = cabecalho.match(/\b(\d{1,2})\s+de\s+([a-zA-Zà-úÀ-Ú]+)\s+de\s+(\d{4})\b/i);
  if (extenso) {
    const nomeMes = removerAcentos(extenso[2]).toLowerCase();
    const mes = MESES[nomeMes];
    if (mes) return `${extenso[3]}-${mes}-${extenso[1].padStart(2, "0")}`;
  }

  return null;
}

/** "Consultora: Dra. Elane Montenegro" (ou "Consultor:") — cabeçalhos às
 * vezes concatenam o campo seguinte sem quebra de linha (ex.:
 * "...Montenegro Cliente: ..."), por isso o lookahead corta antes de
 * "Cliente"/"Participante" mesmo sem newline entre os dois. */
function extrairConsultor(cabecalho: string): string | null {
  const m = cabecalho.match(/Consultor[ea]?:\s*([^\n]+?)(?=\s*(?:Cliente|Participante)|\n|$)/i);
  const valor = m?.[1]?.trim();
  return valor && valor.length > 0 ? valor : null;
}

/** Nome do cliente como aparece no cabeçalho. Fallback seguro: o slug do
 * arquivo humanizado — nunca inventa um nome que não esteja em algum lugar
 * (arquivo ou cabeçalho). */
function extrairRotulo(primeiraLinha: string, tipo: "sessao_viabilidade" | "apresentacao_croqui", slug: string): string {
  if (tipo === "apresentacao_croqui") {
    const m = primeiraLinha.match(/Transcri[cç][aã]o de [ÁA]udio:\s*CE\s+([^(]+)/i);
    if (m) return m[1].trim();
  } else {
    const partes = primeiraLinha.split(/[-–—]/);
    if (partes.length > 1) {
      const cauda = partes[partes.length - 1].trim();
      if (cauda.length > 0) return cauda;
    }
  }
  return humanizarSlug(slug);
}

// ---------------------------------------------------------------------------
// Leitura dos arquivos
// ---------------------------------------------------------------------------

interface ArquivoTranscricao {
  arquivoOrigem: string; // nome do arquivo, ex.: 'transcricao-cesar-emilio.md'
  slug: string; // sem prefixo/extensão, ex.: 'cesar-emilio'
  tipo: "sessao_viabilidade" | "apresentacao_croqui";
  conteudo: string;
  cabecalho: string;
  cabecalhoNormalizado: string; // sem acento, minúsculo — só para casar token
  rotulo: string;
  dataReuniao: string | null;
  consultor: string | null;
  tamanhoBytes: number;
  sha256: string;
}

function classificarArquivo(nomeArquivo: string): { tipo: ArquivoTranscricao["tipo"]; slug: string } | null {
  if (nomeArquivo.startsWith(PREFIXO_CROQUI) && nomeArquivo.endsWith(".md")) {
    return { tipo: "apresentacao_croqui", slug: nomeArquivo.slice(PREFIXO_CROQUI.length, -3) };
  }
  if (nomeArquivo.startsWith(PREFIXO_SV) && nomeArquivo.endsWith(".md")) {
    return { tipo: "sessao_viabilidade", slug: nomeArquivo.slice(PREFIXO_SV.length, -3) };
  }
  return null;
}

function lerArquivos(diretorio: string): { arquivos: ArquivoTranscricao[]; ignorados: string[] } {
  const nomes = readdirSync(diretorio).filter((n) => n.endsWith(".md"));
  const arquivos: ArquivoTranscricao[] = [];
  const ignorados: string[] = [];

  for (const nome of nomes) {
    const classificacao = classificarArquivo(nome);
    if (!classificacao) {
      ignorados.push(nome);
      continue;
    }

    const caminho = path.join(diretorio, nome);
    const conteudo = readFileSync(caminho, "utf-8");
    const cabecalho = primeirasLinhas(conteudo, LINHAS_CABECALHO);
    const primeiraLinha = conteudo.split(/\r?\n/, 1)[0] ?? "";

    arquivos.push({
      arquivoOrigem: nome,
      slug: classificacao.slug,
      tipo: classificacao.tipo,
      conteudo,
      cabecalho,
      cabecalhoNormalizado: removerAcentos(cabecalho).toLowerCase(),
      rotulo: extrairRotulo(primeiraLinha, classificacao.tipo, classificacao.slug),
      dataReuniao: extrairDataReuniao(cabecalho),
      consultor: extrairConsultor(cabecalho),
      tamanhoBytes: Buffer.byteLength(conteudo, "utf-8"),
      sha256: createHash("sha256").update(conteudo, "utf-8").digest("hex"),
    });
  }

  return { arquivos, ignorados };
}

// ---------------------------------------------------------------------------
// Pareamento SV <-> Croqui
// ---------------------------------------------------------------------------

interface Pareamento {
  pares: Map<string, string>; // slug do croqui -> slug da SV
  naoResolvidos: { croqui: string; candidatos: string[] }[];
}

/**
 * Pareia cada apresentação de Croqui com a Sessão de Viabilidade da mesma
 * pessoa. Algoritmo, em ordem:
 *
 *   1. Tokeniza o SLUG DO ARQUIVO de croqui (não o conteúdo inteiro — testado
 *      contra o material real: buscar token no CONTEÚDO INTEIRO da SV gera
 *      falso positivo, porque "pessoa" (token de 'eduardo_pessoa') é também
 *      uma palavra comum do português e aparece em SVs de outras famílias).
 *   2. Verifica quais SVs têm TODOS esses tokens como palavra inteira no
 *      CABEÇALHO (primeiras 15 linhas — título + "Cliente(s):" + participantes,
 *      onde o nome completo do cliente sempre aparece). Restringir ao
 *      cabeçalho elimina o falso positivo do passo anterior.
 *   3. Se sobrar exatamente 1 candidato: par resolvido.
 *   4. Se sobrar mais de 1 (caso real do material: duas SVs de
 *      "Rejane Pamplona de Campos Bonavita" datadas de meses diferentes):
 *      desempata pela SV mais RECENTE cuja data de reunião seja <= à data da
 *      apresentação de croqui (croqui sempre vem depois da SV, nunca antes).
 *   5. Se ainda assim não houver candidato único: NÃO resolve. Reportado no
 *      relatório final para revisão humana — nunca um chute.
 *
 * Validado contra as 70 transcrições reais de hoje: 18/18 apresentações de
 * Croqui pareiam com uma SV (11 únicas de cara, 6 únicas após restringir ao
 * cabeçalho, 1 via desempate por data — "Silvio Domingues" é o pai dos
 * clientes "Marcelo e Rodrigo" da SV `transcricao-marcelo-domingues.md`,
 * "Família Domingues (Serfer)": o nome do croqui é o do patriarca, que nem
 * aparece na linha "Clientes:" da SV — mas "Domingues" é único o bastante no
 * cabeçalho para não gerar ambiguidade).
 */
function parear(svs: ArquivoTranscricao[], croquis: ArquivoTranscricao[]): Pareamento {
  const pares = new Map<string, string>();
  const naoResolvidos: { croqui: string; candidatos: string[] }[] = [];

  for (const croqui of croquis) {
    const tokens = tokensDoSlug(croqui.slug);
    const candidatos = svs.filter((sv) =>
      tokens.every((t) => new RegExp(`\\b${escaparRegex(t)}\\b`).test(sv.cabecalhoNormalizado)),
    );

    if (candidatos.length === 1) {
      pares.set(croqui.slug, candidatos[0].slug);
      continue;
    }

    if (candidatos.length > 1) {
      const comDataValida = candidatos.filter(
        (sv) => sv.dataReuniao != null && croqui.dataReuniao != null && sv.dataReuniao <= croqui.dataReuniao,
      );
      if (comDataValida.length >= 1) {
        comDataValida.sort((a, b) => (b.dataReuniao! < a.dataReuniao! ? -1 : 1));
        pares.set(croqui.slug, comDataValida[0].slug);
        continue;
      }
    }

    naoResolvidos.push({ croqui: croqui.slug, candidatos: candidatos.map((c) => c.slug) });
  }

  return { pares, naoResolvidos };
}

// ---------------------------------------------------------------------------
// Persistência (idempotente)
// ---------------------------------------------------------------------------

interface ContadorTranscricoes {
  inseridas: number;
  jaExistiam: number;
}

async function upsertTranscricao(
  supabase: SupabaseClient,
  arquivo: ArquivoTranscricao,
  contador: ContadorTranscricoes,
): Promise<string> {
  const { data: existente, error: erroSelect } = await supabase
    .from("transcricoes")
    .select("id")
    .eq("arquivo_origem", arquivo.arquivoOrigem)
    .maybeSingle<{ id: string }>();

  if (erroSelect) throw new Error(`falha ao consultar transcricoes[${arquivo.arquivoOrigem}]: ${erroSelect.message}`);

  if (existente) {
    contador.jaExistiam += 1;
    return existente.id;
  }

  const { data: inserida, error: erroInsert } = await supabase
    .from("transcricoes")
    .insert({
      tipo: arquivo.tipo,
      arquivo_origem: arquivo.arquivoOrigem,
      rotulo: arquivo.rotulo,
      data_reuniao: arquivo.dataReuniao,
      consultor: arquivo.consultor,
      conteudo: arquivo.conteudo,
      tamanho_bytes: arquivo.tamanhoBytes,
      sha256: arquivo.sha256,
      importado_por: null, // importado por script, sem sessão de usuário
      origem_dado: "real",
    })
    .select("id")
    .single<{ id: string }>();

  if (erroInsert || !inserida) {
    throw new Error(`falha ao inserir transcricoes[${arquivo.arquivoOrigem}]: ${erroInsert?.message}`);
  }

  contador.inseridas += 1;
  return inserida.id;
}

interface ContadorCasos {
  criados: number;
  atualizados: number;
  preservadosPorRevisaoHumana: number;
}

async function upsertCaso(
  supabase: SupabaseClient,
  params: { rotulo: string; transcricaoSvId: string; transcricaoCroquiId: string | null },
  contador: ContadorCasos,
): Promise<void> {
  const desfecho = params.transcricaoCroquiId != null ? "avancou_para_croqui" : "indefinido";

  const { data: existente, error: erroSelect } = await supabase
    .from("casos_conhecimento")
    .select("id, revisado_por, transcricao_croqui_id, desfecho_observado")
    .eq("rotulo", params.rotulo)
    .maybeSingle<{
      id: string;
      revisado_por: string | null;
      transcricao_croqui_id: string | null;
      desfecho_observado: string;
    }>();

  if (erroSelect) throw new Error(`falha ao consultar casos_conhecimento[${params.rotulo}]: ${erroSelect.message}`);

  if (!existente) {
    const { error: erroInsert } = await supabase.from("casos_conhecimento").insert({
      rotulo: params.rotulo,
      transcricao_sv_id: params.transcricaoSvId,
      transcricao_croqui_id: params.transcricaoCroquiId,
      desfecho_observado: desfecho,
    });
    if (erroInsert) throw new Error(`falha ao inserir casos_conhecimento[${params.rotulo}]: ${erroInsert.message}`);
    contador.criados += 1;
    return;
  }

  // Um humano já carimbou este caso (CONFLITO C13 / BLOQUEIO B13: "quando a
  // Dra. Elaine carimbar os desfechos reais, é UPDATE, não migration" — e
  // esse UPDATE manual não pode ser desfeito por uma reimportação de rotina).
  if (existente.revisado_por != null) {
    contador.preservadosPorRevisaoHumana += 1;
    return;
  }

  const mudou =
    existente.transcricao_croqui_id !== params.transcricaoCroquiId ||
    existente.desfecho_observado !== desfecho;

  if (!mudou) return;

  const { error: erroUpdate } = await supabase
    .from("casos_conhecimento")
    .update({ transcricao_croqui_id: params.transcricaoCroquiId, desfecho_observado: desfecho })
    .eq("id", existente.id);

  if (erroUpdate) throw new Error(`falha ao atualizar casos_conhecimento[${params.rotulo}]: ${erroUpdate.message}`);
  contador.atualizados += 1;
}

// ---------------------------------------------------------------------------
// Cliente Supabase (service_role) — fail-closed, sem fallback silencioso.
// Duplicado deliberadamente de `src/lib/supabase/admin.ts`: este é um script
// standalone (roda com `tsx`, fora do bundler do Next.js) e não deve depender
// de resolução de alias de import (`@/...`) em runtime.
// ---------------------------------------------------------------------------

function carregarEnvLocal(): void {
  const caminho = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(caminho)) return;

  for (const linha of readFileSync(caminho, "utf-8").split(/\r?\n/)) {
    const l = linha.trim();
    if (!l || l.startsWith("#")) continue;
    const igual = l.indexOf("=");
    if (igual === -1) continue;
    const chave = l.slice(0, igual).trim();
    const valor = l.slice(igual + 1).trim();
    if (chave && !(chave in process.env)) process.env[chave] = valor;
  }
}

async function criarClienteAdmin(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const servico = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL ausente — defina em .env.local ou no ambiente.");
  }

  // Caminho preferido: service_role, quando existir.
  if (servico) {
    return createClient(url, servico, { auth: { autoRefreshToken: false, persistSession: false } });
  }

  // Caminho alternativo: LOGIN de um usuário com papel `admin`. A migration 0037
  // deu a esse papel a escrita em transcricoes/casos_conhecimento — é o dono
  // legítimo desse material, o mesmo recorte que já vale para prompts, templates
  // e roteiros. Assim a base de conhecimento entra sem esperar a service_role,
  // e a RLS continua valendo por inteiro (nada de bypass).
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.INGESTAO_EMAIL;
  const senha = process.env.INGESTAO_SENHA;

  if (!anon || !email || !senha) {
    throw new Error(
      "Sem SUPABASE_SERVICE_ROLE_KEY. Para ingerir com login de admin, defina " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY, INGESTAO_EMAIL e INGESTAO_SENHA. " +
        "O script não cai para a chave publicável anônima: a RLS bloquearia " +
        "toda escrita e é melhor falhar cedo, com mensagem clara.",
    );
  }

  const cliente = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await cliente.auth.signInWithPassword({ email, password: senha });
  if (error || !data.session) {
    throw new Error(`Login de ingestão falhou: ${error?.message ?? "sessão não retornada"}`);
  }
  console.log(`Autenticado como ${email} (escrita pela RLS de admin, sem service_role).`);
  return cliente;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Diretório: ${DIRETORIO_TRANSCRICOES}`);
  console.log(`Modo: ${APLICAR ? "APLICAR (grava no banco)" : "DRY-RUN (só relatório, nada é escrito)"}`);
  console.log("");

  if (!existsSync(DIRETORIO_TRANSCRICOES)) {
    console.error(`Diretório não encontrado: ${DIRETORIO_TRANSCRICOES}`);
    process.exitCode = 1;
    return;
  }

  const { arquivos, ignorados } = lerArquivos(DIRETORIO_TRANSCRICOES);
  const svs = arquivos.filter((a) => a.tipo === "sessao_viabilidade");
  const croquis = arquivos.filter((a) => a.tipo === "apresentacao_croqui");

  console.log(`Arquivos .md encontrados: ${arquivos.length + ignorados.length}`);
  console.log(`  Sessão de Viabilidade (transcricao-*.md): ${svs.length}`);
  console.log(`  Apresentação de Croqui (transcricao_completa_*.md): ${croquis.length}`);
  if (ignorados.length > 0) {
    console.log(`  Ignorados (não batem com nenhum dos dois padrões): ${ignorados.length}`);
    for (const nome of ignorados) console.log(`    - ${nome}`);
  }
  console.log("");

  const { pares, naoResolvidos } = parear(svs, croquis);
  console.log(`Pareamento SV <-> Croqui: ${pares.size}/${croquis.length} resolvidos automaticamente`);
  if (naoResolvidos.length > 0) {
    console.log(`  Não resolvidos (ficam SEM apresentação de croqui vinculada, revisão manual depois):`);
    for (const nr of naoResolvidos) {
      console.log(
        `    - ${nr.croqui}: ${nr.candidatos.length === 0 ? "nenhum candidato" : `candidatos ambíguos [${nr.candidatos.join(", ")}]`}`,
      );
    }
  }
  console.log("");

  const svSlugsComPar = new Set(pares.values());
  const avancaramParaCroqui = svs.filter((sv) => svSlugsComPar.has(sv.slug)).length;
  console.log(
    `Casos esperados: ${svs.length} (1 por SV) — ${avancaramParaCroqui} com 'avancou_para_croqui', ` +
      `${svs.length - avancaramParaCroqui} 'indefinido' (indefinido NÃO é perda — CONFLITO C13).`,
  );
  console.log("");

  if (!APLICAR) {
    console.log("DRY-RUN: nada foi escrito no banco. Rode com --aplicar para gravar.");
    return;
  }

  carregarEnvLocal();
  const supabase = await criarClienteAdmin();

  const contadorTranscricoes: ContadorTranscricoes = { inseridas: 0, jaExistiam: 0 };
  const idsPorSlug = new Map<string, string>();

  for (const arquivo of arquivos) {
    const id = await upsertTranscricao(supabase, arquivo, contadorTranscricoes);
    idsPorSlug.set(arquivo.slug, id);
  }

  const contadorCasos: ContadorCasos = { criados: 0, atualizados: 0, preservadosPorRevisaoHumana: 0 };

  for (const sv of svs) {
    const slugCroqui = [...pares.entries()].find(([, slugSv]) => slugSv === sv.slug)?.[0] ?? null;
    const transcricaoSvId = idsPorSlug.get(sv.slug);
    const transcricaoCroquiId = slugCroqui ? (idsPorSlug.get(slugCroqui) ?? null) : null;

    if (!transcricaoSvId) {
      throw new Error(`invariante quebrada: transcricao_sv_id ausente para ${sv.slug} após upsert`);
    }

    await upsertCaso(
      supabase,
      { rotulo: sv.slug, transcricaoSvId, transcricaoCroquiId },
      contadorCasos,
    );
  }

  console.log("Gravação concluída.");
  console.log(`  transcricoes: ${contadorTranscricoes.inseridas} inseridas, ${contadorTranscricoes.jaExistiam} já existiam`);
  console.log(
    `  casos_conhecimento: ${contadorCasos.criados} criados, ${contadorCasos.atualizados} atualizados, ` +
      `${contadorCasos.preservadosPorRevisaoHumana} preservados (já revisados por humano)`,
  );
}

main().catch((erro) => {
  console.error("Falha na importação:", erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
