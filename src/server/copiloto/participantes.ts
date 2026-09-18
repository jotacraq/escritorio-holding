/**
 * Fase 10, Fatia 4c e Fatia 3 de papéis de fala (docs/ARQUITETURA-FASE-10.md
 * §5 "camada 1", §7, §8, §12). A CAMADA 1 do caso dos decisores — fato, SEM
 * IA nenhuma: compara quem o webhook do bot relatou como presente
 * (`participant_events.join`/`.leave`) contra `processo_decisorio.decisores`
 * do briefing atual. Casamento por nome normalizado; AMBÍGUO NÃO CASA (mesma
 * postura do porteiro da Fase 9, `server/agente-whatsapp/porteiro.ts`:
 * cardinalidade explícita, nunca escolher a pessoa errada em silêncio).
 *
 * PII (§7): `sessoes_copiloto.participantes` guarda NOME de pessoa real —
 * é dado do escritório, sob RLS de `app.ve_patrimonio()` (0091), igual à
 * transcrição. Este módulo NUNCA manda nome para a IA — quem monta o
 * contexto de IA (`contexto.ts`) já só lê PAPEL (nunca nome) a partir daqui.
 * `compararComDecisores()` é para a TELA (fato determinístico), não para o
 * prompt.
 *
 * `papel` (15/09/2026, Fatia 3 de papéis de fala) — gravado NA ESCRITA
 * (aqui), nunca recalculado na leitura (`contexto.ts`): o papel tem de ser
 * ESTÁVEL na sessão inteira. Se fosse resolvido a cada montagem de contexto,
 * um decisor que sai e volta faria `decisor_1` trocar de pessoa entre ciclos
 * (decisão de arquitetura registrada pelo coordenador, 15/09/2026).
 */

import { semTratamento } from "./equipe";

// ---------------------------------------------------------------------------
// Registro de join/leave — chamado pelo webhook (server/copiloto/recall no
// caminho de entrada, route.ts de fato grava).
// ---------------------------------------------------------------------------

/** Papel estável de fala — o que o PROMPT recebe, NUNCA o nome (§7 do
 * plano). `"advogada"` (is_host), `"decisor_N"` (casou sem ambiguidade com o
 * N-ésimo decisor de `processo_decisorio.decisores`, N pela ORDEM do
 * briefing, não pela ordem de chegada), `"acompanhante_N"` (presente, mas
 * nem host nem decisor — N pela ordem de chegada entre os acompanhantes),
 * `null` = ainda não resolvido (sessão em andamento de antes desta fatia, ou
 * `papeis_de_fala` desligado) — cai no fallback `"participante"` genérico
 * em `contexto.ts::rotuloFalante`, comportamento idêntico ao de antes. */
export type PapelFala = "advogada" | "assistente" | `decisor_${number}` | `acompanhante_${number}`;

export interface ParticipanteRegistrado {
  /** Id nativo do provedor (Recall/Meet), quando presente — chave PREFERIDA
   * para herdar papel entre join/leave/join da mesma pessoa (mais estável
   * que nome, que pode variar de grafia entre eventos do mesmo participante
   * — medido em produção em 15/09/2026). `null` quando o evento não trouxe
   * `participant.id` (formato legado, ou provedor que não o envia). */
  id: string | null;
  /** `null` quando o evento só trouxe `id`, sem `name` (§ webhook, 15/09) —
   * essa pessoa NUNCA pode virar `decisor_N` (não há nome para casar com o
   * briefing): fica sempre acompanhante ou host. */
  nome: string | null;
  entrou_em: string;
  saiu_em: string | null;
  /** `null` = ainda não resolvido (compatibilidade — ver `PapelFala`). */
  papel: PapelFala | null;
}

