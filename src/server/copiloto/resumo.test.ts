import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  acumularResumo,
  acumularResumoNaSessao,
  categorizarPergunta,
  normalizarResumoAcumulado,
  resumirParaContexto,
  RESUMO_VAZIO,
  SINONIMOS_POR_CAMPO,
} from "./resumo";
import type { ResumoAcumulado } from "@/types/copiloto";
import type { RoteiroCampo } from "@/types/roteiro";

const CAMPOS_PARTE_03: RoteiroCampo[] = [
  { id: "filhos_maiores_menores", rotulo: "Filhos (maiores/menores)", tipo: "texto" },
  { id: "ocupacoes_idades", rotulo: "Ocupações e idades", tipo: "texto" },
  { id: "regimes_casamento", rotulo: "Regime de casamento", tipo: "texto" },
  { id: "lista_bens", rotulo: "Lista de bens", tipo: "texto" },
];

describe("categorizarPergunta — casa por termo significativo do rótulo, nunca força encaixe", () => {
  it("pergunta sobre filhos casa com o campo de filhos", () => {
    const tema = categorizarPergunta("Vocês têm filhos maiores ou menores de idade?", CAMPOS_PARTE_03);
    expect(tema).toBe("filhos_maiores_menores");
  });

  it("pergunta sobre regime de casamento casa com o campo de regime", () => {
    const tema = categorizarPergunta("Qual é o regime de casamento de vocês?", CAMPOS_PARTE_03);
    expect(tema).toBe("regimes_casamento");
  });

  it("pergunta que não casa com NENHUM campo devolve null — nunca inventa tema", () => {
    const tema = categorizarPergunta("Como está o clima hoje na cidade de vocês?", CAMPOS_PARTE_03);
    expect(tema).toBeNull();
  });

  it("bloco sem campos (parte_00) sempre devolve null", () => {
    const tema = categorizarPergunta("Qualquer pergunta aqui", []);
    expect(tema).toBeNull();
  });

  it("🔴 CORRIGIDO (achado do Fable, resolução por especificidade): quando dois campos casam por termo de MESMO comprimento, o campo com MAIS termos casados vence — 'total' (em 'Patrimônio total') soma ao termo 'patrimonio' que os dois compartilham, tornando 'b' mais específico que 'a'", () => {
    const campos: RoteiroCampo[] = [
      { id: "a", rotulo: "Bens e Patrimônio", tipo: "texto" },
      { id: "b", rotulo: "Patrimônio total", tipo: "texto" },
    ];
    expect(categorizarPergunta("Qual o patrimônio total da família?", campos)).toBe("b");
  });

  it("EMPATE TOTAL (mesmo termo, mesma quantidade): ordem de `campos[]` decide — determinístico, sempre o mesmo", () => {
    const campos: RoteiroCampo[] = [
      { id: "a", rotulo: "Patrimônio herdado", tipo: "texto" },
      { id: "b", rotulo: "Patrimônio declarado", tipo: "texto" },
    ];
    // Ambos casam só por "patrimonio" (10 letras, 1 termo cada) — nenhum
    // termo do rótulo aparece na pergunta além dele. Empate total: o
    // PRIMEIRO do bloco vence.
    expect(categorizarPergunta("Qual é o patrimônio da família?", campos)).toBe("a");
  });

  it("acentuação e caixa não impedem o casamento (normalização)", () => {
    const tema = categorizarPergunta("QUAIS SÃO AS OCUPAÇÕES ATUAIS DE VOCÊS?", CAMPOS_PARTE_03);
    expect(tema).toBe("ocupacoes_idades");
  });
});

// Roteiro v5 REAL (0118_roteiro_v5_conteudo_do_script.sql, parte_03 completa +
// `reserva_seguro_inventario` da parte_04) — os `id`s abaixo existem hoje em
// produção, conferidos na migration, nenhum inventado para o teste.
const CAMPOS_ROTEIRO_REAL: RoteiroCampo[] = [
  { id: "filhos_maiores_menores", rotulo: "Filhos (maiores ou menores)", tipo: "texto" },
  { id: "regimes_casamento", rotulo: "Regimes de casamento de todos os envolvidos", tipo: "texto" },
  { id: "ocupacoes_idades", rotulo: "Ocupações e idades", tipo: "texto" },
  { id: "lista_bens", rotulo: "Lista de bens", tipo: "texto" },
  { id: "valores_mercado_aquisicao", rotulo: "Valores de mercado e de aquisição, datas e formas de pagamento de cada bem", tipo: "texto" },
  { id: "relacao_pessoal_bem", rotulo: "Relação pessoal do cliente com cada bem (valor emocional, não só financeiro)", tipo: "texto" },
  { id: "quem_paga_contas", rotulo: "Quem paga as contas hoje", tipo: "texto" },
  { id: "reservas_financeiras", rotulo: "Reservas financeiras disponíveis", tipo: "texto" },
  { id: "reserva_seguro_inventario", rotulo: "Existência de reserva financeira ou seguro de vida específico para pagar o inventário", tipo: "texto" },
];

/**
 * TESTE DE ACEITE (18/09/2026) — as 4 perguntas do enunciado (achado medido na
 * sessão real do Carlos Alberto, 122 perguntas exibidas, 36% — 44 de 122 —
 * não categorizavam) e a amostra de vocabulário real citada junto. Não busca
 * PII no banco: o texto das perguntas está no próprio pedido.
 *
 * MEDIDO — antes desta fatia (só rótulo), as 4 perguntas da tabela do
 * enunciado davam `null` as 4 (0/4, 0%). Depois de `SINONIMOS_POR_CAMPO`,
 * as 4 categorizam (4/4, 100%) — o `describe` abaixo prova cada uma.
 */
