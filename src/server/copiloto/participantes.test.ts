import { describe, expect, it } from "vitest";
import {
  aplicarEventoParticipante,
  compararComDecisores,
  normalizarNome,
  resolverPapelNoJoin,
  type ParticipanteRegistrado,
} from "./participantes";

describe("normalizarNome", () => {
  it("remove acento, baixa caixa e colapsa espaço duplo", () => {
    expect(normalizarNome("  Terezinha   Sá ")).toBe("terezinha sa");
    expect(normalizarNome("CLEISON")).toBe("cleison");
  });
});

describe("aplicarEventoParticipante", () => {
  it("join acrescenta entrada nova com saiu_em nulo, papel null quando não informado", () => {
    const resultado = aplicarEventoParticipante([], {
      tipo: "join",
      nome: "Terezinha",
      id: null,
      quando: "2026-09-11T10:00:00Z",
    });
    expect(resultado).toEqual([{ id: null, nome: "Terezinha", entrou_em: "2026-09-11T10:00:00Z", saiu_em: null, papel: null }]);
  });

  it("join grava o papel recebido do chamador quando informado", () => {
    const resultado = aplicarEventoParticipante([], {
      tipo: "join",
      nome: "Dra. Elaine",
      id: null,
      quando: "2026-09-11T10:00:00Z",
      papel: "advogada",
    });
    expect(resultado[0]!.papel).toBe("advogada");
  });

  it("leave fecha a entrada aberta mais recente com o mesmo nome normalizado", () => {
    const atuais = [{ id: null, nome: "Terezinha", entrou_em: "2026-09-11T10:00:00Z", saiu_em: null, papel: null }];
    const resultado = aplicarEventoParticipante(atuais, {
      tipo: "leave",
      nome: "terezinha",
      id: null,
      quando: "2026-09-11T10:30:00Z",
    });
    expect(resultado).toEqual([
      { id: null, nome: "Terezinha", entrou_em: "2026-09-11T10:00:00Z", saiu_em: "2026-09-11T10:30:00Z", papel: null },
    ]);
  });

  it("leave casa por id quando ambos os lados têm id, mesmo com nome diferente (grafia variou entre eventos)", () => {
    const atuais = [{ id: "p100", nome: "Rodrigo", entrou_em: "10:00", saiu_em: null, papel: null }];
    const resultado = aplicarEventoParticipante(atuais, { tipo: "leave", nome: "Rodrigo Silva", id: "p100", quando: "10:30" });
    expect(resultado[0]!.saiu_em).toBe("10:30");
  });

  it("leave sem join correspondente é ignorado (silêncio, não erro)", () => {
    const resultado = aplicarEventoParticipante([], { tipo: "leave", nome: "Ninguém", id: null, quando: "2026-09-11T10:30:00Z" });
    expect(resultado).toEqual([]);
  });

  it("mesma pessoa pode entrar, sair e entrar de novo — histórico, não estado único", () => {
    let lista: unknown = [];
    lista = aplicarEventoParticipante(lista, { tipo: "join", nome: "Terezinha", id: null, quando: "10:00" });
    lista = aplicarEventoParticipante(lista, { tipo: "leave", nome: "Terezinha", id: null, quando: "10:05" });
    lista = aplicarEventoParticipante(lista, { tipo: "join", nome: "Terezinha", id: null, quando: "10:10" });
    expect(lista).toEqual([
      { id: null, nome: "Terezinha", entrou_em: "10:00", saiu_em: "10:05", papel: null },
      { id: null, nome: "Terezinha", entrou_em: "10:10", saiu_em: null, papel: null },
    ]);
  });

  // 🔴 Estabilidade de papel na reentrada (15/09/2026, decisão de arquitetura
  // do coordenador): a pessoa sai e volta — o papel da entrada NOVA tem de
  // HERDAR o papel da entrada anterior, nunca ser resolvido de novo (senão
  // decisor_1 poderia virar decisor_3 se outra pessoa entrou no meio tempo).
  it("🔴 reentrada HERDA o papel da entrada anterior — decisor_1 nunca vira decisor_3", () => {
    let lista: unknown = [];
    lista = aplicarEventoParticipante(lista, { tipo: "join", nome: "Cláudia", id: "p1", quando: "10:00", papel: "decisor_1" });
    lista = aplicarEventoParticipante(lista, { tipo: "leave", nome: "Cláudia", id: "p1", quando: "10:05" });
    // Entre a saída e a volta, outra pessoa (acompanhante_1) já ocupou uma posição.
    lista = aplicarEventoParticipante(lista, {
      tipo: "join",
      nome: "Fulano",
      id: "p2",
      quando: "10:06",
      papel: "acompanhante_1",
    });
    // Cláudia volta — mesmo `id`, mesmo `papel: "decisor_2"` que um resolvedor
    // ingênuo poderia calcular de novo (errado): tem de HERDAR "decisor_1".
    lista = aplicarEventoParticipante(lista, { tipo: "join", nome: "Cláudia", id: "p1", quando: "10:10", papel: "decisor_2" });

    const entradas = lista as ParticipanteRegistrado[];
    const ultimaDeClaudia = entradas.filter((p) => p.id === "p1").at(-1)!;
    expect(ultimaDeClaudia.papel).toBe("decisor_1");
  });

  it("reentrada herda por NOME normalizado quando não há id em nenhum dos lados", () => {
    let lista: unknown = [];
    lista = aplicarEventoParticipante(lista, { tipo: "join", nome: "Cláudia", id: null, quando: "10:00", papel: "decisor_1" });
    lista = aplicarEventoParticipante(lista, { tipo: "leave", nome: "Cláudia", id: null, quando: "10:05" });
    lista = aplicarEventoParticipante(lista, { tipo: "join", nome: "claudia", id: null, quando: "10:10", papel: "decisor_2" });
    const entradas = lista as ParticipanteRegistrado[];
    expect(entradas.at(-1)!.papel).toBe("decisor_1");
  });

  it("entrada não reconhecida no jsonb (formato inválido) é descartada, nunca lança", () => {
    const resultado = aplicarEventoParticipante([{ lixo: true }, "string solta", null], {
      tipo: "join",
      nome: "Cleison",
      id: null,
      quando: "10:00",
    });
    expect(resultado).toEqual([{ id: null, nome: "Cleison", entrou_em: "10:00", saiu_em: null, papel: null }]);
  });

  // 🔴 O PRÓPRIO BOT emite join/leave dele mesmo (medido em produção,
  // 15/09/2026: 3 dos 15 eventos reais). Sem filtro, ele viraria
  // acompanhante_N e infla decisores_presentes.
  describe("🔴 o próprio bot NUNCA entra na lista de participantes", () => {
    it("join do bot (nome real gravado pela Recall — hífen simples, sem acento) é ignorado", () => {
      const resultado = aplicarEventoParticipante([], {
        tipo: "join",
        nome: "Assistente - Escritorio Elaine Montenegro",
        id: null,
        quando: "10:00",
      });
      expect(resultado).toEqual([]);
    });

    it("variante real 'Assistente PT-BR - Escritorio...' também é ignorada", () => {
      const resultado = aplicarEventoParticipante([], {
        tipo: "join",
        nome: "Assistente PT-BR - Escritorio Elaine Montenegro",
        id: null,
        quando: "10:00",
      });
      expect(resultado).toEqual([]);
    });

    it("nome com em-dash e acento (o que NOME_BOT declara em bot/route.ts) também é ignorado", () => {
      const resultado = aplicarEventoParticipante([], {
        tipo: "join",
        nome: "Assistente — Escritório Elaine Montenegro",
        id: null,
        quando: "10:00",
      });
      expect(resultado).toEqual([]);
    });

    it("leave do bot também não altera a lista", () => {
      const atuais = [{ id: null, nome: "Terezinha", entrou_em: "10:00", saiu_em: null, papel: null }];
      const resultado = aplicarEventoParticipante(atuais, {
        tipo: "leave",
        nome: "Assistente - Escritorio Elaine Montenegro",
        id: null,
        quando: "10:05",
      });
      expect(resultado).toEqual(atuais);
    });

    it("humano com nome parecido, mas SEM o núcleo 'escritorio elaine montenegro', NÃO é filtrado", () => {
      const resultado = aplicarEventoParticipante([], { tipo: "join", nome: "Assistente Jurídico", id: null, quando: "10:00" });
      expect(resultado).toHaveLength(1);
      expect(resultado[0]!.nome).toBe("Assistente Jurídico");
    });
  });
});

