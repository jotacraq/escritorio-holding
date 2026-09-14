export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirVePatrimonio } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { copilotoEstaAtivo } from "@/server/copiloto/config";
import { dispararWarmupCopiloto } from "@/server/copiloto/warmup";
import type { RespostaSegmentos, SegmentoCopiloto } from "@/types/copiloto";

const ParametroSchema = z.object({ id: z.string().uuid() });

// Teto do caminho quente (§2.2/§4.1 do plano): uma leitura nunca varre a
// sessão inteira sem fim. 500 cobre folgado o teto de ~180 segmentos/sessão
// do desenho (Fatia 4); nesta fatia manual, muito menor na prática.
const LIMITE_MAXIMO_SEGMENTOS = 500;

const QuerySchema = z.object({
  // Cursor incremental (§2.2/§4.1 do plano): devolve só `ordem > desde`. 0 = tudo.
  desde: z.coerce.number().int().min(0).optional().default(0),
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO_SEGMENTOS).optional().default(LIMITE_MAXIMO_SEGMENTOS),
});

interface SessaoLookup {
  id: string;
  jornada_id: string;
  // Embed só para o warm-up de cache (0099): a pessoa titular do gate
  // jurídico, na MESMA query que já busca a sessão — não uma 2ª ida ao banco
  // só para o caminho raro (1º segmento) que dispara o warm-up.
  jornadas: { pessoa_id: string } | null;
}

async function buscarSessaoOuFalhar(supabase: SupabaseClient, sessaoId: string): Promise<SessaoLookup> {
  const { data, error } = await supabase
    .from("sessoes_viabilidade")
    .select("id, jornada_id, jornadas(pessoa_id)")
    .eq("id", sessaoId)
    .maybeSingle<SessaoLookup>();
  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Sessão de Viabilidade não encontrada.");
  return data;
}

interface ErroPostgrest {
  code?: string;
}

/**
 * Calcula `ordem = max(ordem)+1` e insere, com retentativa em colisão de
 * `unique (sessao_id, ordem)` — mesmo padrão de corrida de
 * `inserirTranscricaoComRetentativa` (`api/sessoes/[id]/transcricao`): duas
 * abas digitando ao mesmo tempo na mesma sessão podem calcular a mesma
 * próxima ordem; a 2ª recalcula e tenta de novo em vez de falhar pro cliente.
 */
async function inserirSegmentoComRetentativa(
  supabase: SupabaseClient,
  sessaoId: string,
  texto: string,
  falante: string | null,
): Promise<SegmentoCopiloto> {
  const MAX_TENTATIVAS = 3;

  for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
    const { data: ultimo, error: erroUltimo } = await supabase
      .from("sessoes_copiloto_segmentos")
      .select("ordem")
      .eq("sessao_id", sessaoId)
      .order("ordem", { ascending: false })
      .limit(1)
      .maybeSingle<{ ordem: number }>();
    if (erroUltimo) throw erroUltimo;

    const proximaOrdem = (ultimo?.ordem ?? 0) + 1;

    const { data: inserido, error: erroInsercao } = await supabase
      .from("sessoes_copiloto_segmentos")
      .insert({ sessao_id: sessaoId, ordem: proximaOrdem, texto, falante, origem: "manual" })
      .select("id, sessao_id, ordem, falante, falante_confianca, texto, iniciado_ms, origem, criado_em")
      .single<SegmentoCopiloto>();

    if (!erroInsercao && inserido) return inserido;

    if ((erroInsercao as ErroPostgrest | null)?.code === "23505") continue; // corrida: recalcula e tenta de novo
    throw erroInsercao ?? new Error("falha_ao_persistir_segmento");
  }

  throw new Error("falha_ao_persistir_segmento_apos_retentativas");
}

