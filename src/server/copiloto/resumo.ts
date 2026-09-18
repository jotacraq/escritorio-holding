import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { lerConfiguracaoBool } from "@/server/ia/configuracao";
import type { ResumoAcumulado, ItemResumoAcumulado } from "@/types/copiloto";
import type { RoteiroCampo } from "@/types/roteiro";

/**
 * MEMÓRIA DO COPILOTO — Fatia A (18/09/2026, pedido do dono depois do achado
 * medido na sessão real do Carlos Alberto, 2h05: 122 perguntas distintas em
 * 118 min, 49 sobre família, ainda 8 perguntas sobre filhos no 4º quarto da
 * sessão com 2h já ouvidas). `sessoes_copiloto.resumo_acumulado` existe desde
 * a 0091 mas nunca foi escrito — este módulo fecha essa lacuna, no MESMO
 * padrão de `inventario.ts` (função pura de acumulação + I/O separado):
 *
 *   - `categorizarPergunta` — casa o TEXTO de uma pergunta já SUGERIDA (que a
 *     advogada viu na tela: `proxima_pergunta.texto`, nunca `cobriu_no_bloco`
 *     como fonte PRIMÁRIA — medido: `cobriu_no_bloco` rendeu só 11 itens em
 *     178 sugestões da sessão real, contra 133 de `proxima_pergunta`, 65% dos
 *     quais categorizam) contra os `campos[]` do BLOCO ATUAL (já vêm no
 *     contexto, `contexto.ts:209-211` — zero query nova) e devolve o
 *     `RoteiroCampo.id` que casou, ou `null` se nenhum casou. Pergunta que
 *     não casa NÃO ENTRA em `perguntado` — nunca força encaixe, nunca inventa
 *     `t` (medido: ~35% das perguntas reais não categorizam).
 *   - `acumularResumo` — mescla o tema novo (se houve categorização) no
 *     `ResumoAcumulado` já existente: upsert por `t` (soma `n`, atualiza
 *     `em`), depois recalcula `pendente` = `campos[]` do bloco atual MENOS os
 *     `id` já presentes em `perguntado` (a MESMA unidade dos dois lados —
 *     `campo.id` — é o que torna essa subtração possível sem tradução no
 *     meio, decisão do dono). Poda por bytes ANTES de devolver (nunca deixa o
 *     CHECK de 4096 da 0091 estourar e derrubar o UPDATE inteiro).
 *   - `resumirParaContexto` — o que REALMENTE vai para o bloco E do contexto
 *     de IA: recalcula `pendente` contra o bloco ATUAL desta chamada (o valor
 *     persistido pode ter sido calculado num bloco anterior da mesma sessão)
 *     — nunca confia no `pendente` gravado como definitivo, porque `pendente`
 *     é DERIVADO, não decidido (diferente de `papel` em `participantes.ts`,
 *     que É estável por design).
 *
 * Vocabulário DINÂMICO — `t`/`pendente` são `RoteiroCampo.id`, NUNCA um enum
 * fixo de categoria de negócio (decisão do dono, 18/09/2026, revertendo uma
 * proposta anterior de 6 categorias por palavra-chave): quando a Dra. Elaine
 * publicar um roteiro novo, o vocabulário acompanha sozinho, sem deploy nem
 * migration de dado. Consequência aceita e registrada: "empresa" (2º tema
 * mais perguntado na sessão real, 15 ocorrências) não tem `campo.id` próprio
 * no roteiro v5 ativo — cai em `lista_bens`/`quem_paga_contas` ou fica sem
 * categorizar. Mexer no roteiro para criar um campo de "empresa" é decisão de
 * MÉTODO da Dra. Elaine, não deste módulo.
 *
 * FATIA A APENAS (decisão do dono, B72): `perguntado[]`/`pendente[]`, nunca
 * `fato_estabelecido`/`fatos[]` (Fatia B, fora deste escopo). `cortado_em`
 * nasce sempre `null` nesta fatia — campo do contrato reservado para a Fatia
 * B poder registrar corte por evento sem 2ª migration de schema.
 *
 * A ROTA/CICLO (mesmo padrão de `inventario.ts`) fazem o I/O: leem
 * `sessoes_copiloto.resumo_acumulado`, chamam `acumularResumo` com a pergunta
 * sugerida NESTA chamada, e gravam de volta — ESCRITO A CADA CHAMADA que
 * tiver `proxima_pergunta` categorizável (não só 1×, como o dossiê).
 */