describe("categorizarPergunta — TESTE DE ACEITE: perguntas reais que não categorizavam antes desta fatia", () => {
  it("'Quantos anos a Flávia tem?' → ocupacoes_idades (era null antes do sinônimo de idade)", () => {
    expect(categorizarPergunta("Quantos anos a Flávia tem?", CAMPOS_ROTEIRO_REAL)).toBe("ocupacoes_idades");
  });

  it("'Essa previdência é sua ou do seu marido?' → lista_bens (era null antes do sinônimo de previdência)", () => {
    expect(categorizarPergunta("Essa previdência é sua ou do seu marido?", CAMPOS_ROTEIRO_REAL)).toBe("lista_bens");
  });

  it("'Essa reserva no Tesouro Selic está em nome de quem?' → lista_bens (era null: 'reserva' sozinho não bastava, 'tesouro'/'selic' resolvem)", () => {
    expect(categorizarPergunta("Essa reserva no Tesouro Selic está em nome de quem?", CAMPOS_ROTEIRO_REAL)).toBe("lista_bens");
  });

  it("'A Flávia e o marido moram só com o senhor?' → relacao_pessoal_bem (era null antes do sinônimo de moradia)", () => {
    expect(categorizarPergunta("A Flávia e o marido moram só com o senhor?", CAMPOS_ROTEIRO_REAL)).toBe("relacao_pessoal_bem");
  });

  it("20 variações de pergunta de idade (vocabulário medido na sessão) casam com ocupacoes_idades", () => {
    const perguntas = [
      "Quantos anos ela tem?",
      "Em que ano ela nasceu?",
      "Qual é a idade dela?",
      "Ele trabalha ou está aposentado?",
      "Qual a profissão dela hoje?",
    ];
    for (const p of perguntas) expect(categorizarPergunta(p, CAMPOS_ROTEIRO_REAL)).toBe("ocupacoes_idades");
  });

  it("'idade' não casa por acidente com 'cidade' (borda de palavra, não substring solto)", () => {
    // Pergunta deliberadamente livre de outros termos do roteiro (inclusive
    // do rótulo "Quem paga as contas HOJE" — "hoje" já casava por rótulo
    // antes desta fatia, comportamento pré-existente e fora deste escopo).
    expect(categorizarPergunta("Em que cidade do estado vocês nasceram?", CAMPOS_ROTEIRO_REAL)).toBeNull();
  });

  it("pergunta que menciona 'filho' mas pergunta sobre idade cai em filhos_maiores_menores — ordem do bloco decide, determinístico (não é regressão)", () => {
    expect(categorizarPergunta("Qual é a idade do seu filho?", CAMPOS_ROTEIRO_REAL)).toBe("filhos_maiores_menores");
  });

  it("vocabulário de previdência/investimento casa com lista_bens", () => {
    const perguntas = ["Vocês têm alguma aplicação financeira?", "Investem em fundos imobiliários?", "Tem ações na bolsa?"];
    for (const p of perguntas) expect(categorizarPergunta(p, CAMPOS_ROTEIRO_REAL)).toBe("lista_bens");
  });

  /**
   * 🔴 CORRIGIDO (achado do Fable, resolução por especificidade): "Tem
   * reserva guardada em algum banco?" agora casa com `reservas_financeiras`
   * (sinônimo "tem reserva"/"reserva guardada", 12-15 chars), NÃO mais com
   * `lista_bens` (que antes só tinha "reserva" solto, 7 chars, removido por
   * ser o termo largo que causou a regressão de "reservas financeiras
   * disponíveis" — ver comentário de `SINONIMOS_POR_CAMPO`). O campo mais
   * específico é o correto: a pergunta É sobre reserva financeira, não
   * sobre listar bens em geral.
   */
  it("'Tem reserva guardada em algum banco?' vai para reservas_financeiras (campo mais específico), não mais lista_bens", () => {
    expect(categorizarPergunta("Tem reserva guardada em algum banco?", CAMPOS_ROTEIRO_REAL)).toBe("reservas_financeiras");
  });

  it("vocabulário de conta/despesa (12 perguntas medidas) casa com quem_paga_contas", () => {
    expect(categorizarPergunta("Quem paga as contas da casa hoje?", CAMPOS_ROTEIRO_REAL)).toBe("quem_paga_contas");
    expect(categorizarPergunta("Ele já é aposentado?", CAMPOS_ROTEIRO_REAL)).toBe("ocupacoes_idades");
  });

  /**
   * 🔴 CORRIGIDO (achado do Fable, REGRESSÃO real medida): "renda" SOLTO
   * saiu de `quem_paga_contas` — "Vocês têm reservas financeiras
   * disponíveis?" e perguntas parecidas de BEM ("renda fixa") caíam,
   * erradas, em `quem_paga_contas` antes desta correção. "Qual é a renda de
   * vocês dois?" sem `paga`/`pagam` não categoriza mais (null é o resultado
   * correto: renda sozinha é ambígua entre bem e despesa do dia a dia — o
   * módulo não força encaixe). Só a FRASE completa ("quem paga"/"paga as
   * contas") categoriza.
   */
  it("'renda' SOLTA não categoriza mais (era falso-positivo de despesa) — só a frase com 'paga'/'pagam' categoriza", () => {
    expect(categorizarPergunta("Qual é a renda de vocês dois?", CAMPOS_ROTEIRO_REAL)).toBeNull();
    expect(categorizarPergunta("Quem paga a renda da casa?", CAMPOS_ROTEIRO_REAL)).toBe("quem_paga_contas");
  });

  it("vocabulário de divórcio/separação (6 perguntas medidas) casa com regimes_casamento", () => {
    expect(categorizarPergunta("Você já passou por um divórcio antes?", CAMPOS_ROTEIRO_REAL)).toBe("regimes_casamento");
    expect(categorizarPergunta("Como ficou a partilha com a ex-mulher?", CAMPOS_ROTEIRO_REAL)).toBe("regimes_casamento");
  });

  it("vocabulário de moradia (6 perguntas medidas) casa com relacao_pessoal_bem", () => {
    expect(categorizarPergunta("Vocês moram em casa própria?", CAMPOS_ROTEIRO_REAL)).toBe("relacao_pessoal_bem");
    expect(categorizarPergunta("Onde a família reside atualmente?", CAMPOS_ROTEIRO_REAL)).toBe("relacao_pessoal_bem");
  });

  /**
   * 🔴 CORRIGIDO (achado do Fable): `reserva_seguro_inventario` é sobre
   * RESERVA/SEGURO para pagar o INVENTÁRIO, não sobre saúde em si —
   * `tratamento`/`plano de saude` saíram do mapa (achado do Fable: "Qual o
   * tratamento tributário do ITCMD?" caía, errado, neste campo por causa de
   * `tratamento`). "Plano de saúde particular" sem menção a
   * seguro/reserva/inventário não categoriza mais — é o resultado correto
   * (o rótulo do campo não tem termo de saúde nenhum; "plano de saude" era
   * FALSO-POSITIVO recall, não cobertura legítima). "Seguro de vida" e
   * "convênio médico" continuam cobertos, por serem específicos o bastante.
   */
  it("'plano de saúde' sozinho NÃO categoriza mais em reserva_seguro_inventario (falso-positivo removido) — 'seguro de vida' continua cobrindo", () => {
    expect(categorizarPergunta("Ela tem plano de saúde particular?", CAMPOS_ROTEIRO_REAL)).toBeNull();
    expect(categorizarPergunta("Vocês têm seguro de vida contratado?", CAMPOS_ROTEIRO_REAL)).toBe("reserva_seguro_inventario");
  });

  it("cobertura agregada da amostra medida (25 perguntas reais/representativas) — meta: maioria categoriza", () => {
    const amostra = [
      "Quantos anos a Flávia tem?",
      "Essa previdência é sua ou do seu marido?",
      "Essa reserva no Tesouro Selic está em nome de quem?",
      "A Flávia e o marido moram só com o senhor?",
      "Quantos anos ela tem?",
      "Em que ano ela nasceu?",
      "Ele trabalha ou está aposentado?",
      "Qual a profissão dela hoje?",
      "Vocês têm alguma aplicação financeira?",
      "Tem reserva guardada em algum banco?",
      "Investem em fundos imobiliários?",
      "Tem ações na bolsa?",
      "Quem paga as contas da casa hoje?",
      "Qual é a renda de vocês dois?",
      "Você já passou por um divórcio antes?",
      "Como ficou a partilha com a ex-mulher?",
      "Vocês moram em casa própria?",
      "Onde a família reside atualmente?",
      "Ela tem plano de saúde particular?",
      "Ele faz algum tratamento médico?",
      "Qual é a profissão do marido?",
      "Tem imóvel financiado ainda?",
      "Quanto custa o convênio médico de vocês?",
      "Ela é separada ou solteira?",
      "Onde vocês vivem hoje?",
    ];
    const categorizadas = amostra.filter((p) => categorizarPergunta(p, CAMPOS_ROTEIRO_REAL) !== null);
    // Antes desta fatia (só rótulo), a MESMA amostra dava 0/25 (nenhum termo
    // do rótulo formal aparece em nenhuma das 25 perguntas coloquiais).
    expect(categorizadas.length).toBeGreaterThanOrEqual(Math.ceil(amostra.length * 0.8));
  });
});