/**
 * Garante `sessoes_copiloto` existindo e em `estado='ativo'`, carimbando
 * `iniciado_em` no instante real da transição `aguardando`→`ativo` — nunca
 * um upsert cego. A migration (0091) descreve essa transição por escrito
 * (comentário da tabela); esta função é o que torna a descrição verdadeira
 * (achado do Fable: `iniciado_em` nunca era preenchido).
 *
 * Erro de leitura/escrita aqui PROPAGA (lança) — antes era um upsert solto
 * sem checar `error`, o que deixava segmento órfão (sem linha-mãe) em
 * silêncio se a escrita falhasse. Falhar a requisição inteira é o
 * comportamento certo: não existe segmento sem `sessoes_copiloto`.
 *
 * 🔴 CORREÇÃO (achado do coordenador, revisão da Fatia 5 — "fala digitada
 * depois do encerramento é destruída em silêncio"). Esta função LIA
 * `estado` mas só agia no ramo `'aguardando'` (linha ~116 da versão
 * anterior) — para `'encerrado'`/`'erro'` ela simplesmente RETORNAVA sem
 * erro, e o `POST` (abaixo) seguia para o INSERT do segmento sem gate
 * nenhum. A cadeia completa do defeito: (1) segmento gravado numa sessão
 * já encerrada NUNCA entra em `transcricoes` — reencerrar devolve 409
 * `sessao_ja_encerrada` por desenho, nunca reconsolida; (2) a sessão já é
 * elegível ao expurgo (`transcricao_id` preenchido); (3) com
 * `copiloto_sessao.expurgo_ativo=true`, o segmento vence e é DELETADO pelo
 * job da Fatia 5 — fala real do cliente, capturada, nunca consolidada,
 * apagada em silêncio. É o MESMO invariante que `expurgo.ts` já respeita
 * no grão da SESSÃO ("segmento apagado sem transcrição consolidada é fala
 * perdida PARA SEMPRE") furando no grão do SEGMENTO.
 *
 * Agora devolve o `estado` lido — o CHAMADOR (`POST`) decide recusar antes
 * de qualquer escrita, sem uma 2ª leitura só para isso.
 *
 * TAMBÉM devolve `iniciadoAgora`/`iniciadoEm` (warm-up de cache, 0099): o
 * CHAMADOR usa `iniciadoAgora` para decidir se dispara
 * `dispararWarmupCopiloto` — só na transição REAL para 'ativo' (linha nasce
 * OU sai de 'aguardando'), nunca em todo POST subsequente da mesma sessão. A
 * exatidão sob corrida de duas abas não depende deste flag: a claim de
 * verdade é o `update ... where aquecido_em is null` dentro do próprio
 * `warmup.ts` — este flag só evita a TENTATIVA (leitura de config + UPDATE
 * que sempre falharia depois da 1ª vez) no caminho comum.
 */
async function ativarSessaoCopiloto(
  supabase: SupabaseClient,
  sessaoId: string,
): Promise<{ estado: string; iniciadoAgora: boolean; iniciadoEm: string }> {
  const { data: existente, error: erroLeitura } = await supabase
    .from("sessoes_copiloto")
    .select("estado, iniciado_em")
    .eq("sessao_id", sessaoId)
    .maybeSingle<{ estado: string; iniciado_em: string | null }>();
  if (erroLeitura) throw erroLeitura;

  if (!existente) {
    const agora = new Date().toISOString();
    const { error: erroInsercao } = await supabase
      .from("sessoes_copiloto")
      .insert({ sessao_id: sessaoId, estado: "ativo", iniciado_em: agora });
    // 23505: outra requisição concorrente já criou a linha — não é falha, mas
    // também não foi ESTA requisição que transicionou (a outra que ganhou a
    // corrida é quem deve dispararia o warm-up dela, não nós).
    if (erroInsercao) {
      if ((erroInsercao as ErroPostgrest).code !== "23505") throw erroInsercao;
      return { estado: "ativo", iniciadoAgora: false, iniciadoEm: agora };
    }
    return { estado: "ativo", iniciadoAgora: true, iniciadoEm: agora };
  }

  // 🔴 Sessão já encerrada/em erro — NÃO ativa, NÃO atualiza. O CHAMADOR
  // recusa o POST com base neste retorno, antes de tentar inserir o
  // segmento (ver `POST` abaixo).
  if (existente.estado === "encerrado" || existente.estado === "erro") {
    return { estado: existente.estado, iniciadoAgora: false, iniciadoEm: existente.iniciado_em ?? "" };
  }

  if (existente.estado === "aguardando") {
    const iniciadoEm = existente.iniciado_em ?? new Date().toISOString();
    // `{ count: "exact" }` como 2º argumento de `.update()` — mesmo padrão de
    // `server/copiloto/expurgo.ts::carimbar` (idêntico caso de corrida:
    // "devolve true se a linha foi carimbada AGORA").
    const { error: erroAtualizacao, count } = await supabase
      .from("sessoes_copiloto")
      .update({ estado: "ativo", iniciado_em: iniciadoEm }, { count: "exact" })
      .eq("sessao_id", sessaoId)
      .eq("estado", "aguardando"); // não pisa em 'encerrado'/'erro' que tenha mudado entre a leitura e aqui
    if (erroAtualizacao) throw erroAtualizacao;
    // `count === 1`: ESTA requisição venceu a corrida `aguardando`→`ativo`.
    // `count === 0`: outra requisição já tinha transicionado entre a leitura
    // e este UPDATE (o `.eq("estado", "aguardando")` não bateu em nada) — não
    // fomos nós, não disparamos warm-up.
    return { estado: "ativo", iniciadoAgora: count === 1, iniciadoEm };
  }

  return { estado: existente.estado, iniciadoAgora: false, iniciadoEm: existente.iniciado_em ?? "" }; // já 'ativo'
}

