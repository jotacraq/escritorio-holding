import { describe, expect, it } from "vitest";
import {
  confirmacaoNomeConfere,
  impedimentoParaAnonimizar,
  type JornadaParaAnonimizar,
  type PessoaParaAnonimizar,
} from "./anonimizacao";

function pessoa(sobrescreve: Partial<PessoaParaAnonimizar> = {}): PessoaParaAnonimizar {
  return {
    id: "3f2a1c9d-0000-4000-8000-000000000001",
    nome: "Marcos Antônio Ribeiro",
    origem_dado: "real",
    auth_user_id: null,
    anonimizada_em: null,
    ...sobrescreve,
  };
}

const jornada = (etapa: string, desfecho: string): JornadaParaAnonimizar => ({ etapa, desfecho });

describe("impedimentoParaAnonimizar", () => {
  it("libera titular real, sem login e sem holding em execução", () => {
    expect(impedimentoParaAnonimizar(pessoa(), [jornada("sessao_realizada", "aberta")])).toBeNull();
  });

  it("recusa dado de demonstração — as 4 famílias de exemplo não são titulares", () => {
    expect(impedimentoParaAnonimizar(pessoa({ origem_dado: "exemplo" }), [])?.codigo).toBe("origem_dado_exemplo");
  });

  it("recusa pessoa com conta de acesso", () => {
    expect(impedimentoParaAnonimizar(pessoa({ auth_user_id: "auth-1" }), [])?.codigo).toBe("titular_com_login");
  });

  it("recusa enquanto houver holding contratada em execução (B41)", () => {
    const jornadas = [jornada("sessao_realizada", "ganha"), jornada("holding_contratada", "aberta")];
    expect(impedimentoParaAnonimizar(pessoa(), jornadas)?.codigo).toBe("holding_em_execucao");
  });

  it("libera quando a holding contratada já foi encerrada", () => {
    expect(impedimentoParaAnonimizar(pessoa(), [jornada("holding_contratada", "ganha")])).toBeNull();
  });

  it("devolve o impedimento na MESMA ordem da RPC (exemplo vence login)", () => {
    const p = pessoa({ origem_dado: "exemplo", auth_user_id: "auth-1" });
    expect(impedimentoParaAnonimizar(p, [jornada("holding_contratada", "aberta")])?.codigo).toBe("origem_dado_exemplo");
  });
});

describe("confirmacaoNomeConfere", () => {
  it("aceita o nome exato e tolera espaço repetido", () => {
    expect(confirmacaoNomeConfere("Marcos Antônio Ribeiro", "Marcos Antônio Ribeiro")).toBe(true);
    expect(confirmacaoNomeConfere("Marcos Antônio Ribeiro", "  Marcos  Antônio Ribeiro ")).toBe(true);
  });

  it("recusa acento errado, caixa errada, nome parcial e tipo errado", () => {
    expect(confirmacaoNomeConfere("Marcos Antônio Ribeiro", "Marcos Antonio Ribeiro")).toBe(false);
    expect(confirmacaoNomeConfere("Marcos Antônio Ribeiro", "marcos antônio ribeiro")).toBe(false);
    expect(confirmacaoNomeConfere("Marcos Antônio Ribeiro", "Marcos")).toBe(false);
    expect(confirmacaoNomeConfere("Marcos Antônio Ribeiro", 42)).toBe(false);
    expect(confirmacaoNomeConfere("Marcos Antônio Ribeiro", undefined)).toBe(false);
  });

  it("nunca aceita quando o nome real está vazio (evita confirmar com string vazia)", () => {
    expect(confirmacaoNomeConfere("", "")).toBe(false);
    expect(confirmacaoNomeConfere("   ", " ")).toBe(false);
  });
});
