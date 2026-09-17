import { describe, expect, it } from "vitest";
import type { Ficha360 } from "@/lib/api";
import { acaoDeAgora } from "./TrilhoDaFicha";

/**
 * T4 — "não sei o que preciso fazer": o rótulo da ação de agora passou a
 * levar o DONO junto ("Ligar para o cliente · Equipe"), não só o verbo.
 * `acaoDeAgora` é pura — testa de mesa, sem montar componente nem mockar
 * fetch (a Fase 5, `useRecurso`/`buscarExecucao`, é só do `TrilhoDaFicha`
 * em si; a função exportada não depende disso).
 */

/** Fixture mínimo: só o que `sinaisDaFicha` lê de `Ficha360` (ver `lib/pasta/sinais.ts`). */
function ficha(opcoes: {
  etapa?: string;
  nivelPago?: 0 | 1 | 2 | 3;
  ligacaoRealizada?: boolean;
  agendamento?: { inicio_em: string; status: "agendado" | "confirmado"; presenca_confirmada_em?: string | null };
}): Ficha360 {
  return {
    jornada: { id: "jornada-1", etapa: opcoes.etapa, desfecho: "aberta", nivel_pago: opcoes.nivelPago ?? 0 },
    pessoa: { id: "p1", nome: "Cláudia Bittencourt" },
    ligacao: opcoes.ligacaoRealizada === undefined ? null : { realizada_em: opcoes.ligacaoRealizada ? "2026-09-01T10:00:00Z" : null },
    briefingAtual: null,
    sessao: null,
    relatorio: null,
    formulario: null,
    agendamentos: opcoes.agendamento ? [{ id: "ag1", ...opcoes.agendamento }] : [],
    documentos: [],
    timeline: [],
    tarefasAbertas: [],
  } as unknown as Ficha360;
}

describe("acaoDeAgora — rótulo carrega o dono", () => {
  it("devolve null quando ninguém deve nada (sem informação suficiente)", () => {
    expect(acaoDeAgora(ficha({}), { temBarraEnviar: true })).toBeNull();
  });

  it("etapa=captado, nivel_pago=0 -> aguardar a compra é do CLIENTE, sem botão (sem rota nem gaveta)", () => {
    // Teste de mesa #2 de `proximo-passo.ts`: aguardar_compra não tem `rota`
    // nem é `ITENS_EM_GAVETA`, então `acaoDeAgora` devolve null (é o caso
    // "sem botão, vira nota" do próprio `TrilhoDaFicha`, que mostra
    // "aguardando · Cliente" no lugar do botão).
    const acao = acaoDeAgora(ficha({ etapa: "captado", nivelPago: 0 }), { temBarraEnviar: true });
    expect(acao).toBeNull();
  });

  it("etapa=sessao_contratada, ligação pendente -> botão abre a gaveta 'ligacao' e o rótulo termina com '· Equipe'", () => {
    const acao = acaoDeAgora(ficha({ etapa: "sessao_contratada", nivelPago: 1, ligacaoRealizada: false }), { temBarraEnviar: true });
    expect(acao).not.toBeNull();
    expect(acao?.tipo).toBe("abrir-gaveta");
    expect(acao?.rotulo.endsWith(" · Equipe")).toBe(true);
    // O `title` também carrega o dono — nunca só no rótulo do fluxo.
    expect(acao?.title).toContain("Equipe");
  });

  it("etapa=sessao_agendada, sessão em 2 dias, presença não confirmada -> dono é CLIENTE no rótulo e no title", () => {
    const emDoisDias = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const acao = acaoDeAgora(
      ficha({
        etapa: "sessao_agendada",
        nivelPago: 1,
        ligacaoRealizada: true,
        agendamento: { inicio_em: emDoisDias, status: "confirmado", presenca_confirmada_em: null },
      }),
      { temBarraEnviar: true },
    );
    expect(acao).not.toBeNull();
    expect(acao?.rotulo.endsWith(" · Cliente")).toBe(true);
    expect(acao?.title).toContain("Cliente");
  });
});