/**
 * 🔴 O PRÓPRIO BOT emite `participant_events.join`/`.leave` de si mesmo — o
 * Recall o trata como um participante normal da chamada (medido em produção,
 * 15/09/2026: 3 dos 15 eventos reais eram o bot entrando/saindo). Sem este
 * filtro, o bot viraria `acompanhante_N` (não é host, não casa com decisor
 * do briefing) — a IA receberia falas rotuladas como se houvesse uma pessoa
 * a mais na sala, e `decisores_presentes` ficaria inflado.
 *
 * NÃO EXISTE identificador exato para isto: `participant.id` é da PLATAFORMA
 * (Meet), não nosso; `sessoes_copiloto.gravacao_externa_id` é o id do BOT no
 * Recall, não do PARTICIPANTE que ele assume na chamada — os dois não se
 * cruzam no payload de `participant_events`. E o nome não é comparável por
 * IGUALDADE: `NOME_BOT` (`bot/route.ts`) é `"Assistente — Escritório Elaine
 * Montenegro"` (em-dash, acentuado) — a Recall GRAVOU
 * `"Assistente - Escritorio Elaine Montenegro"` (hífen simples, sem acento;
 * a plataforma normaliza o nome enviado). Existe ainda uma 2ª variante real
 * na base, `"Assistente PT-BR - Escritorio Elaine Montenegro"` — o nome do
 * bot já mudou entre versões, então comparação por igualdade OU por prefixo
 * rígido envelheceria mal.
 *
 * A regra: normaliza (`normalizarNome`, que já tira acento/caixa) E unifica
 * travessão/en-dash/em-dash em hífen simples ANTES de comparar, depois exige
 * que o nome COMECE por "assistente" E CONTENHA o núcleo estável
 * "escritorio elaine montenegro" — tolera "PT-BR" e outras variações no
 * meio, sem virar um `includes` tão largo que capturasse um humano
 * (§ risco pedido pelo coordenador: "errar para incluir demais é menos grave
 * que sumir com um decisor" — mas aqui o objetivo é o oposto, então o padrão
 * é ESPECÍFICO o bastante para não casar por acidente com nome de pessoa
 * real: precisaria começar por "assistente" E conter o nome do escritório,
 * combinação improvável em nome de decisor/acompanhante). */
function ehParticipanteBot(nome: string | null): boolean {
  if (!nome) return false;
  const normalizado = normalizarNome(nome).replace(/[—–]/g, "-");
  return normalizado.startsWith("assistente") && normalizado.includes("escritorio elaine montenegro");
}

/** EXPORTADA (15/09/2026, papéis de fala): `entrada-bot.ts` reusa esta
 * função para reconstruir `ParticipanteRegistrado[]` a partir do jsonb cru
 * ANTES de chamar `resolverPapelNoJoin` (que precisa da lista tipada, não do
 * jsonb bruto) — mesma leitura defensiva usada aqui dentro, nenhuma 2ª
 * implementação divergente. */
export function normalizarParticipantesBrutos(bruto: unknown): ParticipanteRegistrado[] {
  if (!Array.isArray(bruto)) return [];
  const resultado: ParticipanteRegistrado[] = [];
  for (const item of bruto) {
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const nome = typeof obj.nome === "string" ? obj.nome : null;
      const entrouEm = typeof obj.entrou_em === "string" ? obj.entrou_em : null;
      if (entrouEm === null || (nome === null && typeof obj.id !== "string")) continue; // entrada sem identificação mínima — descartada
      const saiuEm = obj.saiu_em;
      const id = obj.id;
      const papel = obj.papel;
      resultado.push({
        id: typeof id === "string" ? id : null,
        nome,
        entrou_em: entrouEm,
        saiu_em: typeof saiuEm === "string" ? saiuEm : null,
        papel: typeof papel === "string" ? (papel as PapelFala) : null,
      });
    }
  }
  return resultado;
}

/**
 * Aplica um evento `participant_events.join`/`.leave` sobre a lista atual —
 * função PURA (o chamador lê `sessoes_copiloto.participantes`, aplica aqui,
 * grava o resultado). Ninguém escreve direto no jsonb fora daqui.
 *
 * JOIN: acrescenta uma entrada nova (mesma pessoa pode entrar/sair/entrar de
 * novo na mesma sessão — cada entrada é seu próprio par entrou/saiu, nunca
 * sobrescreve a anterior; é histórico, não estado único por nome). O `papel`
 * da entrada nova HERDA de qualquer entrada anterior (aberta ou fechada) da
 * MESMA pessoa — preferindo casar por `id` (mais estável), caindo para nome
 * normalizado se `id` não bater ou não existir de um dos lados. Isso é o que
 * impede `decisor_1` de virar `decisor_3` quando a pessoa sai e volta
 * (15/09/2026, decisão de arquitetura do coordenador). `papel` novo, ainda
 * sem entrada anterior, é resolvido pelo CHAMADOR (`entrada-bot.ts`) e
 * passado em `evento.papel` — este módulo nunca decide papel sozinho, só
 * herda ou aceita o que já veio decidido.
 *
 * LEAVE: fecha a entrada MAIS RECENTE com `saiu_em` ainda nulo, casando por
 * `id` (preferência) ou nome normalizado (fallback) — se não houver nenhuma
 * aberta casando, o evento é ignorado (reentrega do webhook, ou leave sem
 * join correspondente conhecido — nunca inventa uma entrada de join que não
 * aconteceu).
 *
 * 🔴 O PRÓPRIO BOT (`ehParticipanteBot`, ver comentário acima) NUNCA entra
 * na lista — nem como `join` nem fechando um `leave` — a lista devolvida é
 * IDÊNTICA à recebida. Medido em produção (15/09/2026): sem este filtro, o
 * bot apareceria como `acompanhante_N` e inflaria `decisores_presentes`.
 */