describe("compararComDecisores — camada 1 do §5, SEM IA", () => {
  it("caso do plano: 2 decisores esperados, só 1 presente — Cleison ausente é FATO", () => {
    const participantes = [{ nome: "Terezinha", entrou_em: "10:00", saiu_em: null }];
    const resultado = compararComDecisores(["Terezinha", "Cleison"], participantes);

    expect(resultado.presentes).toEqual([{ nomeBriefing: "Terezinha", nomeParticipante: "Terezinha" }]);
    expect(resultado.ausentes).toEqual(["Cleison"]);
    expect(resultado.ambiguos).toEqual([]);
  });

  it("casamento é por nome NORMALIZADO (acento/caixa/espaço não impedem casar)", () => {
    const participantes = [{ nome: "TEREZINHA   SÁ", entrou_em: "10:00", saiu_em: null }];
    const resultado = compararComDecisores(["Terezinha Sá"], participantes);
    expect(resultado.presentes).toEqual([{ nomeBriefing: "Terezinha Sá", nomeParticipante: "TEREZINHA   SÁ" }]);
  });

  it("quem entrou e JÁ SAIU não conta como presente", () => {
    const participantes = [{ nome: "Cleison", entrou_em: "10:00", saiu_em: "10:05" }];
    const resultado = compararComDecisores(["Cleison"], participantes);
    expect(resultado.ausentes).toEqual(["Cleison"]);
    expect(resultado.presentes).toEqual([]);
  });

  it("AMBÍGUO NÃO CASA: 2 participantes presentes com o mesmo nome normalizado do decisor", () => {
    const participantes = [
      { nome: "João Silva", entrou_em: "10:00", saiu_em: null },
      { nome: "joão silva", entrou_em: "10:01", saiu_em: null },
    ];
    const resultado = compararComDecisores(["João Silva"], participantes);

    expect(resultado.ambiguos).toEqual(["João Silva"]);
    expect(resultado.presentes).toEqual([]);
    expect(resultado.ausentes).toEqual([]);
  });

  it("sem decisores esperados (briefing sem processo_decisorio.decisores) devolve listas vazias, nunca lança", () => {
    const resultado = compararComDecisores([], [{ nome: "Terezinha", entrou_em: "10:00", saiu_em: null }]);
    expect(resultado.presentes).toEqual([]);
    expect(resultado.ausentes).toEqual([]);
    expect(resultado.ambiguos).toEqual([]);
    expect(resultado.participantesPresentes).toEqual(["Terezinha"]);
  });

  // 🔴 Achado do coordenador, 15/09/2026, briefing real em produção: o nome
  // do decisor vem com qualificador entre parênteses
  // ("Rodrigo (marido e sócio)"), o nome da sala nunca traz esse
  // qualificador — sem a 2ª passada, isso caía em `ausentes` com a pessoa
  // presente e falando (alarme falso).
  describe("🔴 qualificador entre parênteses no nome do decisor (achado do coordenador)", () => {
    it("'Rodrigo (marido e sócio)' no briefing casa com 'Rodrigo' presente na sala — PRESENTE, não ausente", () => {
      const participantes = [{ nome: "Rodrigo", entrou_em: "10:00", saiu_em: null }];
      const resultado = compararComDecisores(["Rodrigo (marido e sócio)"], participantes);
      expect(resultado.presentes).toEqual([{ nomeBriefing: "Rodrigo (marido e sócio)", nomeParticipante: "Rodrigo" }]);
      expect(resultado.ausentes).toEqual([]);
    });

    it("caso real do briefing em produção: 'Cláudia' e 'Rodrigo (marido e sócio)', os dois presentes", () => {
      const participantes = [
        { nome: "Cláudia", entrou_em: "10:00", saiu_em: null },
        { nome: "Rodrigo", entrou_em: "10:01", saiu_em: null },
      ];
      const resultado = compararComDecisores(["Cláudia", "Rodrigo (marido e sócio)"], participantes);
      expect(resultado.presentes).toEqual([
        { nomeBriefing: "Cláudia", nomeParticipante: "Cláudia" },
        { nomeBriefing: "Rodrigo (marido e sócio)", nomeParticipante: "Rodrigo" },
      ]);
      expect(resultado.ausentes).toEqual([]);
      expect(resultado.ambiguos).toEqual([]);
    });

    it("nome completo AINDA casa em 1ª passada quando a sala também traz o qualificador — nunca precisa da 2ª passada", () => {
      const participantes = [{ nome: "Rodrigo (marido e sócio)", entrou_em: "10:00", saiu_em: null }];
      const resultado = compararComDecisores(["Rodrigo (marido e sócio)"], participantes);
      expect(resultado.presentes).toEqual([{ nomeBriefing: "Rodrigo (marido e sócio)", nomeParticipante: "Rodrigo (marido e sócio)" }]);
    });

    it("sem NENHUM candidato mesmo com parênteses removidos: ausente de verdade, nunca lança", () => {
      const participantes = [{ nome: "Terezinha", entrou_em: "10:00", saiu_em: null }];
      const resultado = compararComDecisores(["Rodrigo (marido e sócio)"], participantes);
      expect(resultado.ausentes).toEqual(["Rodrigo (marido e sócio)"]);
    });
  });

  // 🔴 Terceira passada (primeiro nome) — último recurso, mais sujeito a
  // ambiguidade por desenho. "Prefira errar para ambíguo do que para
  // falso-positivo" (achado do coordenador).
  describe("🔴 casamento por primeiro nome (última passada) — prefere ambíguo a palpite", () => {
    it("'Rodrigo Almeida (sócio)' no briefing casa com 'Rodrigo Silva' presente — via 3ª passada (primeiro nome)", () => {
      const participantes = [{ nome: "Rodrigo Silva", entrou_em: "10:00", saiu_em: null }];
      const resultado = compararComDecisores(["Rodrigo Almeida (sócio)"], participantes);
      expect(resultado.presentes).toEqual([{ nomeBriefing: "Rodrigo Almeida (sócio)", nomeParticipante: "Rodrigo Silva" }]);
    });

    it("dois 'Rodrigo' distintos na sala (Rodrigo Pai / Rodrigo Filho): AMBÍGUO, nunca um palpite", () => {
      const participantes = [
        { nome: "Rodrigo Pai", entrou_em: "10:00", saiu_em: null },
        { nome: "Rodrigo Filho", entrou_em: "10:01", saiu_em: null },
      ];
      const resultado = compararComDecisores(["Rodrigo (marido)"], participantes);
      expect(resultado.ambiguos).toEqual(["Rodrigo (marido)"]);
      expect(resultado.presentes).toEqual([]);
      expect(resultado.ausentes).toEqual([]);
    });

    it("ambíguo na 1ª passada NUNCA regride para presente na 3ª passada (mesmo nome completo igual)", () => {
      // Os dois participantes já casam EXATAMENTE com o nome completo do
      // decisor — ambíguo na 1ª passada. A 3ª passada (mais permissiva)
      // NUNCA deveria ser tentada aqui, e mesmo que fosse, não pode
      // "resolver" a ambiguidade escolhendo um dos dois.
      const participantes = [
        { nome: "João Silva", entrou_em: "10:00", saiu_em: null },
        { nome: "João Silva", entrou_em: "10:01", saiu_em: null },
      ];
      const resultado = compararComDecisores(["João Silva"], participantes);
      expect(resultado.ambiguos).toEqual(["João Silva"]);
      expect(resultado.presentes).toEqual([]);
    });
  });
});