describe("acumularResumo — upsert por tema, pendente derivado do bloco atual", () => {
  it("tema novo entra em perguntado com n=1, pendente = campos do bloco menos o tema já perguntado", () => {
    const resultado = acumularResumo(RESUMO_VAZIO, {
      tema: "filhos_maiores_menores",
      agoraIso: "2026-09-18T14:00:00Z",
      camposDoBloco: CAMPOS_PARTE_03,
    });

    expect(resultado.perguntado).toEqual([{ t: "filhos_maiores_menores", em: "2026-09-18T14:00:00Z", n: 1 }]);
    expect(resultado.pendente).toEqual(["ocupacoes_idades", "regimes_casamento", "lista_bens"]);
  });

  it("tema repetido soma n e atualiza em, nunca duplica a entrada", () => {
    const primeira = acumularResumo(RESUMO_VAZIO, {
      tema: "filhos_maiores_menores",
      agoraIso: "2026-09-18T14:00:00Z",
      camposDoBloco: CAMPOS_PARTE_03,
    });
    const segunda = acumularResumo(primeira, {
      tema: "filhos_maiores_menores",
      agoraIso: "2026-09-18T14:05:00Z",
      camposDoBloco: CAMPOS_PARTE_03,
    });

    expect(segunda.perguntado).toHaveLength(1);
    expect(segunda.perguntado[0]).toEqual({ t: "filhos_maiores_menores", em: "2026-09-18T14:05:00Z", n: 2 });
  });

  it("tema null (sem pergunta categorizável nesta chamada) ainda recalcula pendente contra o bloco atual", () => {
    const acumulado: ResumoAcumulado = { v: 1, perguntado: [{ t: "regimes_casamento", em: "t", n: 1 }], pendente: ["errado"], cortado_em: null };
    const resultado = acumularResumo(acumulado, { tema: null, agoraIso: "2026-09-18T14:00:00Z", camposDoBloco: CAMPOS_PARTE_03 });

    expect(resultado.perguntado).toEqual(acumulado.perguntado); // nada novo acumulado
    expect(resultado.pendente).toEqual(["filhos_maiores_menores", "ocupacoes_idades", "lista_bens"]);
  });

  it("🔴 ANTI-PISCADA: tema perguntado numa chamada anterior NÃO SOME de perguntado por não repetir agora", () => {
    const primeira = acumularResumo(RESUMO_VAZIO, { tema: "filhos_maiores_menores", agoraIso: "t1", camposDoBloco: CAMPOS_PARTE_03 });
    const segunda = acumularResumo(primeira, { tema: "regimes_casamento", agoraIso: "t2", camposDoBloco: CAMPOS_PARTE_03 });

    expect(segunda.perguntado.map((i) => i.t)).toEqual(["filhos_maiores_menores", "regimes_casamento"]);
  });

  it("pendente nunca passa de 8 itens (teto de produto)", () => {
    const campos18: RoteiroCampo[] = Array.from({ length: 12 }, (_, i) => ({ id: `campo_${i}`, rotulo: `Campo ${i}`, tipo: "texto" }));
    const resultado = acumularResumo(RESUMO_VAZIO, { tema: null, agoraIso: "t", camposDoBloco: campos18 });
    expect(resultado.pendente.length).toBeLessThanOrEqual(8);
  });

  it("perguntado nunca passa de 16 itens — poda o MENOS RECENTE quando estoura", () => {
    let acumulado = RESUMO_VAZIO;
    for (let i = 0; i < 20; i++) {
      const campos: RoteiroCampo[] = [{ id: `tema_${i}`, rotulo: `Tema ${i} bem específico`, tipo: "texto" }];
      acumulado = acumularResumo(acumulado, { tema: `tema_${i}`, agoraIso: `2026-09-18T14:${String(i).padStart(2, "0")}:00Z`, camposDoBloco: campos });
    }
    expect(acumulado.perguntado.length).toBeLessThanOrEqual(16);
    // Os mais recentes sobrevivem — o mais antigo (tema_0) foi podado primeiro.
    expect(acumulado.perguntado.some((i) => i.t === "tema_19")).toBe(true);
    expect(acumulado.perguntado.some((i) => i.t === "tema_0")).toBe(false);
  });

  it("cortado_em preservado (sempre null na Fatia A) através das chamadas", () => {
    const resultado = acumularResumo(RESUMO_VAZIO, { tema: "filhos_maiores_menores", agoraIso: "t", camposDoBloco: CAMPOS_PARTE_03 });
    expect(resultado.cortado_em).toBeNull();
  });
});