export function aplicarEventoParticipante(
  participantesAtuais: unknown,
  evento: { tipo: "join" | "leave"; nome: string | null; id: string | null; quando: string; papel?: PapelFala },
): ParticipanteRegistrado[] {
  const lista = normalizarParticipantesBrutos(participantesAtuais);
  if (ehParticipanteBot(evento.nome)) return lista;
  const nomeNormalizado = evento.nome !== null ? normalizarNome(evento.nome) : null;

  const casaMesmaPessoa = (p: ParticipanteRegistrado): boolean => {
    if (evento.id !== null && p.id !== null) return p.id === evento.id;
    if (nomeNormalizado !== null && p.nome !== null) return normalizarNome(p.nome) === nomeNormalizado;
    return false;
  };

  if (evento.tipo === "join") {
    // Herda o papel de QUALQUER entrada anterior da mesma pessoa (aberta ou
    // fechada) — nunca gera decisor_3 para quem já era decisor_1.
    const anterior = [...lista].reverse().find(casaMesmaPessoa);
    const papel = anterior?.papel ?? evento.papel ?? null;
    return [...lista, { id: evento.id, nome: evento.nome, entrou_em: evento.quando, saiu_em: null, papel }];
  }

  // leave: fecha a entrada aberta mais recente que casa com esta pessoa.
  let indiceParaFechar = -1;
  for (let i = lista.length - 1; i >= 0; i--) {
    if (lista[i]!.saiu_em === null && casaMesmaPessoa(lista[i]!)) {
      indiceParaFechar = i;
      break;
    }
  }
  if (indiceParaFechar === -1) return lista; // nada para fechar — silêncio, não é erro

  return lista.map((p, i) => (i === indiceParaFechar ? { ...p, saiu_em: evento.quando } : p));
}

// ---------------------------------------------------------------------------
// Camada 1 — comparação, SEM IA (§5 do plano).
// ---------------------------------------------------------------------------

/** Minúsculas, sem acento, espaço único — mesmo espírito de normalização de
 * texto usado no resto da casa (regra dura do incidente de 19/08:
 * `lower(btrim(x))`, nunca a ordem trocada — aqui não há índice de banco
 * envolvido, mas a MESMA função tem de normalizar os dois lados, senão
 * "Terezinha" e "terezinha " nunca casam por acidente de espaço). */
export function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export interface DecisorCasado {
  nomeBriefing: string;
  nomeParticipante: string;
}

export interface ComparacaoDecisores {
  decisoresEsperados: string[];
  /** Só quem está presente AGORA (`saiu_em is null`) — alguém que entrou e
   * já saiu não conta como presente para esta comparação. */
  participantesPresentes: string[];
  /** Decisor do briefing que casou, sem ambiguidade, com exatamente 1
   * participante presente. */
  presentes: DecisorCasado[];
  /** Decisor do briefing que NÃO tem nenhum participante presente casando
   * — é o fato que sustenta "Cleison não entrou". */
  ausentes: string[];
  /** Decisor cujo nome casaria com MAIS DE UM participante presente (nomes
   * comuns, ou dois participantes com nome igual/semelhante) — AMBÍGUO NÃO
   * CASA (postura do porteiro): fica de fora de `presentes` E de `ausentes`,
   * porque nenhuma das duas afirmações seria fato conferível. A tela mostra
   * como "não foi possível confirmar", nunca escolhe um dos dois. */
  ambiguos: string[];
}