/**
 * GET /api/sessoes/[id]/copiloto/segmentos?desde=<ordem>&limite=<n> —
 * segmentos da sessão em ordem, cursor incremental, com TETO (`limite`,
 * padrão e máximo 500 — achado do Fable: leitura sem limit não tem teto,
 * mesmo folgado hoje pelo tamanho da sessão). Sobre o índice do caminho
 * quente (`idx_copiloto_segmentos_polling`, 0091): `where sessao_id = $1 and
 * ordem > $2 order by ordem`, caractere a caractere (§2.2). Nesta fatia não
 * há polling automático — é a mesma rota que a Fatia 3 vai chamar a cada 3 s,
 * criada agora para o campo de digitar/colar já poder mostrar o que foi
 * registrado sem recarregar a página.
 *
 * KILL-SWITCH: `copiloto_sessao.ativo=false` devolve 409 `copiloto_desligado`
 * — mesmo contrato da rota de estado (`GET /api/sessoes/[id]/copiloto`).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: sessaoId } = ParametroSchema.parse(await params);
    const { desde, limite } = QuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));

    const supabase = await criarClienteServidor();

    if (!(await copilotoEstaAtivo(supabase))) {
      throw erroConflito(
        "copiloto_desligado",
        "O copiloto está desligado (copiloto_sessao.ativo = false em Admin).",
      );
    }

    await buscarSessaoOuFalhar(supabase, sessaoId);

    const { data, error } = await supabase
      .from("sessoes_copiloto_segmentos")
      .select("id, sessao_id, ordem, falante, falante_confianca, texto, iniciado_ms, origem, criado_em")
      .eq("sessao_id", sessaoId)
      .gt("ordem", desde)
      .order("ordem", { ascending: true })
      .limit(limite)
      .returns<SegmentoCopiloto[]>();
    if (error) throw error;

    const itens = data ?? [];
    const proximoCursor = itens.length > 0 ? itens[itens.length - 1]!.ordem : desde;

    const resposta: RespostaSegmentos = { itens, proximo_cursor: proximoCursor };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("GET /api/sessoes/[id]/copiloto/segmentos", erro);
  }
}

const CorpoSchema = z.object({
  texto: z.string().trim().min(1, "texto não pode ser vazio"),
  falante: z.string().trim().min(1).optional(),
});

/**
 * POST /api/sessoes/[id]/copiloto/segmentos — a Dra. Elaine digita ou cola um
 * trecho durante a sessão; vira segmento `origem='manual'` (0091-b). É o
 * ÚNICO caminho de escrita desta fatia — o webhook do bot (`origem='bot'`) só
 * existe na Fatia 4. Testa o pipeline inteiro (leitura em
 * `GET /api/sessoes/[id]/copiloto`, listagem aqui) sem bot nenhum, como o
 * plano pede (§8).
 *
 * `ordem` NUNCA vem do corpo: o servidor calcula `max(ordem)+1` da sessão —
 * senão duas abas digitando ao mesmo tempo colidiriam em `unique
 * (sessao_id, ordem)` sem necessidade (o webhook do bot, Fatia 4, manda a
 * própria ordem vinda do provedor; o manual não tem essa fonte).
 *
 * `ativarSessaoCopiloto` garante `sessoes_copiloto` (estado 'aguardando' →
 * 'ativo', com `iniciado_em` carimbado de verdade) no primeiro segmento —
 * sem exigir uma rota separada só para isso.
 *
 * 🔴 SESSÃO JÁ ENCERRADA/EM ERRO → 409 `sessao_ja_encerrada`, ANTES de
 * qualquer INSERT (Fase 10, Fatia 5, achado do coordenador). Sem este gate,
 * um segmento digitado depois do encerramento (cenário real: a advogada
 * encerra, lembra de um detalhe, digita no campo que a tela ainda mostra)
 * nunca entra em `transcricoes` — reencerrar não reconsolida por desenho —
 * e é apagado em silêncio pelo job de expurgo da Fatia 5 assim que vence o
 * prazo. Ver o comentário de `ativarSessaoCopiloto` para a cadeia completa.
 *
 * KILL-SWITCH: `copiloto_sessao.ativo=false` devolve 409 `copiloto_desligado`
 * ANTES de qualquer escrita — nenhuma rota do copiloto grava nada desligada,
 * como a migration promete.
 *
 * WARM-UP DE CACHE (0099): na transição REAL 'aguardando'→'ativo' desta
 * sessão, dispara `dispararWarmupCopiloto` SEM `await` (fire-and-forget) —
 * esta resposta nunca espera por ele. Ver `server/copiloto/warmup.ts` para a
 * ordem completa de travas (mesmo gate jurídico e orçamento do ciclo real).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: sessaoId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    if (!(await copilotoEstaAtivo(supabase))) {
      throw erroConflito(
        "copiloto_desligado",
        "O copiloto está desligado (copiloto_sessao.ativo = false em Admin).",
      );
    }

    const sessao = await buscarSessaoOuFalhar(supabase, sessaoId);
    const { estado, iniciadoAgora, iniciadoEm } = await ativarSessaoCopiloto(supabase, sessaoId);

    // 🔴 CORREÇÃO (achado do coordenador — ver comentário de topo de
    // `ativarSessaoCopiloto`): sessão já encerrada/em erro RECUSA o
    // segmento, antes de qualquer INSERT. Sem isto, fala digitada depois
    // do encerramento nunca entra em `transcricoes` e é apagada em
    // silêncio pelo expurgo da Fatia 5 (`server/copiloto/expurgo.ts`).
    if (estado === "encerrado" || estado === "erro") {
      throw erroConflito(
        "sessao_ja_encerrada",
        "Esta sessão do copiloto já está encerrada — a transcrição já foi consolidada e não é possível adicionar novo segmento.",
      );
    }

    // WARM-UP DE CACHE (0099) — FIRE-AND-FORGET, sem `await`: nunca atrasa
    // esta resposta. Só na transição REAL 'aguardando'→'ativo' desta sessão
    // (`iniciadoAgora`, ver comentário de `ativarSessaoCopiloto`) — não em
    // todo POST subsequente. `pessoaId` ausente (jornada sem vínculo) é
    // silenciosamente ignorado aqui: é o MESMO dado que o ciclo automático
    // exige (`executarCicloCopiloto` recusa sem `jornadas.pessoa_id`), então
    // se faltasse o ciclo real também não rodaria — não é o warm-up quem
    // decide isso, só não tenta sem o dado mínimo.
    const pessoaId = sessao.jornadas?.pessoa_id;
    if (iniciadoAgora && pessoaId) {
      try {
        const admin = criarClienteAdmin();
        void dispararWarmupCopiloto(admin, {
          sessaoId,
          jornadaId: sessao.jornada_id,
          pessoaId,
          inicioSessaoIso: iniciadoEm,
        });
      } catch (erroWarmup) {
        // `criarClienteAdmin()` pode lançar (env ausente) — mesma regra de
        // "falha em silêncio": nunca derruba o POST de segmento.
        registrarErro("POST /api/sessoes/[id]/copiloto/segmentos (warmup)", erroWarmup, { sessao_id: sessaoId });
      }
    }

    const inserido = await inserirSegmentoComRetentativa(supabase, sessaoId, corpo.texto, corpo.falante ?? null);

    return NextResponse.json({ segmento: inserido }, { status: 201 });
  } catch (erro) {
    return respostaErro("POST /api/sessoes/[id]/copiloto/segmentos", erro);
  }
}