describe("acumularResumo — poda por bytes (cinto de segurança contra o CHECK de 4096 da 0091)", () => {
  it("16 itens de perguntado + 8 de pendente ficam MUITO abaixo do teto de 4096 bytes", () => {
    let acumulado = RESUMO_VAZIO;
    for (let i = 0; i < 16; i++) {
      const campos: RoteiroCampo[] = [{ id: `tema_bem_especifico_${i}`, rotulo: `Tema ${i}`, tipo: "texto" }];
      acumulado = acumularResumo(acumulado, { tema: `tema_bem_especifico_${i}`, agoraIso: `2026-09-18T14:${String(i).padStart(2, "0")}:00Z`, camposDoBloco: campos });
    }
    const camposComPendente: RoteiroCampo[] = Array.from({ length: 8 }, (_, i) => ({
      id: `pendente_campo_bem_longo_${i}`,
      rotulo: `Pendente ${i}`,
      tipo: "texto",
    }));
    const final = acumularResumo(acumulado, { tema: null, agoraIso: "2026-09-18T15:00:00Z", camposDoBloco: camposComPendente });

    const bytes = Buffer.byteLength(JSON.stringify(final), "utf8");
    expect(bytes).toBeLessThan(4096);
    expect(bytes).toBeLessThan(3500); // dentro do alvo de produto, não só do CHECK
    expect(final.perguntado.length).toBeLessThanOrEqual(16);
    expect(final.pendente.length).toBeLessThanOrEqual(8);
  });
});

describe("resumirParaContexto — pendente sempre recalculado contra o bloco ATUAL da chamada", () => {
  it("pendente persistido de um bloco anterior é IGNORADO — recalcula contra camposDoBlocoAtual", () => {
    const acumulado: ResumoAcumulado = {
      v: 1,
      perguntado: [{ t: "filhos_maiores_menores", em: "t", n: 1 }],
      pendente: ["algo_de_outro_bloco_qualquer"],
      cortado_em: null,
    };

    const resultado = resumirParaContexto(acumulado, CAMPOS_PARTE_03);

    expect(resultado.pendente).toEqual(["ocupacoes_idades", "regimes_casamento", "lista_bens"]);
    expect(resultado.perguntado).toEqual(acumulado.perguntado); // perguntado não muda na leitura
  });

  it("bloco atual sem nenhum campo pendente (tudo já perguntado) devolve pendente vazio", () => {
    const acumulado: ResumoAcumulado = {
      v: 1,
      perguntado: CAMPOS_PARTE_03.map((c) => ({ t: c.id, em: "t", n: 1 })),
      pendente: [],
      cortado_em: null,
    };
    const resultado = resumirParaContexto(acumulado, CAMPOS_PARTE_03);
    expect(resultado.pendente).toEqual([]);
  });
});

describe("normalizarResumoAcumulado — defesa contra o '{}'::jsonb legado (default da 0091, ANTES desta fatia)", () => {
  it("🔴 '{}' (o DEFAULT gravado em TODA sessão pré-existente) normaliza para RESUMO_VAZIO, nunca lança", () => {
    expect(normalizarResumoAcumulado({})).toEqual(RESUMO_VAZIO);
  });

  it("null normaliza para RESUMO_VAZIO", () => {
    expect(normalizarResumoAcumulado(null)).toEqual(RESUMO_VAZIO);
  });

  it("undefined normaliza para RESUMO_VAZIO", () => {
    expect(normalizarResumoAcumulado(undefined)).toEqual(RESUMO_VAZIO);
  });

  it("tipo primitivo (string/número/array solto) normaliza para RESUMO_VAZIO, nunca lança", () => {
    expect(normalizarResumoAcumulado("lixo")).toEqual(RESUMO_VAZIO);
    expect(normalizarResumoAcumulado(42)).toEqual(RESUMO_VAZIO);
    expect(normalizarResumoAcumulado([])).toEqual(RESUMO_VAZIO);
  });

  it("formato JÁ VÁLIDO passa intacto", () => {
    const valido: ResumoAcumulado = {
      v: 1,
      perguntado: [{ t: "filhos_maiores_menores", em: "2026-09-18T14:00:00Z", n: 3 }],
      pendente: ["regimes_casamento"],
      cortado_em: null,
    };
    expect(normalizarResumoAcumulado(valido)).toEqual(valido);
  });

  it("item de perguntado com campo do tipo errado é FILTRADO (defesa, não lança)", () => {
    const bruto = { perguntado: [{ t: "x", em: "t", n: "nao-e-numero" }, { t: "y", em: "t", n: 2 }], pendente: [] };
    const resultado = normalizarResumoAcumulado(bruto);
    expect(resultado.perguntado).toEqual([{ t: "y", em: "t", n: 2 }]);
  });

  it("item de pendente que não é string é FILTRADO", () => {
    const bruto = { perguntado: [], pendente: ["ok", 123, null, "outro_ok"] };
    const resultado = normalizarResumoAcumulado(bruto);
    expect(resultado.pendente).toEqual(["ok", "outro_ok"]);
  });
});