const TETO_PERGUNTADO = 16;
const TETO_PENDENTE = 8;
const TETO_BYTES_ALVO = 3500; // margem contra o CHECK de 4096 (0091) — backstop, não meta

/** Normaliza para comparação — minúsculas, sem acento, espaços colapsados.
 * Mesmo espírito de `normalizarDescricao` (inventario.ts) e `normalizarNome`
 * (participantes.ts): esta casa já tem a convenção, não reinventada aqui. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Palavras curtas demais para desambiguar sozinhas ("de", "do", "a
 * família") — mesmo raciocínio de stop-words de busca textual, aplicado aqui
 * só para não deixar uma palavra de 2-3 letras casar por acidente ampla
 * demais. Lista pequena e deliberadamente conservadora: o objetivo é evitar
 * FALSO-POSITIVO (pergunta que não é sobre o tema entrando em `perguntado`),
 * nunca ampliar recall. */
const PALAVRAS_IGNORADAS = new Set([
  "a", "o", "e", "de", "da", "do", "das", "dos", "em", "um", "uma", "para",
  "com", "que", "os", "as", "se", "sua", "seu", "suas", "seus", "no", "na",
  "ou", "por", "como", "sobre", "ja", "tem", "ha", "voces", "vocês",
]);

/** Termos "significativos" do rótulo de um campo — o rótulo inteiro
 * normalizado, MENOS as palavras da lista de stop-words acima. Um campo casa
 * quando PELO MENOS um desses termos aparece no texto normalizado da
 * pergunta — critério propositalmente estreito (rótulos como "Filhos
 * (maiores/menores)" viram termos como "filhos", "maiores", "menores", cada
 * um suficiente para casar sozinho) para não perder recall em cima da rejeição
 * de falso-positivo. */
function termosSignificativos(rotulo: string): string[] {
  return normalizar(rotulo)
    .replace(/[()/,.-]/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !PALAVRAS_IGNORADAS.has(t));
}

/**
 * Casa o TEXTO de uma pergunta já sugerida contra os `campos[]` do bloco
 * ATUAL (já vêm no contexto, zero query nova) — devolve o `id` do PRIMEIRO
 * campo cujo rótulo tem algum termo significativo presente no texto da
 * pergunta, ou `null` se nenhum casar. Pura, testável sem I/O.
 *
 * Ordem de checagem = ordem de `campos[]` no roteiro (a ordem que a Dra.
 * Elaine cadastrou) — determinístico, nunca escolha aleatória entre dois
 * campos que casem ao mesmo tempo (raro, mas possível com rótulos
 * parecidos: o primeiro do bloco vence, sempre o mesmo para o mesmo roteiro).
 */
export function categorizarPergunta(textoPergunta: string, camposDoBloco: RoteiroCampo[]): string | null {
  const textoNormalizado = normalizar(textoPergunta);
  for (const campo of camposDoBloco) {
    const termos = termosSignificativos(campo.rotulo);
    if (termos.some((termo) => textoNormalizado.includes(termo))) return campo.id;
  }
  return null;
}

