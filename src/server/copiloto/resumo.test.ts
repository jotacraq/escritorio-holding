import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { acumularResumo, acumularResumoNaSessao, categorizarPergunta, normalizarResumoAcumulado, resumirParaContexto, RESUMO_VAZIO } from "./resumo";
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

  it("ordem de `campos[]` decide o campo quando dois casariam ao mesmo tempo — determinístico, sempre o mesmo", () => {
    const campos: RoteiroCampo[] = [
      { id: "a", rotulo: "Bens e Patrimônio", tipo: "texto" },
      { id: "b", rotulo: "Patrimônio total", tipo: "texto" },
    ];
    expect(categorizarPergunta("Qual o patrimônio total da família?", campos)).toBe("a");
  });

  it("acentuação e caixa não impedem o casamento (normalização)", () => {
    const tema = categorizarPergunta("QUAIS SÃO AS OCUPAÇÕES ATUAIS DE VOCÊS?", CAMPOS_PARTE_03);
    expect(tema).toBe("ocupacoes_idades");
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
