/**
 * Fase 10, Fatia 4c (docs/ARQUITETURA-FASE-10.md §5 "camada 1", §7, §8, §12).
 * A CAMADA 1 do caso dos decisores — fato, SEM IA nenhuma: compara quem o
 * webhook do bot relatou como presente (`participant_events.join`/`.leave`)
 * contra `processo_decisorio.decisores` do briefing atual. Casamento por
 * nome normalizado; AMBÍGUO NÃO CASA (mesma postura do porteiro da Fase 9,
 * `server/agente-whatsapp/porteiro.ts`: cardinalidade explícita, nunca
 * escolher a pessoa errada em silêncio).
 *
 * PII (§7): `sessoes_copiloto.participantes` guarda NOME de pessoa real —
 * é dado do escritório, sob RLS de `app.ve_patrimonio()` (0091), igual à
 * transcrição. Este módulo NUNCA manda nome para a IA — quem monta o
 * contexto de IA (`contexto.ts`) já só lê a CONTAGEM daqui, nunca o nome.
 * `compararComDecisores()` é para a TELA (fato determinístico), não para o
 * prompt.
 */

// ---------------------------------------------------------------------------
// Registro de join/leave — chamado pelo webhook (server/copiloto/recall no
// caminho de entrada, route.ts de fato grava).
// ---------------------------------------------------------------------------

export interface ParticipanteRegistrado {
  nome: string;
  entrou_em: string;
  saiu_em: string | null;
}

function normalizarParticipantesBrutos(bruto: unknown): ParticipanteRegistrado[] {
  if (!Array.isArray(bruto)) return [];
  const resultado: ParticipanteRegistrado[] = [];
  for (const item of bruto) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { nome?: unknown }).nome === "string" &&
      typeof (item as { entrou_em?: unknown }).entrou_em === "string"
    ) {
      const saiuEm = (item as { saiu_em?: unknown }).saiu_em;
      resultado.push({
        nome: (item as { nome: string }).nome,
        entrou_em: (item as { entrou_em: string }).entrou_em,
        saiu_em: typeof saiuEm === "string" ? saiuEm : null,
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
 * sobrescreve a anterior; é histórico, não estado único por nome).
 *
 * LEAVE: fecha a entrada MAIS RECENTE com `saiu_em` ainda nulo para aquele
 * nome (normalizado) — se não houver nenhuma aberta com esse nome, o evento
 * é ignorado (reentrega do webhook, ou leave sem join correspondente
 * conhecido — nunca inventa uma entrada de join que não aconteceu).
 */
export function aplicarEventoParticipante(
  participantesAtuais: unknown,
  evento: { tipo: "join" | "leave"; nome: string; quando: string },
): ParticipanteRegistrado[] {
  const lista = normalizarParticipantesBrutos(participantesAtuais);
  const nomeNormalizado = normalizarNome(evento.nome);

  if (evento.tipo === "join") {
    return [...lista, { nome: evento.nome, entrou_em: evento.quando, saiu_em: null }];
  }

  // leave: fecha a entrada aberta mais recente para este nome normalizado.
  let indiceParaFechar = -1;
  for (let i = lista.length - 1; i >= 0; i--) {
    if (lista[i]!.saiu_em === null && normalizarNome(lista[i]!.nome) === nomeNormalizado) {
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
 * Compara `processo_decisorio.decisores` do briefing (nomes, geradas por IA
 * a partir do que já foi relatado — `server/ia/schema-briefing.ts`) contra
 * quem está PRESENTE agora na sala (join sem leave correspondente). Função
 * PURA — nenhuma chamada de IA, nenhuma consulta a banco: o chamador já leu
 * os dois lados.
 */
export function compararComDecisores(decisoresEsperados: string[], participantesAtuais: unknown): ComparacaoDecisores {
  const lista = normalizarParticipantesBrutos(participantesAtuais);
  const presentesBrutos = lista.filter((p) => p.saiu_em === null).map((p) => p.nome);

  const presentes: DecisorCasado[] = [];
  const ausentes: string[] = [];
  const ambiguos: string[] = [];

  for (const decisor of decisoresEsperados) {
    const normalizadoDecisor = normalizarNome(decisor);
    const casamentos = presentesBrutos.filter((p) => normalizarNome(p) === normalizadoDecisor);

    if (casamentos.length === 0) {
      ausentes.push(decisor);
    } else if (casamentos.length === 1) {
      presentes.push({ nomeBriefing: decisor, nomeParticipante: casamentos[0]! });
    } else {
      // Mais de um participante presente com o mesmo nome normalizado —
      // ambíguo não casa, nem como presente nem como ausente.
      ambiguos.push(decisor);
    }
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