/**
 * Mescla o tema categorizado (se houver) no `ResumoAcumulado` já existente, e
 * recalcula `pendente` contra `camposDoBloco` (o bloco atual DESTA chamada —
 * `pendente` é sempre recomputado, nunca só copiado do que já estava).
 *
 * `tema === null` (pergunta não categorizou, ou não havia `proxima_pergunta`
 * nesta chamada) ainda assim recalcula `pendente` — o bloco pode ter mudado
 * desde a última escrita mesmo sem pergunta nova para acumular.
 *
 * UPSERT por `t` (mesmo padrão de `acumularInventario`): tema novo entra no
 * fim (preserva ordem de 1ª menção); tema já existente soma `n` e atualiza
 * `em` para a mais recente. NUNCA remove um tema já perguntado — mesma regra
 * "anti-piscada" do inventário: silêncio sobre um tema não é prova de que ele
 * deixou de ter sido perguntado.
 *
 * Poda por bytes ANTES de devolver: mede `pg_column_size`-equivalente em
 * JS (`JSON.stringify(...).length` em bytes UTF-8, ver `tamanhoEmBytes`) e,
 * se passar do teto de produto (3500 B, margem contra o CHECK de 4096 da
 * 0091), remove o item MENOS RECENTE de `perguntado` (por `em`) até caber —
 * nunca deixa o CHECK do banco recusar o UPDATE inteiro e perder a memória
 * junto (cinto de segurança pedido pelo dono).
 */
export function acumularResumo(
  acumulado: ResumoAcumulado,
  params: { tema: string | null; agoraIso: string; camposDoBloco: RoteiroCampo[] },
): ResumoAcumulado {
  const porTema = new Map<string, ItemResumoAcumulado>();
  for (const item of acumulado.perguntado) porTema.set(item.t, item);

  if (params.tema) {
    const existente = porTema.get(params.tema);
    if (existente) {
      porTema.set(params.tema, { ...existente, em: params.agoraIso, n: existente.n + 1 });
    } else {
      porTema.set(params.tema, { t: params.tema, em: params.agoraIso, n: 1 });
    }
  }

  const perguntadoBruto = Array.from(porTema.values());
  const pendenteBruto = derivarPendente(perguntadoBruto, params.camposDoBloco);

  return podarPorBytes({ v: 1, perguntado: perguntadoBruto, pendente: pendenteBruto, cortado_em: acumulado.cortado_em ?? null });
}

/** `pendente` = `campos[]` do bloco atual MENOS os `id` já em `perguntado` —
 * mesma unidade dos dois lados (`campo.id`), sem tradução no meio (decisão do
 * dono: é o que torna o vocabulário dinâmico possível sem enum fixo).
 * Preserva a ordem de `campos[]` do roteiro (a ordem que a Dra. Elaine
 * cadastrou), cortada no teto de produto. */
function derivarPendente(perguntado: ItemResumoAcumulado[], camposDoBloco: RoteiroCampo[]): string[] {
  const jaPerguntados = new Set(perguntado.map((item) => item.t));
  return camposDoBloco.map((c) => c.id).filter((id) => !jaPerguntados.has(id)).slice(0, TETO_PENDENTE);
}

/** Tamanho em bytes UTF-8 do jsonb serializado — aproxima `pg_column_size`
 * (que mede o TOAST/armazenamento real, sempre igual ou levemente MAIOR que
 * o UTF-8 puro por causa de overhead de jsonb binário; a margem de 3500 contra
 * o CHECK de 4096 cobre essa diferença com folga, 596 bytes). */
function tamanhoEmBytes(resumo: ResumoAcumulado): number {
  return Buffer.byteLength(JSON.stringify(resumo), "utf8");
}

/**
 * Corta `perguntado` no teto de contagem (`TETO_PERGUNTADO`) e depois por
 * BYTES até caber no alvo de produto (`TETO_BYTES_ALVO`) — sempre removendo o
 * item MENOS RECENTE (`em` mais antigo) primeiro, nunca aleatório: um tema
 * perguntado há muito tempo na sessão é o candidato mais seguro a esquecer
 * (se voltar a ser perguntado, reentra como item novo). `pendente` já vem
 * cortado no teto de contagem por `derivarPendente` — não participa da poda
 * por bytes (é sempre pequeno: no máximo 8 strings curtas, teto de contagem
 * já suficiente).
 */