/**
 * Remove qualificador entre parênteses: `"Rodrigo (marido e sócio)"` →
 * `"Rodrigo"`. Achado do coordenador (15/09/2026, briefing real em
 * produção): `processo_decisorio.decisores` é gerado por IA a partir do
 * relato da ligação (`schema-briefing.ts`) e VEM com qualificador entre
 * parênteses quando a advogada explicou o papel da pessoa; o nome que a
 * Recall manda do participante real da reunião nunca traz esse qualificador.
 * Sem isto, o casamento por nome completo NUNCA bateria para esse decisor —
 * ele cairia em `ausentes` estando presente na sala ("Rodrigo não entrou",
 * mentira, com ele falando). */
function semQualificadorEntreParenteses(nome: string): string {
  return nome.replace(/\s*\([^)]*\)\s*/g, " ").trim();
}

/** Primeiro "token" do nome normalizado — usado só como ÚLTIMO recurso de
 * casamento (ver `compararComDecisores`), nunca como a normalização
 * primária: casar por primeiro nome aumenta ambiguidade de propósito (é o
 * comportamento CORRETO quando há "Rodrigo Pai" e "Rodrigo Filho" na sala —
 * ambíguo não casa, `participantes.ts` já trata isso na função de baixo). */
function primeiroNome(nomeNormalizado: string): string {
  return nomeNormalizado.split(" ")[0] ?? nomeNormalizado;
}

/** Um decisor do briefing contra a lista de nomes presentes — devolve os
 * nomes presentes que casam sob uma dada função de normalização. Auxiliar de
 * `compararComDecisores`, para tentar normalizações progressivamente mais
 * permissivas SEM duplicar o laço de comparação em cada uma. */
function casamentosSob(decisor: string, presentesBrutos: string[], normalizar: (s: string) => string): string[] {
  const alvo = normalizar(decisor);
  return presentesBrutos.filter((p) => normalizar(p) === alvo);
}

/**
 * Compara `processo_decisorio.decisores` do briefing (nomes, geradas por IA
 * a partir do que já foi relatado — `server/ia/schema-briefing.ts`) contra
 * quem está PRESENTE agora na sala (join sem leave correspondente). Função
 * PURA — nenhuma chamada de IA, nenhuma consulta a banco: o chamador já leu
 * os dois lados.
 *
 * 🔴 TRÊS PASSADAS, cada uma só tentada se a anterior não achou NENHUM
 * candidato (0 casamentos) — nunca se a anterior já resolveu, mesmo que como
 * ambíguo (achado do coordenador, 15/09/2026: "prefira errar para ambíguo do
 * que para falso-positivo"; regredir de ambíguo para presente por uma
 * normalização mais frouxa seria escolher um dos dois candidatos, exatamente
 * o que a postura do porteiro proíbe):
 *   1. `normalizarNome` — nome completo, comportamento original da fatia 4c.
 *   2. `normalizarNome` + parênteses removidos — cobre
 *      `"Rodrigo (marido e sócio)"` vs `"Rodrigo"`.
 *   3. primeiro nome (sobre o resultado da passada 2) — último recurso; é
 *      esta passada que fica mais sujeita a ambiguidade por desenho (2
 *      "Rodrigo" na sala viram `ambiguos`, nunca um palpite).
 * Cada passada aplica a MESMA regra de cardinalidade (0/1/2+) — só decide o
 * destino final quando encontra 1+ candidato.
 */
export function compararComDecisores(decisoresEsperados: string[], participantesAtuais: unknown): ComparacaoDecisores {
  const lista = normalizarParticipantesBrutos(participantesAtuais);
  const presentesBrutos = lista
    .filter((p) => p.saiu_em === null && p.nome !== null)
    .map((p) => p.nome as string);

  const presentes: DecisorCasado[] = [];
  const ausentes: string[] = [];
  const ambiguos: string[] = [];

  for (const decisor of decisoresEsperados) {
    const passadas: Array<(s: string) => string> = [
      (s) => normalizarNome(s),
      (s) => normalizarNome(semQualificadorEntreParenteses(s)),
      (s) => primeiroNome(normalizarNome(semQualificadorEntreParenteses(s))),
    ];

    let resolvido = false;
    for (const normalizar of passadas) {
      const casamentos = casamentosSob(decisor, presentesBrutos, normalizar);
      if (casamentos.length === 0) continue; // nenhum candidato — tenta a próxima passada, mais permissiva
      if (casamentos.length === 1) {
        presentes.push({ nomeBriefing: decisor, nomeParticipante: casamentos[0]! });
      } else {
        // 2+ candidatos sob esta normalização — AMBÍGUO NÃO CASA, e não
        // tenta passada seguinte (regrediria de ambíguo para um palpite).
        ambiguos.push(decisor);
      }
      resolvido = true;
      break;
    }
    if (!resolvido) ausentes.push(decisor); // nenhuma das 3 passadas achou candidato — de fato ausente
  }

  return { decisoresEsperados, participantesPresentes: presentesBrutos, presentes, ausentes, ambiguos };
}