function consultaEncadeavel(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const encadeavel = () => builder;
  const terminal = async () => resultado;
  Object.assign(builder, { select: encadeavel, eq: encadeavel, maybeSingle: terminal });
  return builder;
}

describe("acumularResumoNaSessao — I/O, fail-CLOSED (B76) e caminho comum sem query", () => {
  it("ativo=false (parâmetro do chamador): NÃO consulta o banco, NUNCA chama a RPC (fail-CLOSED)", async () => {
    const rpcMock = vi.fn();
    const from = vi.fn();
    const admin = { from, rpc: rpcMock } as unknown as SupabaseClient;

    await acumularResumoNaSessao(admin, {
      sessaoId: "sessao-1",
      ativo: false,
      textoPerguntaSugerida: "Vocês têm filhos?",
      camposDoBlocoAtual: CAMPOS_PARTE_03,
    });

    expect(from).not.toHaveBeenCalled(); // 🔴 achado do Fable: ZERO leitura própria de config aqui — `ativo` já vem decidido
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ativo=true, sem pergunta E sem campos no bloco: NÃO consulta o banco (nada para categorizar nem recalcular)", async () => {
    const from = vi.fn();
    const admin = { from } as unknown as SupabaseClient;

    await acumularResumoNaSessao(admin, { sessaoId: "sessao-1", ativo: true, textoPerguntaSugerida: null, camposDoBlocoAtual: [] });

    expect(from).not.toHaveBeenCalled();
  });

  it("ativo=true, com pergunta categorizável: lê o acumulado, chama a RPC de CAS, aplica de primeira", async () => {
    const rpcMock = vi.fn((...args: unknown[]) => {
      void args;
      return { maybeSingle: async () => ({ data: { aplicado: true, resumo: { v: 1, perguntado: [], pendente: [], cortado_em: null } }, error: null }) };
    });
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes_copiloto") return consultaEncadeavel({ data: { resumo_acumulado: RESUMO_VAZIO }, error: null });
      throw new Error(`tabela não mockada: ${tabela}`);
    });
    const admin = { from, rpc: rpcMock } as unknown as SupabaseClient;

    await acumularResumoNaSessao(admin, {
      sessaoId: "sessao-1",
      ativo: true,
      textoPerguntaSugerida: "Vocês têm filhos maiores ou menores?",
      camposDoBlocoAtual: CAMPOS_PARTE_03,
      agoraIso: "2026-09-18T14:00:00Z",
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0]![0]).toBe("registrar_resumo_copiloto");
    const chamada = rpcMock.mock.calls[0]![1] as { p_sessao_id: string; p_resumo_esperado: unknown; p_resumo_novo: ResumoAcumulado };
    expect(chamada.p_sessao_id).toBe("sessao-1");
    expect(chamada.p_resumo_esperado).toEqual(RESUMO_VAZIO); // aqui o bruto do banco JÁ é o formato válido — igual ao esperado
    expect(chamada.p_resumo_novo.perguntado).toEqual([{ t: "filhos_maiores_menores", em: "2026-09-18T14:00:00Z", n: 1 }]);
  });

  it("🔴 REGRESSÃO — achado do Fable (integração, reproduz o defeito real medido em produção): banco devolve '{}' CRU (o DEFAULT real da 0091, não RESUMO_VAZIO mockado) + RPC recusa a 1ª tentativa devolvendo o MESMO '{}' cru — a 2ª chamada usa p_resumo_esperado='{}' BRUTO, e a função NUNCA lança", async () => {
    // Este teste falha SEM a correção do item 1 (usar o bruto, nunca o
    // normalizado, como token do CAS): antes da correção,
    // `gravarComRetentativa` recebia `atual` já normalizado como
    // `esperado` da 1ª chamada — a RPC (aqui simulada) compara por
    // igualdade ESTRUTURAL, então `{}` (o que realmente está gravado)
    // NUNCA bate com `{"v":1,...}` (o normalizado), e a 2ª chamada com
    // `primeira.resumo` (também `{}`, sem normalizar) quebrava dentro de
    // `acumularResumo` tentando iterar `undefined.perguntado`.
    let numeroDaChamada = 0;
    const chamadasRpc: unknown[] = [];
    const rpcMock = vi.fn((..._nomeEArgs: unknown[]) => {
      const args = _nomeEArgs[1] as { p_resumo_esperado: unknown };
      chamadasRpc.push(args);
      numeroDaChamada++;
      return {
        maybeSingle: async () => {
          if (numeroDaChamada === 1) {
            // RPC real: `is not distinct from` compara ESTRUTURALMENTE.
            // `{}` (o bruto) bate com `{}` (o que "está" no banco) —
            // simula exatamente essa igualdade, então aplica de primeira
            // quando o esperado É o `{}` correto.
            const esperadoEhObjetoVazio = JSON.stringify(args.p_resumo_esperado) === "{}";
            if (esperadoEhObjetoVazio) {
              return { data: { aplicado: true, resumo: {} }, error: null };
            }
            // Esperado normalizado (o BUG): nunca bate com o `{}` real —
            // simula a recusa que o achado do Fable documentou.
            return { data: { aplicado: false, resumo: {} }, error: null };
          }
          return { data: { aplicado: true, resumo: {} }, error: null };
        },
      };
    });
    const from = vi.fn((tabela: string) => {
      // O BRUTO real do banco é `{}` — NUNCA `RESUMO_VAZIO` (esse é o
      // ponto central do achado: mockar `RESUMO_VAZIO` escondia o defeito).
      if (tabela === "sessoes_copiloto") return consultaEncadeavel({ data: { resumo_acumulado: {} }, error: null });
      throw new Error(`tabela não mockada: ${tabela}`);
    });
    const admin = { from, rpc: rpcMock } as unknown as SupabaseClient;

    await expect(
      acumularResumoNaSessao(admin, {
        sessaoId: "sessao-1",
        ativo: true,
        textoPerguntaSugerida: "Vocês têm filhos maiores ou menores?",
        camposDoBlocoAtual: CAMPOS_PARTE_03,
        agoraIso: "2026-09-18T14:00:00Z",
      }),
    ).resolves.toBeUndefined(); // NUNCA lança — é a garantia central desta correção

    // A 1ª chamada da RPC usou o BRUTO ('{}'), não o normalizado — é a
    // correção do item 1 provada por observação direta do argumento.
    expect(JSON.stringify((chamadasRpc[0] as { p_resumo_esperado: unknown }).p_resumo_esperado)).toBe("{}");
    expect(rpcMock).toHaveBeenCalledTimes(1); // aplicou de primeira (o bruto '{}' bateu), sem precisar de retentativa
  });

  it("CAS recusado na 1ª tentativa: reaplica sobre o estado devolvido BRUTO e tenta 1 vez a mais", async () => {
    const estadoConcorrenteBruto = { v: 1, perguntado: [{ t: "regimes_casamento", em: "t0", n: 1 }], pendente: [], cortado_em: null };
    let chamada = 0;
    const rpcMock = vi.fn((...args: unknown[]) => {
      void args;
      return {
        maybeSingle: async () => {
          chamada++;
          if (chamada === 1) return { data: { aplicado: false, resumo: estadoConcorrenteBruto }, error: null };
          return { data: { aplicado: true, resumo: estadoConcorrenteBruto }, error: null };
        },
      };
    });
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes_copiloto") return consultaEncadeavel({ data: { resumo_acumulado: RESUMO_VAZIO }, error: null });
      throw new Error(`tabela não mockada: ${tabela}`);
    });
    const admin = { from, rpc: rpcMock } as unknown as SupabaseClient;

    await acumularResumoNaSessao(admin, {
      sessaoId: "sessao-1",
      ativo: true,
      textoPerguntaSugerida: "Vocês têm filhos maiores ou menores?",
      camposDoBlocoAtual: CAMPOS_PARTE_03,
      agoraIso: "2026-09-18T14:00:00Z",
    });

    expect(rpcMock).toHaveBeenCalledTimes(2);
    const segundaChamada = rpcMock.mock.calls[1]![1] as { p_resumo_esperado: unknown; p_resumo_novo: ResumoAcumulado };
    // 🔴 achado do Fable: o esperado da 2ª chamada é `primeira.resumo` BRUTO
    // (o mesmo objeto devolvido pela RPC), nunca normalizado de novo.
    expect(segundaChamada.p_resumo_esperado).toEqual(estadoConcorrenteBruto);
    expect(segundaChamada.p_resumo_novo.perguntado.map((i) => i.t)).toEqual(["regimes_casamento", "filhos_maiores_menores"]);
  });

  it("CAS recusado DUAS vezes: desiste sem lançar (registrarErro interno, caminho quente nunca trava)", async () => {
    const estadoConcorrente: ResumoAcumulado = { v: 1, perguntado: [], pendente: [], cortado_em: null };
    const rpcMock = vi.fn(() => ({
      maybeSingle: async () => ({ data: { aplicado: false, resumo: estadoConcorrente }, error: null }),
    }));
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes_copiloto") return consultaEncadeavel({ data: { resumo_acumulado: RESUMO_VAZIO }, error: null });
      throw new Error(`tabela não mockada: ${tabela}`);
    });
    const admin = { from, rpc: rpcMock } as unknown as SupabaseClient;

    await expect(
      acumularResumoNaSessao(admin, {
        sessaoId: "sessao-1",
        ativo: true,
        textoPerguntaSugerida: "Vocês têm filhos maiores ou menores?",
        camposDoBlocoAtual: CAMPOS_PARTE_03,
      }),
    ).resolves.toBeUndefined();

    expect(rpcMock).toHaveBeenCalledTimes(2); // 1ª tentativa + 1 retentativa, nunca uma 3ª
  });

  it("erro na leitura do acumulado não lança — sai silenciosamente (try/catch do item 2 cobre também esta função interna)", async () => {
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes_copiloto") return consultaEncadeavel({ data: null, error: new Error("falha") });
      throw new Error(`tabela não mockada: ${tabela}`);
    });
    const admin = { from } as unknown as SupabaseClient;

    await expect(
      acumularResumoNaSessao(admin, {
        sessaoId: "sessao-1",
        ativo: true,
        textoPerguntaSugerida: "Vocês têm filhos maiores ou menores?",
        camposDoBlocoAtual: CAMPOS_PARTE_03,
      }),
    ).resolves.toBeUndefined();
  });

  it("🔴 EXCEÇÃO INESPERADA dentro do fluxo (ex.: `from` lança um erro não tratado) NUNCA sobe ao chamador — try/catch do CONTORNO inteiro (item 2 do achado do Fable)", async () => {
    const from = vi.fn(() => {
      throw new Error("erro totalmente inesperado, nunca prevint pelo código interno");
    });
    const admin = { from } as unknown as SupabaseClient;

    await expect(
      acumularResumoNaSessao(admin, {
        sessaoId: "sessao-1",
        ativo: true,
        textoPerguntaSugerida: "Vocês têm filhos maiores ou menores?",
        camposDoBlocoAtual: CAMPOS_PARTE_03,
      }),
    ).resolves.toBeUndefined();
  });

  it("pergunta que não categoriza E pendente não muda: NÃO chama a RPC (nada mudou de fato)", async () => {
    const rpcMock = vi.fn();
    const acumuladoJaCorreto: ResumoAcumulado = {
      v: 1,
      perguntado: [],
      pendente: CAMPOS_PARTE_03.map((c) => c.id).slice(0, 8),
      cortado_em: null,
    };
    const from = vi.fn((tabela: string) => {
      if (tabela === "sessoes_copiloto") return consultaEncadeavel({ data: { resumo_acumulado: acumuladoJaCorreto }, error: null });
      throw new Error(`tabela não mockada: ${tabela}`);
    });
    const admin = { from, rpc: rpcMock } as unknown as SupabaseClient;

    await acumularResumoNaSessao(admin, {
      sessaoId: "sessao-1",
      ativo: true,
      textoPerguntaSugerida: "Como está o tempo hoje?", // não categoriza
      camposDoBlocoAtual: CAMPOS_PARTE_03,
    });

    expect(rpcMock).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 REGRESSÃO MEDIDA — falso-positivo por palavra genérica de rótulo
 * (18/09/2026, achado na revisão da fatia de sinônimos).
 *
 * O rótulo do roteiro v5 "Quem paga as contas hoje" produzia o termo
 * significativo "hoje" (4 letras, fora da stop-list original). Medido nas 122
 * perguntas reais exibidas na sessão do Carlos Alberto: **30 continham
 * "hoje"**, e **26 delas não tinham nenhuma relação com contas** ("Quantos
 * anos ela tem hoje?", "onde elas moram hoje?").
 *
 * Todas seriam gravadas como `quem_paga_contas` — e isso é PIOR que não
 * categorizar: a memória passaria a bloquear o tema errado, calando uma
 * pergunta legítima sobre idade ou moradia porque "contas já foi perguntado".
 */
describe("categorizarPergunta — palavra genérica de rótulo não pode casar (18/09/2026)", () => {
  const CAMPOS_REAIS: RoteiroCampo[] = [
    { id: "quem_paga_contas", tipo: "texto_longo", rotulo: "Quem paga as contas hoje" },
    { id: "ocupacoes_idades", tipo: "texto_longo", rotulo: "Ocupações e idades" },
    { id: "filhos_maiores_menores", tipo: "texto_longo", rotulo: "Filhos (maiores ou menores)" },
  ];

  it("🔴 'Quantos anos ela tem hoje?' NÃO cai em quem_paga_contas — cai no campo certo", () => {
    const tema = categorizarPergunta("Quantos anos ela tem hoje?", CAMPOS_REAIS);
    expect(tema).not.toBe("quem_paga_contas");
    expect(tema).toBe("ocupacoes_idades");
  });

  it("🔴 'E onde elas moram hoje?' NÃO cai em quem_paga_contas", () => {
    expect(categorizarPergunta("E onde elas moram hoje?", CAMPOS_REAIS)).not.toBe("quem_paga_contas");
  });

  it("a pergunta que É sobre contas continua casando (a correção não derrubou o recall)", () => {
    expect(categorizarPergunta("Quem paga as contas da casa?", CAMPOS_REAIS)).toBe("quem_paga_contas");
  });

  it("palavras interrogativas e temporais não viram tema sozinhas", () => {
    for (const generica of ["hoje", "agora", "quando", "onde", "quantos", "qual"]) {
      expect(categorizarPergunta(`E ${generica}?`, CAMPOS_REAIS)).toBeNull();
    }
  });
});

/**
 * 🔴 TESTE DE NÃO-REGRESSÃO (18/09/2026, achado do Fable — a ausência deste
 * teste é o que deixou 3 regressões passarem em 401 testes verdes). Prova a
 * frase do comentário de topo ("união, nunca substituição — não regride")
 * CONTRA O CASAMENTO SÓ POR RÓTULO (comportamento do HEAD, antes de
 * `SINONIMOS_POR_CAMPO` existir): para cada pergunta abaixo, o resultado
 * usando SÓ o rótulo (sem nenhum sinônimo cadastrado) é o "campo X" que o
 * HEAD dava — e o resultado da função REAL (com sinônimos) tem que continuar
 * dando X, nunca outro campo.
 *
 * As 3 perguntas são EXATAMENTE as regressões medidas pelo Fable:
 *   - "reservas financeiras disponíveis" era capturado só pelo rótulo de
 *     `reservas_financeiras` (o próprio nome do campo) — não pode mais cair
 *     em `lista_bens`.
 *   - "valor afetivo" era capturado só pelo rótulo de `relacao_pessoal_bem`
 *     ("valor emocional") — não pode mais cair em `lista_bens`.
 *   - "tratamento tributário do ITCMD" era capturado só pelo rótulo de
 *     `ciencia_itcmd_reforma` ("ciência... itcmd") — não pode mais cair em
 *     `reserva_seguro_inventario`.
 */
describe("categorizarPergunta — NÃO-REGRESSÃO: casamento só por rótulo (comportamento do HEAD) continua funcionando com os sinônimos ativos", () => {
  /** Roteiro v5 completo (parte_03 + `ciencia_itcmd_reforma` da parte_04) —
   * mesmos `id`s/rótulos conferidos em `0118_roteiro_v5_conteudo_do_script.sql`. */
  const ROTEIRO_V5_PARTE_03_E_04: RoteiroCampo[] = [
    ...CAMPOS_ROTEIRO_REAL,
    { id: "custo_inventario_apresentado", rotulo: "Custo do inventário apresentado ao cliente (quanto os filhos gastariam)", tipo: "texto_longo" },
    { id: "ciencia_itcmd_reforma", rotulo: "Ciência do cliente sobre o aumento do ITCMD com a reforma tributária", tipo: "texto_longo" },
  ];

  it("🔴 REGRESSÃO 1: 'Vocês têm reservas financeiras disponíveis?' → reservas_financeiras (HEAD já acertava pelo rótulo; esta fatia NÃO pode regredir para lista_bens)", () => {
    // Prova o comportamento do HEAD: só rótulo (sem SINONIMOS_POR_CAMPO) já
    // categoriza certo, porque o rótulo de `reservas_financeiras` É "Reservas
    // financeiras disponíveis" — a própria pergunta.
    const rotuloBate = termosSignificativosParaTeste("Reservas financeiras disponíveis").some((t) =>
      normalizarParaTeste("Vocês têm reservas financeiras disponíveis?").includes(t),
    );
    expect(rotuloBate).toBe(true);

    // A função REAL (com sinônimos) tem que dar o MESMO campo do HEAD.
    expect(categorizarPergunta("Vocês têm reservas financeiras disponíveis?", ROTEIRO_V5_PARTE_03_E_04)).toBe("reservas_financeiras");
  });

  it("🔴 REGRESSÃO 2: 'Esse imóvel tem valor afetivo para a família?' → relacao_pessoal_bem (HEAD já acertava por 'valor emocional' no rótulo; não pode regredir para lista_bens)", () => {
    expect(categorizarPergunta("Esse imóvel tem valor afetivo para a família?", ROTEIRO_V5_PARTE_03_E_04)).toBe(
      "relacao_pessoal_bem",
    );
  });

  it("🔴 REGRESSÃO 3: 'Qual o tratamento tributário do ITCMD?' → ciencia_itcmd_reforma (não pode regredir para reserva_seguro_inventario, capturado antes só por 'tratamento')", () => {
    expect(categorizarPergunta("Qual o tratamento tributário do ITCMD?", ROTEIRO_V5_PARTE_03_E_04)).toBe(
      "ciencia_itcmd_reforma",
    );
  });
});

/** Cópia mínima de `normalizar`/`termosSignificativos` só para o teste de
 * não-regressão PROVAR o comportamento do HEAD de forma independente (sem
 * importar função interna não exportada) — mantém a mesma régua de
 * normalização do módulo real (NFD, sem diacrítico, minúsculas). */
function normalizarParaTeste(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
function termosSignificativosParaTeste(rotulo: string): string[] {
  const ignoradas = new Set(["a", "o", "e", "de", "da", "do", "das", "dos", "em", "para"]);
  return normalizarParaTeste(rotulo)
    .replace(/[()/,.-]/g, " ")
    .split(" ")
    .filter((t) => t.length >= 4 && !ignoradas.has(t));
}

/**
 * 🔴 TRIPWIRE DO MAPA (18/09/2026, achado do Fable — item 4). Sem este
 * teste, `SINONIMOS_POR_CAMPO` envelhece em silêncio: se a Dra. Elaine
 * publicar um roteiro v6 que renomeia ou remove um `campo.id`, o mapa
 * continua com sinônimos apontando para um `id` que não existe mais em
 * NENHUM roteiro — nem erro, nem aviso, só uma entrada morta que nunca casa
 * com nada. Este teste falha o build se isso acontecer, forçando quem mexeu
 * no roteiro a também revisar `SINONIMOS_POR_CAMPO`.
 *
 * `CAMPOS_ROTEIRO_REAL` (parte_03) + o campo de `ciencia_itcmd_reforma`
 * (parte_04) já servem de espelho do roteiro ativo — mesma lista usada nos
 * testes de aceite acima, conferida contra `0118_roteiro_v5_conteudo_do_script.sql`.
 */
describe("SINONIMOS_POR_CAMPO — tripwire: todo campo.id do mapa existe no roteiro ativo", () => {
  it("🔴 nenhum campo.id de SINONIMOS_POR_CAMPO é órfão — todos existem no espelho do roteiro v5 ativo", () => {
    const idsDoRoteiroV5 = new Set([
      ...CAMPOS_ROTEIRO_REAL.map((c) => c.id),
      "custo_inventario_apresentado",
      "ciencia_itcmd_reforma",
    ]);
    const idsDoMapa = Object.keys(SINONIMOS_POR_CAMPO);
    const orfaos = idsDoMapa.filter((id) => !idsDoRoteiroV5.has(id));
    expect(orfaos).toEqual([]);
  });
});

/**
 * 🔴 REGRESSÃO MEDIDA PELO FABLE (18/09/2026, iteração 2).
 *
 * A frase "quantos anos" é o termo natural de idade, mas precedida de "há"
 * vira DURAÇÃO: "há quantos anos vocês são casados / moram / compraram" são
 * perguntas de regime, moradia e aquisição. Casá-las com `ocupacoes_idades`
 * faria a memória calar o tema idade antes de alguém perguntar sobre idade —
 * falso-positivo, que por critério do dono é pior que não categorizar.
 *
 * Um comentário do código afirmava que a frase de 2 palavras era "específica
 * o bastante para não colidir". A medição desmentiu nos três casos; a
 * afirmação foi removida junto com a correção.
 */
describe("categorizarPergunta — construção temporal não é idade (18/09/2026)", () => {
  const CAMPOS: RoteiroCampo[] = [
    { id: "regimes_casamento", tipo: "texto_longo", rotulo: "Regimes de casamento de todos os envolvidos" },
    { id: "ocupacoes_idades", tipo: "texto_longo", rotulo: "Ocupações e idades" },
    { id: "valores_mercado_aquisicao", tipo: "texto_longo", rotulo: "Valores de mercado e de aquisição, datas e formas de pagamento de cada bem" },
  ];

  it("🔴 'Há quantos anos vocês são casados?' NÃO é idade", () => {
    expect(categorizarPergunta("Há quantos anos vocês são casados?", CAMPOS)).not.toBe("ocupacoes_idades");
  });

  it("🔴 'Comprou esse imóvel há quantos anos?' NÃO é idade", () => {
    expect(categorizarPergunta("Comprou esse imóvel há quantos anos?", CAMPOS)).not.toBe("ocupacoes_idades");
  });

  it("🔴 'Há quantos anos moram nessa casa?' NÃO é idade", () => {
    expect(categorizarPergunta("Há quantos anos moram nessa casa?", CAMPOS)).not.toBe("ocupacoes_idades");
  });

  it("a pergunta que É de idade continua casando (a correção não derrubou o recall)", () => {
    expect(categorizarPergunta("Quantos anos a Flávia tem?", CAMPOS)).toBe("ocupacoes_idades");
    expect(categorizarPergunta("Quantos anos ela tem hoje?", CAMPOS)).toBe("ocupacoes_idades");
  });
});