function podarPorBytes(resumo: ResumoAcumulado): ResumoAcumulado {
  let atual: ResumoAcumulado = {
    ...resumo,
    perguntado: [...resumo.perguntado].sort((a, b) => Date.parse(b.em) - Date.parse(a.em)).slice(0, TETO_PERGUNTADO),
  };

  while (atual.perguntado.length > 0 && tamanhoEmBytes(atual) > TETO_BYTES_ALVO) {
    // Remove o mais antigo (último do array, já ordenado do mais recente
    // para o mais antigo acima).
    atual = { ...atual, perguntado: atual.perguntado.slice(0, -1) };
  }

  return atual;
}

/**
 * O que REALMENTE entra no bloco E do contexto de IA — recalcula `pendente`
 * contra `camposDoBlocoAtual` (o bloco em que a sessão está AGORA, nesta
 * chamada) em vez de confiar no `pendente` persistido, que pode ter sido
 * calculado com o bloco de uma chamada anterior (a advogada avança de bloco
 * entre chamadas do ciclo automático; `pendente` gravado ficaria mentindo
 * sobre um bloco que já foi deixado para trás). Pura — nenhum I/O.
 */
export function resumirParaContexto(acumulado: ResumoAcumulado, camposDoBlocoAtual: RoteiroCampo[]): ResumoAcumulado {
  return { ...acumulado, pendente: derivarPendente(acumulado.perguntado, camposDoBlocoAtual) };
}

/** Estado inicial de uma sessão sem nenhum resumo gravado ainda — exportado
 * para `contexto.ts` usar o MESMO vazio ao resumir para a IA (nunca uma 2ª
 * literal que possa divergir desta). */
export const RESUMO_VAZIO: ResumoAcumulado = { v: 1, perguntado: [], pendente: [], cortado_em: null };

/**
 * 🔴 `sessoes_copiloto.resumo_acumulado` NASCE `'{}'::jsonb` (default da
 * 0091, ANTES desta fatia existir) — é um valor REAL gravado em toda sessão
 * já criada, não `null`. `data?.resumo_acumulado ?? RESUMO_VAZIO` sozinho
 * NÃO PEGA esse caso (`??` só ativa em `null`/`undefined`; `{}` é um objeto
 * truthy) — sem esta função, a 1ª leitura de qualquer sessão pré-existente
 * quebraria em runtime tentando ler `.perguntado` de `{}`.
 *
 * Normaliza QUALQUER jsonb bruto do banco (incluindo `{}` legado, `null`, ou
 * um formato futuro incompatível que uma migration de rollback tenha deixado
 * para trás) para `ResumoAcumulado` válido — nunca lança, sempre cai em
 * `RESUMO_VAZIO` quando a forma não bate exatamente com o contrato atual.
 * Checagem estrutural mínima (campos certos, tipos certos), não um parser
 * exaustivo: é o mesmo nível de defesa de `normalizarParticipantesBrutos`
 * (participantes.ts) para o mesmo tipo de jsonb solto.
 */
export function normalizarResumoAcumulado(bruto: unknown): ResumoAcumulado {
  if (!bruto || typeof bruto !== "object") return RESUMO_VAZIO;
  const obj = bruto as Record<string, unknown>;
  if (!Array.isArray(obj.perguntado) || !Array.isArray(obj.pendente)) return RESUMO_VAZIO;

  const perguntado: ItemResumoAcumulado[] = obj.perguntado.filter(
    (item): item is ItemResumoAcumulado =>
      !!item &&
      typeof item === "object" &&
      typeof (item as ItemResumoAcumulado).t === "string" &&
      typeof (item as ItemResumoAcumulado).em === "string" &&
      typeof (item as ItemResumoAcumulado).n === "number",
  );
  const pendente = obj.pendente.filter((item): item is string => typeof item === "string");
  const cortadoEm = typeof obj.cortado_em === "string" ? obj.cortado_em : null;

  return { v: 1, perguntado, pendente, cortado_em: cortadoEm };
}