// ---------------------------------------------------------------------------
// 🔴 REMOVIDO (achado do Fable, revisão de Solidificação): existia aqui uma
// `buscarDecisoresEsperados(supabase, jornadaId)` — exportada, documentada,
// SEM NENHUM CHAMADOR. `server/copiloto/estado.ts::extrairDecisoresEsperados`
// é o caminho REAL usado no payload do polling (lê do MESMO embed coalescido
// de `montarEstadoCopiloto`, sem 2ª query). Manter os dois seria um 2º
// caminho de leitura do briefing que podia DIVERGIR do que a tela mostra —
// "remova ou use": removido, porque usar aqui recriaria exatamente a query
// extra por ciclo que a correção anterior desta fatia eliminou.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Resolução de PAPEL no momento do join — Fase 10, papéis de fala
// (15/09/2026). Chamada por `entrada-bot.ts::registrarEventoParticipante`
// ANTES de `aplicarEventoParticipante`, só para eventos `join` de gente sem
// papel herdado (`aplicarEventoParticipante` já herda de entrada anterior —
// esta função só decide o papel de QUEM NUNCA APARECEU antes na sessão).
// ---------------------------------------------------------------------------

/**
 * Ordem de resolução (decisão do dono, 15/09/2026, inegociável):
 *   1. `isHost === true` → "advogada" (só 1; um 2º host — cenário raro,
 *      co-anfitrião — vira acompanhante: só a PRIMEIRA pessoa host detectada
 *      na sessão leva o papel "advogada", ver `jaTemAdvogada`).
 *   2. Casa com decisor do briefing, SEM AMBIGUIDADE (reusa
 *      `compararComDecisores` — função pura já testada, não duplicada) →
 *      "decisor_N", N pela ORDEM em `processo_decisorio.decisores`
 *      (determinístico, estável entre reinícios — nunca pela ordem de
 *      chegada na sala).
 *   3. Resto → "acompanhante_N", N pela ordem de CHEGADA entre os
 *      acompanhantes já registrados nesta sessão (conta quantos já existem
 *      com papel `acompanhante_*` e usa o próximo número).
 *   Ambíguo (`comparacao.ambiguos`) → cai no passo 3 (acompanhante genérico),
 *      NUNCA um palpite de qual decisor seria — mesma postura do porteiro.
 *
 * Sem `nome` (só `id`) nunca entra no passo 2 — `compararComDecisores` já
 * filtra `p.nome !== null` ao montar `participantesPresentes`, então essa
 * pessoa nunca aparece nos candidatos e cai automaticamente em acompanhante.
 */
