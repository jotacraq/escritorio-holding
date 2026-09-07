/**
 * O cliente de "Arquivar processo" (`api-arquivar.ts`).
 *
 * O que estes casos protegem: a tela nunca inventa o que aconteceu. O resumo
 * do toast é montado SÓ com os números que a RPC contou; erro sem mensagem
 * legível vira uma frase que diz que nada mudou, e não um diagnóstico
 * inventado; e o código do erro chega inteiro à UI, porque
 * `jornada_aberta_existente` é o único caso em que a pessoa pode resolver.
 *
 * `fetch` é substituído por um dublê — o objetivo aqui é o CONTRATO do
 * cliente, não a rota (essa é provada por `scripts/verificacao-0086.sql` e
 * pelo navegador).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ErroArquivamento,
  arquivarProcesso,
  desarquivarProcesso,
  resumoDoArquivamento,
  resumoDoDesarquivamento,
} from "./api-arquivar";

const JORNADA = "11111111-1111-1111-1111-111111111111";

function responder(status: number, corpo: unknown) {
  const espiao = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(corpo),
  });
  vi.stubGlobal("fetch", espiao);
  return espiao;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("arquivarProcesso", () => {
  it("A · manda motivo e a escolha de revogar links, e devolve o resultado contado", async () => {
    const espiao = responder(200, {
      resultado: { jornada_id: JORNADA, desfecho: "congelada", mensagens_canceladas: 2, ligacoes_canceladas: 1, links_revogados: 0 },
    });

    const r = await arquivarProcesso(JORNADA, { motivo: "parou de responder", revogarLinks: false });

    expect(espiao).toHaveBeenCalledTimes(1);
    const [url, opcoes] = espiao.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/jornadas/${JORNADA}/arquivar`);
    expect(opcoes.method).toBe("POST");
    expect(JSON.parse(String(opcoes.body))).toEqual({ motivo: "parou de responder", revogarLinks: false });
    expect(r.mensagens_canceladas).toBe(2);
  });

  it("B · `revogarLinks: true` vai explícito no corpo (B51 — nunca implícito)", async () => {
    const espiao = responder(200, { resultado: { jornada_id: JORNADA, desfecho: "congelada", links_revogados: 3 } });
    await arquivarProcesso(JORNADA, { motivo: "encerrado", revogarLinks: true });
    expect(JSON.parse(String((espiao.mock.calls[0] as [string, RequestInit])[1].body)).revogarLinks).toBe(true);
  });

  it("C · conflito do servidor vira ErroArquivamento com CÓDIGO preservado", async () => {
    responder(409, { erro: "jornada_aberta_existente", mensagem: "Esta pessoa já tem outro processo em andamento." });
    await expect(desarquivarProcesso(JORNADA)).rejects.toMatchObject({
      name: "ErroArquivamento",
      status: 409,
      codigo: "jornada_aberta_existente",
      message: "Esta pessoa já tem outro processo em andamento.",
    });
  });

  it("D · erro sem corpo legível não vira diagnóstico inventado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "<html>502</html>" }),
    );
    const erro = await arquivarProcesso(JORNADA, { motivo: "x", revogarLinks: false }).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroArquivamento);
    expect((erro as ErroArquivamento).message).toContain("continua como estava");
  });

  it("E · 200 sem `resultado` é erro, não sucesso mudo", async () => {
    responder(200, { ok: true });
    await expect(desarquivarProcesso(JORNADA)).rejects.toBeInstanceOf(ErroArquivamento);
  });

  it("F · desarquivar não manda corpo — não há opção a escolher", async () => {
    const espiao = responder(200, { resultado: { jornada_id: JORNADA, desfecho: "aberta", mensagens_reagendadas: 0 } });
    await desarquivarProcesso(JORNADA);
    const [url, opcoes] = espiao.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/jornadas/${JORNADA}/desarquivar`);
    expect(opcoes.body).toBeUndefined();
  });
});

describe("o texto do toast só fala do que foi contado", () => {
  it("G · zero é dito por extenso, nunca omitido", () => {
    // "Arquivado" sozinho deixa a pessoa sem saber se a régua parou ou se não
    // havia régua nenhuma. São duas situações diferentes.
    expect(resumoDoArquivamento({ jornada_id: JORNADA, desfecho: "congelada", mensagens_canceladas: 0 })).toBe(
      "nenhuma mensagem estava agendada",
    );
  });

  it("H · singular e plural, e o que não aconteceu não aparece", () => {
    const texto = resumoDoArquivamento({
      jornada_id: JORNADA,
      desfecho: "congelada",
      mensagens_canceladas: 1,
      ligacoes_canceladas: 1,
      links_revogados: 0,
    });
    expect(texto).toBe("1 mensagem cancelada · 1 ligação tirada da fila");
    expect(texto).not.toContain("link");
  });

  it("I · links revogados aparecem quando houve revogação", () => {
    expect(
      resumoDoArquivamento({ jornada_id: JORNADA, desfecho: "congelada", mensagens_canceladas: 3, links_revogados: 2 }),
    ).toBe("3 mensagens canceladas · 2 links revogados");
  });

  it("J · o desfazer avisa o que NÃO voltou (a ligação por IA)", () => {
    expect(
      resumoDoDesarquivamento({ jornada_id: JORNADA, desfecho: "aberta", mensagens_reagendadas: 2, ligacoes_nao_refeitas: 1 }),
    ).toBe("2 mensagens voltaram para a fila · 1 ligação por IA não foi refeita");
  });

  it("K · processo em holding contratada volta como Ganho — e o toast diz isso", () => {
    // A máquina de estados (`app.valida_transicao_jornada`) reescreve o
    // desfecho para `ganha`. Sem esta frase, parece bug.
    const texto = resumoDoDesarquivamento({ jornada_id: JORNADA, desfecho: "ganha", mensagens_reagendadas: 0 });
    expect(texto).toContain("voltou como Ganho");
  });
});