/** `copiloto_sessao.resumo_acumulado` (migration 0120) — kill-switch
 * FAIL-CLOSED (B76, decisão do dono): config ilegível ou desligada = memória
 * NÃO É LIDA nem ESCRITA, nunca o contrário. Diferente do fail-OPEN de
 * `dossieClienteEstaAtivo`/`inventarioMencionadoEstaAtivo` (dado cadastral já
 * visível na Ficha do cliente antes do copiloto existir) — aqui é dado NOVO,
 * derivado só da fala da sessão, sem outro lugar onde já apareça; "não sei se
 * está ligado" tem de cair no lado que não grava nada. */
export const CHAVE_RESUMO_ACUMULADO_ATIVO = "copiloto_sessao.resumo_acumulado";

export async function resumoAcumuladoEstaAtivo(supabase: SupabaseClient): Promise<boolean> {
  try {
    return await lerConfiguracaoBool(supabase, CHAVE_RESUMO_ACUMULADO_ATIVO, false);
  } catch {
    return false;
  }
}

/**
 * I/O — chamado pela ROTA (`sugestao/route.ts`) e pelo CICLO (`ciclo.ts`)
 * DEPOIS de `validarSugestaoCopiloto`, mesmo ponto de chamada de
 * `acumularInventarioNaSessao` (depois do INSERT de `copiloto_sugestoes`
 * confirmado — nunca antes: uma sugestão recusada pelo backstop do banco não
 * deveria deixar rastro na memória).
 *
 * 🔴 `ativo` é PARÂMETRO OBRIGATÓRIO, não lido aqui dentro (achado do Fable —
 * leitura duplicada de config). O CHAMADOR já leu `resumoAcumuladoEstaAtivo`
 * UMA VEZ, dentro do MESMO `Promise.all` de `ciclo.ts` que também monta o
 * contexto (que também precisa do mesmo valor, ver `contexto.ts`) — repassar
 * por parâmetro em vez de reler aqui elimina 1 REST por ciclo (e mais 1 na
 * rota sob demanda), mesmo quando desligado. A 0120 promete "ZERO
 * round-trip novo"; sem este parâmetro, a promessa era falsa.
 *
 * Sai ANTES de qualquer leitura quando `ativo=false` (B76, fail-CLOSED) OU
 * quando não há `proxima_pergunta` nesta chamada E o bloco atual não trouxe
 * `campos` (nada para categorizar, nada para derivar `pendente` de novo) —
 * mesma disciplina de "caminho comum sem custo extra" de
 * `acumularInventarioNaSessao`.
 *
 * 1 SELECT + 1 UPDATE por chamada com pergunta nova (não é `upsert` solto: é
 * a escrita CAS via RPC `registrar_resumo_copiloto`, 0120 — evita a MESMA
 * corrida que a 0105 corrigiu para `participantes`, ciclo automático e botão
 * "Me ajuda agora" podendo escrever a mesma sessão quase ao mesmo tempo).
 * Retentativa: 1 vez (relê o estado atual devolvido pelo CAS e tenta de novo
 * com ele) — falhando de novo, desiste com `registrarErro`, nunca trava o
 * caminho quente do ciclo.
 */
export async function acumularResumoNaSessao(
  admin: SupabaseClient,
  params: {
    sessaoId: string;
    ativo: boolean;
    textoPerguntaSugerida: string | null;
    camposDoBlocoAtual: RoteiroCampo[];
    agoraIso?: string;
  },
): Promise<void> {
  // 🔴 CORRIGIDO (achado do Fable): "nunca derruba o ciclo" tinha de estar no
  // CÓDIGO, não só no comentário. Sem este try/catch, um TypeError dentro de
  // `acumularResumo`/`gravarComRetentativa` (ex.: o defeito do `{}` legado
  // corrigido acima, ou qualquer exceção futura não prevista) SOBE para o
  // chamador (`ciclo.ts`/`sugestao/route.ts`) DEPOIS do INSERT de
  // `copiloto_sugestoes` já ter confirmado — o ciclo cai no `catch` de
  // `executarCicloCopiloto` e devolve `bloqueado_pelo_gate`/`recusado_pelo_banco`,
  // e a rota sob demanda devolve HTTP 500 para a advogada, com a sugestão já
  // gravada. Memória é acréscimo, nunca caminho crítico — qualquer falha
  // aqui é `registrarErro` + retorno silencioso, igual a toda outra função
  // `acumularXNaSessao` da casa (`inventario.ts`), mas ali a garantia nasce
  // de cada `await` já ter seu próprio tratamento; aqui, com CAS e
  // retentativa, a defesa em profundidade de um try/catch no CONTORNO
  // inteiro é o que sustenta essa mesma promessa.
  try {
    await acumularResumoNaSessaoInterno(admin, params);
  } catch (erro) {
    registrarErro("copiloto/resumo.acumularResumoNaSessao", erro, { sessao_id: params.sessaoId });
  }
}

