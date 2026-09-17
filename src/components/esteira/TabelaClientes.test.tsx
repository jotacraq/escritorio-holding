// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import type { JornadaKanban } from "@/lib/api";
import { TabelaClientes } from "./TabelaClientes";

/**
 * T4 — "não entendo o que posso fazer": a lista de Clientes ganhou a coluna
 * "O que fazer", com o MESMO `ChipProximoPasso` do cartão do kanban
 * (`derivarProximoPasso(sinaisDoKanban(j))`, zero fetch por linha).
 */

function jornada(parcial: Partial<JornadaKanban>): JornadaKanban {
  return {
    id: "j1",
    etapa: "captado",
    desfecho: "aberta",
    origem: "seminario",
    trilha: "seminario",
    edicao_id: null,
    edicao_codigo: null,
    faixa_patrimonio_declarada: null,
    nivel_pago: 0,
    responsavel_id: null,
    pessoa_id: "p1",
    nome: "Cláudia Bittencourt",
    cidade: "Recife",
    uf: "PE",
    telefone: null,
    email: null,
    entrou_na_etapa_em: "2026-09-01T00:00:00Z",
    dias_na_etapa: 1,
    tem_formulario: false,
    tem_ligacao: false,
    tem_briefing: false,
    proxima_sessao_em: null,
    ...parcial,
  } as JornadaKanban;
}

describe("TabelaClientes — coluna 'O que fazer'", () => {
  it("mostra o cabeçalho e o próximo passo da linha", () => {
    const { getAllByText } = montar(
      <TabelaClientes
        itens={[jornada({ etapa: "captado", nivel_pago: 0 })]}
        etapas={[]}
        fontePrazos={{ situacao: "ausente", motivo: "sem tabela de prazos neste teste" }}
        fonteCompras={{ situacao: "ausente", motivo: "sem tabela de compras neste teste" }}
        legenda="Clientes"
      />,
    );
    // A `Tabela` desenha a grade (`<th>`) E o cartão do celular (`<dt>`) no
    // mesmo DOM (`ui/Tabela.tsx`) — "O que fazer" aparece 2x de propósito.
    expect(getAllByText("O que fazer").length).toBeGreaterThan(0);
    // Teste de mesa #2 de `proximo-passo.ts`: etapa=captado, nivelPago=0
    // -> "Aguardando a compra" · CLIENTE.
    expect(getAllByText(/Aguardando a compra/).length).toBeGreaterThan(0);
  });

  it("cada linha tem o SEU passo — duas jornadas em etapas diferentes não repetem o mesmo chip", () => {
    const { getAllByText } = montar(
      <TabelaClientes
        itens={[
          jornada({ id: "j1", nome: "Cláudia Bittencourt", etapa: "captado", nivel_pago: 0 }),
          jornada({ id: "j2", nome: "Roberto Nascimento", etapa: "sessao_contratada", nivel_pago: 1, tem_ligacao: false }),
        ]}
        etapas={[]}
        fontePrazos={{ situacao: "ausente", motivo: "sem tabela de prazos neste teste" }}
        fonteCompras={{ situacao: "ausente", motivo: "sem tabela de compras neste teste" }}
        legenda="Clientes"
      />,
    );
    // Duas linhas (grade + cartão do celular renderizam junto no mesmo DOM
    // em jsdom, então cada nome aparece 2x — o que importa é que os DOIS
    // passos distintos aparecem, não um só repetido para as duas jornadas).
    expect(getAllByText(/Aguardando a compra/).length).toBeGreaterThan(0);
    expect(getAllByText(/Ligar para o cliente/).length).toBeGreaterThan(0);
  });

  it("não tem violação de acessibilidade", async () => {
    const { container } = montar(
      <TabelaClientes
        itens={[jornada({ etapa: "captado", nivel_pago: 0 })]}
        etapas={[]}
        fontePrazos={{ situacao: "ausente", motivo: "sem tabela de prazos neste teste" }}
        fonteCompras={{ situacao: "ausente", motivo: "sem tabela de compras neste teste" }}
        legenda="Clientes"
      />,
    );
    await semViolacoes(container);
  });
});
