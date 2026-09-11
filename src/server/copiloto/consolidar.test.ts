import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { concatenarSegmentos } from "./consolidar";

/**
 * Consolidação em `transcricoes` (Fase 10, Fatia 3, §6.1/§11-item-1 do
 * plano) — "é aqui que a feature limpa em vez de empilhar": dá produtor
 * automático ao `POST /api/sessoes/[id]/transcricao` que existe desde a
 * Fase 3 e nunca teve uso real.
 */

describe("concatenarSegmentos — função pura", () => {
  it("junta em ORDEM (parâmetro de entrada, não reordena por criado_em)", () => {
    const texto = concatenarSegmentos([
      { ordem: 1, falante: "advogada", texto: "Boa tarde." },
      { ordem: 2, falante: "cliente", texto: "Boa tarde, doutora." },
    ]);
    expect(texto).toBe("advogada: Boa tarde.\ncliente: Boa tarde, doutora.");
  });

  it("segmento SEM falante (comum no manual, Fatia 1) não inventa rótulo — só o texto", () => {
    const texto = concatenarSegmentos([{ ordem: 1, falante: null, texto: "Trecho digitado sem identificar quem fala." }]);
    expect(texto).toBe("Trecho digitado sem identificar quem fala.");
  });

  it("lista vazia → string vazia (o chamador decide não inserir, não este módulo)", () => {
    expect(concatenarSegmentos([])).toBe("");
  });

  it("mistura de com/sem falante na mesma sessão", () => {
    const texto = concatenarSegmentos([
      { ordem: 1, falante: null, texto: "Início sem falante." },
      { ordem: 2, falante: "advogada", texto: "Com falante." },
    ]);
    expect(texto).toBe("Início sem falante.\nadvogada: Com falante.");
  });
});

// ---------------------------------------------------------------------------
// consolidarTranscricaoDaSessao — piso de tamanho e idempotência básica
// ---------------------------------------------------------------------------

interface Resultado {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}

class ConsultaFalsa implements PromiseLike<Resultado> {
  constructor(private readonly tabela: string, private readonly respostas: Record<string, Resultado>) {}
  select() { return this; }
  eq() { return this; }
  order() { return this; }
  like() { return this; }
  insert() { return this; }
  returns() { return this; }
  single() { return Promise.resolve(this.respostas[`${this.tabela}.single`] ?? { data: null, error: null }); }
  then<R1 = Resultado, R2 = never>(ok?: ((v: Resultado) => R1 | PromiseLike<R1>) | null): PromiseLike<R1 | R2> {
    return Promise.resolve(this.respostas[this.tabela] ?? { data: [], error: null }).then(ok) as PromiseLike<R1>;
  }
}

function cliente(respostas: Record<string, Resultado>): SupabaseClient {
  return { from: (t: string) => new ConsultaFalsa(t, respostas) } as unknown as SupabaseClient;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consolidarTranscricaoDaSessao", () => {
  it("ZERO segmentos → transcricaoId null, NENHUM insert em transcricoes (nunca insere vazio)", async () => {
    const { consolidarTranscricaoDaSessao } = await import("./consolidar");
    const r = await consolidarTranscricaoDaSessao(cliente({ sessoes_copiloto_segmentos: { data: [], error: null } }), {
      sessaoId: "s1",
      jornadaId: "j1",
      rotulo: "Sessão de Viabilidade — Teste",
      dataReuniao: null,
    });
    expect(r).toEqual({ transcricaoId: null, jaExistia: false });
  });

  it("segmentos existem mas o texto concatenado fica ABAIXO do piso de 200 caracteres → transcricaoId null", async () => {
    const { consolidarTranscricaoDaSessao } = await import("./consolidar");
    const r = await consolidarTranscricaoDaSessao(
      cliente({ sessoes_copiloto_segmentos: { data: [{ ordem: 1, falante: null, texto: "Oi." }], error: null } }),
      { sessaoId: "s1", jornadaId: "j1", rotulo: "x", dataReuniao: null },
    );
    expect(r).toEqual({ transcricaoId: null, jaExistia: false });
  });

  it("texto acima do piso → insere em transcricoes e devolve o id", async () => {
    const textoLongo = "advogada: " + "Isto é um trecho de sessão longo o bastante para passar do piso de duzentos caracteres. ".repeat(3);
    const { consolidarTranscricaoDaSessao } = await import("./consolidar");
    const r = await consolidarTranscricaoDaSessao(
      cliente({
        sessoes_copiloto_segmentos: { data: [{ ordem: 1, falante: "advogada", texto: textoLongo }], error: null },
        transcricoes: { data: [], error: null }, // like() para calcular a próxima versão
        "transcricoes.single": { data: { id: "transcricao-1", arquivo_origem: "sessao:s1:v1", tamanho_bytes: 500, sha256: "abc", importado_em: "2026-09-11T14:00:00Z" }, error: null },
      }),
      { sessaoId: "s1", jornadaId: "j1", rotulo: "x", dataReuniao: null },
    );
    expect(r).toEqual({ transcricaoId: "transcricao-1", jaExistia: false });
  });
});