export function resolverPapelNoJoin(params: {
  nome: string | null;
  isHost: boolean;
  decisoresEsperados: string[];
  participantesAtuais: ParticipanteRegistrado[];
  /** Nomes da equipe do escritório (`perfis_equipe.nome`, ativos), separados
   * em quem conduz e quem apoia — ver `equipe.ts::carregarEquipeDoEscritorio`.
   * Omitido (undefined) = chamador que ainda não migrou: o comportamento cai
   * no `isHost` de antes, sem quebrar. */
  equipe?: { advogadas: string[]; assistentes: string[] };
}): PapelFala {
  // 🔴 A ADVOGADA É RECONHECIDA PELA IDENTIDADE, NUNCA POR QUEM ABRIU A SALA
  // (decisão do Marcio, 18/09/2026, depois do defeito medido ao vivo na
  // sessão do Carlos Alberto).
  //
  // O que acontecia: o passo 1 era `isHost === true → "advogada"`, e só a
  // PRIMEIRA pessoa host levava o papel. Na sessão real quem abriu a sala foi
  // o "Marco - Staff" (assistente), que levou o papel "advogada" e SAIU aos
  // 3 minutos; a Dra. Elaine entrou depois e caiu em `acompanhante_2`, e o
  // cliente em `acompanhante_1`. Com `papeis_de_fala` ligado, a IA passou a
  // sessão inteira sem saber quem conduzia e quem era o cliente.
  //
  // `isHost` descreve quem clicou primeiro no Meet — é um acidente de
  // operação, não um fato sobre o escritório. A identidade é o fato: quem
  // casa com um perfil de advogada da equipe conduz, quem casa com o resto
  // da equipe apoia. O papel segue a PESSOA: se a Dra. Elaine entra 40 min
  // atrasada, ela assume "advogada" na hora em que entra.
  const equipeUsavel = (params.equipe?.advogadas.length ?? 0) > 0;
  if (params.nome && params.equipe && equipeUsavel) {
    // `semTratamento` dos DOIS lados: o Meet mostrou "Elaine Montenegro" e o
    // cadastro diz "Dra. Elaine Montenegro" (medido na sessão real). Sem isso
    // o casamento falha em silêncio — ver `equipe.ts::semTratamento`.
    const nomeNormalizado = normalizarNome(semTratamento(params.nome));
    const casaCom = (lista: string[]) => lista.some((n) => normalizarNome(semTratamento(n)) === nomeNormalizado);

    if (casaCom(params.equipe.advogadas)) {
      // Sem `jaTemAdvogada` aqui: se duas advogadas do escritório estiverem
      // na mesma sala, AMBAS conduzem — "advogada" descreve o papel na
      // conversa, não um crachá de exclusividade. Quem some com a trava é a
      // eleição acidental do primeiro host.
      return "advogada";
    }
    if (casaCom(params.equipe.assistentes)) {
      // Equipe do escritório que não conduz: a IA precisa distinguir apoio
      // interno de acompanhante do cliente (filho, cônjuge). Assistente não
      // entra em `decisores_presentes`.
      return "assistente";
    }
  }

  // Compatibilidade: chamador sem `equipe` (ou sessão sem nome no join)
  // mantém o comportamento antigo. Quando `equipe` vem preenchida, um nome
  // que não casa com ninguém do escritório segue para decisor/acompanhante —
  // `isHost` deixa de eleger advogada, que é exatamente o defeito corrigido.
  // Degradação segura: equipe ilegível (erro de leitura) ou sem NENHUMA
  // advogada marcada `papel='advogada'` cai no comportamento antigo. Sem esta
  // guarda, uma leitura falha deixaria a sessão SEM advogada nenhuma — pior
  // que o defeito corrigido.
  if (params.isHost && !equipeUsavel) {
    const jaTemAdvogada = params.participantesAtuais.some((p) => p.papel === "advogada");
    if (!jaTemAdvogada) return "advogada";
  }

  if (params.nome && params.decisoresEsperados.length > 0) {
    // Simula a presença desta pessoa junto às já registradas para resolver a
    // comparação com o quadro completo (ela ainda não está em
    // `participantesAtuais` no instante em que este resolvedor é chamado —
    // é chamado ANTES de `aplicarEventoParticipante` acrescentar a entrada).
    const nomeDaPessoa = params.nome;
    const presentesSimulados: ParticipanteRegistrado[] = [
      ...params.participantesAtuais.filter((p) => p.saiu_em === null),
      { id: null, nome: nomeDaPessoa, entrou_em: "1970-01-01T00:00:00Z", saiu_em: null, papel: null },
    ];
    const comparacao = compararComDecisores(params.decisoresEsperados, presentesSimulados);
    const casamentoDesta = comparacao.presentes.find((p) => normalizarNome(p.nomeParticipante) === normalizarNome(nomeDaPessoa));
    if (casamentoDesta) {
      const posicaoNoBriefing = params.decisoresEsperados.findIndex(
        (d) => normalizarNome(d) === normalizarNome(casamentoDesta.nomeBriefing),
      );
      if (posicaoNoBriefing !== -1) return `decisor_${posicaoNoBriefing + 1}`;
    }
  }

  const acompanhantesExistentes = params.participantesAtuais.filter((p) => p.papel?.startsWith("acompanhante_")).length;
  return `acompanhante_${acompanhantesExistentes + 1}`;
}