async function acumularResumoNaSessaoInterno(
  admin: SupabaseClient,
  params: {
    sessaoId: string;
    ativo: boolean;
    textoPerguntaSugerida: string | null;
    camposDoBlocoAtual: RoteiroCampo[];
    agoraIso?: string;
  },
): Promise<void> {
  if (!params.ativo) return;
  if (!params.textoPerguntaSugerida && params.camposDoBlocoAtual.length === 0) return;

  const agoraIso = params.agoraIso ?? new Date().toISOString();
  const tema = params.textoPerguntaSugerida ? categorizarPergunta(params.textoPerguntaSugerida, params.camposDoBlocoAtual) : null;

  // Sem tema novo E sem `pendente` para recalcular de fato (bloco sem campo
  // nenhum) não vale escrita nenhuma — mas isso já foi filtrado acima
  // (`camposDoBlocoAtual.length === 0`); daqui para baixo sempre há ao menos
  // uma tentativa de leitura, porque OU há tema novo OU há campos para
  // recalcular `pendente` contra o bloco atual.

  const { data, error: erroLeitura } = await admin
    .from("sessoes_copiloto")
    .select("resumo_acumulado")
    .eq("sessao_id", params.sessaoId)
    .maybeSingle<{ resumo_acumulado: unknown }>();
  if (erroLeitura) {
    registrarErro("copiloto/resumo.acumularResumoNaSessao#ler", erroLeitura, { sessao_id: params.sessaoId });
    return;
  }

  // 🔴 CORRIGIDO (achado do Fable, confirmado contra o banco real: a coluna
  // NASCE `'{}'::jsonb` — default da 0091, gravado em TODA sessão, não só
  // nas 3 antigas). O TOKEN do CAS tem de ser o jsonb BRUTO exatamente como
  // veio do banco (`brutoDoBanco`), NUNCA o normalizado: a RPC compara
  // `p_resumo_esperado` byte a byte (via `is not distinct from`) contra o
  // que está gravado agora, e `'{}'::jsonb is not distinct from
  // '{"v":1,...}'::jsonb` é FALSE — mandar o normalizado como esperado faz
  // o CAS recusar TODA sessão que ainda não foi escrita por esta fatia, e a
  // linha nunca sai de `{}`. `normalizarResumoAcumulado(brutoDoBanco)` serve
  // só para CALCULAR o `novo` (a lógica de acumulação precisa de um
  // `ResumoAcumulado` tipado) — o valor enviado como "o que eu li" continua
  // sendo o bruto.
  const brutoDoBanco = data?.resumo_acumulado ?? null;
  const atual = normalizarResumoAcumulado(brutoDoBanco);
  const novo = acumularResumo(atual, { tema, agoraIso, camposDoBloco: params.camposDoBlocoAtual });

  // Nada mudou de fato (nem tema novo, nem `pendente` recalculado é
  // diferente) — não escreve à toa. Comparação contra a forma NORMALIZADA
  // (não o bruto): `{}` legado sempre "muda" para o formato novo na 1ª
  // chamada de uma sessão, e é exatamente essa escrita que precisa acontecer.
  if (JSON.stringify(atual) === JSON.stringify(novo)) return;

  await gravarComRetentativa(admin, params.sessaoId, brutoDoBanco, novo, { tema, agoraIso, camposDoBloco: params.camposDoBlocoAtual });
}