describe("resolverPapelNoJoin — ordem de resolução (decisão do dono, 15/09/2026)", () => {
  it("is_host=true vira 'advogada' quando ainda não há advogada na sessão", () => {
    const papel = resolverPapelNoJoin({ nome: "Dra. Elaine", isHost: true, decisoresEsperados: [], participantesAtuais: [] });
    expect(papel).toBe("advogada");
  });

  it("2º host (co-anfitrião) vira acompanhante — só o PRIMEIRO host leva 'advogada'", () => {
    const jaTemAdvogada: ParticipanteRegistrado[] = [
      { id: "p1", nome: "Dra. Elaine", entrou_em: "10:00", saiu_em: null, papel: "advogada" },
    ];
    const papel = resolverPapelNoJoin({ nome: "Outro Host", isHost: true, decisoresEsperados: [], participantesAtuais: jaTemAdvogada });
    expect(papel).toBe("acompanhante_1");
  });

  it("casa sem ambiguidade com decisor do briefing — decisor_N pela ORDEM do briefing, não pela ordem de chegada", () => {
    const papel = resolverPapelNoJoin({
      nome: "Cleison",
      isHost: false,
      decisoresEsperados: ["Terezinha", "Cleison"],
      participantesAtuais: [],
    });
    expect(papel).toBe("decisor_2"); // Cleison é o 2º do briefing, mesmo entrando primeiro na sala
  });

  it("decisor com qualificador entre parênteses no briefing: resolverPapelNoJoin também reusa a normalização relaxada", () => {
    const papel = resolverPapelNoJoin({
      nome: "Rodrigo",
      isHost: false,
      decisoresEsperados: ["Cláudia", "Rodrigo (marido e sócio)"],
      participantesAtuais: [{ id: "p1", nome: "Cláudia", entrou_em: "10:00", saiu_em: null, papel: "decisor_1" }],
    });
    expect(papel).toBe("decisor_2");
  });

  it("ambíguo com decisor: cai em acompanhante, NUNCA um palpite de qual decisor seria", () => {
    const jaPresente: ParticipanteRegistrado[] = [
      { id: "p1", nome: "João Silva", entrou_em: "10:00", saiu_em: null, papel: "decisor_1" },
    ];
    const papel = resolverPapelNoJoin({
      nome: "joão silva", // mesmo nome normalizado de quem já é decisor_1 — mas essa pessoa NÃO é a mesma (id diferente)
      isHost: false,
      decisoresEsperados: ["João Silva"],
      participantesAtuais: jaPresente,
    });
    expect(papel).toBe("acompanhante_1");
  });

  it("sem nome (só id): nunca vira decisor_N, mesmo com decisores esperados no briefing", () => {
    const papel = resolverPapelNoJoin({ nome: null, isHost: false, decisoresEsperados: ["Terezinha"], participantesAtuais: [] });
    expect(papel).toBe("acompanhante_1");
  });

  it("resto (não host, não decisor): acompanhante_N pela ordem de CHEGADA entre acompanhantes já registrados", () => {
    const jaTemUmAcompanhante: ParticipanteRegistrado[] = [
      { id: "p1", nome: "Fulano", entrou_em: "10:00", saiu_em: null, papel: "acompanhante_1" },
    ];
    const papel = resolverPapelNoJoin({
      nome: "Beltrano",
      isHost: false,
      decisoresEsperados: [],
      participantesAtuais: jaTemUmAcompanhante,
    });
    expect(papel).toBe("acompanhante_2");
  });
});