interface ResultadoCas {
  aplicado: boolean;
  // 🔴 BRUTO, não `ResumoAcumulado` (achado do Fable): quando `aplicado=false`,
  // a RPC devolve `v_atual` exatamente como está gravado — que pode ser o
  // `'{}'::jsonb` legado. Tipar como `ResumoAcumulado` aqui escondia o
  // defeito: `resumo.perguntado` parecia sempre existir para o TypeScript,
  // mas em runtime podia ser `undefined` (`{}` não tem essa chave).
  resumo: unknown;
}

/**
 * Escreve via CAS (`registrar_resumo_copiloto`, 0120) — se outra requisição
 * escreveu no meio do caminho (ciclo automático + botão "Me ajuda agora" nos
 * mesmos ~20s), a RPC recusa e devolve o estado ATUAL; este módulo reaplica o
 * MERGE por cima dele e tenta UMA vez a mais (mesmo formato de retentativa de
 * `registrarSegmentoDoBot`/`entrada-bot.ts` para colisão de `ordem`/CAS de
 * participantes). Falhando na 2ª tentativa também, desiste — `registrarErro`,
 * nunca trava o ciclo por causa de memória (a sugestão em si já foi gravada
 * antes desta chamada; memória é acréscimo, não caminho crítico).
 *
 * `esperadoBruto` é SEMPRE o valor cru — o que o TS leu do banco na 1ª
 * chamada, ou o que a RPC devolveu como `v_atual` na retentativa. NUNCA o
 * normalizado: a comparação da RPC é `is not distinct from` contra o jsonb
 * REAL gravado, e `'{}'::jsonb` (legado/default da 0091) nunca é igual a
 * `'{"v":1,...}'::jsonb` (a forma normalizada) — mandar o normalizado como
 * esperado faria o CAS recusar SEMPRE, para toda sessão ainda não escrita
 * por esta fatia (achado do Fable, confirmado contra produção).
 */
async function gravarComRetentativa(
  admin: SupabaseClient,
  sessaoId: string,
  esperadoBruto: unknown,
  novo: ResumoAcumulado,
  paramsRecalculo: { tema: string | null; agoraIso: string; camposDoBloco: RoteiroCampo[] },
): Promise<void> {
  const primeira = await chamarCas(admin, sessaoId, esperadoBruto, novo);
  if (primeira === null) return; // erro já registrado dentro de chamarCas
  if (primeira.aplicado) return;

  // CAS recusou: outra requisição já escreveu. `primeira.resumo` é o estado
  // ATUAL, cru — normaliza só para CALCULAR o merge (nunca para reenviar
  // como esperado: a 2ª chamada usa `primeira.resumo` bruto, o mesmo
  // raciocínio da 1ª tentativa).
  const atualNormalizado = normalizarResumoAcumulado(primeira.resumo);
  const recalculado = acumularResumo(atualNormalizado, paramsRecalculo);
  if (JSON.stringify(atualNormalizado) === JSON.stringify(recalculado)) return; // nada a fazer sobre o estado novo

  const segunda = await chamarCas(admin, sessaoId, primeira.resumo, recalculado);
  if (segunda === null || segunda.aplicado) return;

  // 2ª tentativa também perdeu a corrida — desiste. Log para investigação
  // manual; não segura o caminho quente com uma 3ª tentativa.
  registrarErro("copiloto/resumo.gravarComRetentativa", new Error("cas_recusado_duas_vezes"), { sessao_id: sessaoId });
}

async function chamarCas(
  admin: SupabaseClient,
  sessaoId: string,
  esperadoBruto: unknown,
  novo: ResumoAcumulado,
): Promise<ResultadoCas | null> {
  const { data, error } = await admin
    .rpc("registrar_resumo_copiloto", {
      p_sessao_id: sessaoId,
      p_resumo_esperado: esperadoBruto,
      p_resumo_novo: novo,
    })
    .maybeSingle<ResultadoCas>();
  if (error || !data) {
    registrarErro("copiloto/resumo.chamarCas", error ?? new Error("cas_sem_retorno"), { sessao_id: sessaoId });
    return null;
  }
  return data;
}
