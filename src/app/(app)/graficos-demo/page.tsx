"use client";

import { useState } from "react";
import { SeloDemonstracao } from "@/components/ui/Selo";
import {
  ArvoreFamiliar,
  BarrasCenarios,
  BarrasComparativas,
  BarrasComposicao,
  DiagramaCelulas,
  LinhaDoTempo,
  MatrizCriterios,
  QuadroSocietario,
  TabelaPatrimonial,
  type TemaGrafico,
} from "@/components/graficos";

/**
 * Galeria de demonstração da biblioteca de gráficos do Croqui (Fase 3, §3.5).
 * TODO DADO AQUI É FICTÍCIO — "Família Exemplo" não corresponde a nenhum
 * cliente real (ver `SeloDemonstracao`, já usado no resto do sistema para
 * marcar exatamente este tipo de conteúdo).
 *
 * Rota exclusiva do agente C (frontend-graficos) — não colide com nenhuma
 * outra tela da Fase 3.
 */
export default function PaginaGraficosDemo() {
  const [tema, setTema] = useState<TemaGrafico>("claro");
  const [modoApresentacao, setModoApresentacao] = useState(false);

  const fundoPreview = tema === "escuro" ? "#0f1012" : "transparent";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-16">
      <header className="flex flex-col gap-3">
        <h1 className="font-serif text-2xl font-bold text-tinta">Galeria de gráficos do Croqui</h1>
        <p className="max-w-2xl text-sm text-tinta-suave">
          Cada peça abaixo é um componente puro de <code className="font-mono text-xs">src/components/graficos/</code>, SVG inline, sem
          dependência nova. Os controles trocam o <code className="font-mono text-xs">tema</code> e o{" "}
          <code className="font-mono text-xs">modoApresentacao</code> recebidos por prop — não há CSS resolvendo isso sozinho (§3.5 do
          plano de arquitetura).
        </p>

        <div className="nao-imprimir flex flex-wrap items-center gap-4 rounded-sm border border-linha bg-papel-elevado px-4 py-3">
          <fieldset className="flex items-center gap-2">
            <legend className="sr-only">Tema do gráfico</legend>
            <span className="text-xs font-medium uppercase tracking-wide text-tinta-fraca">Tema</span>
            {(["claro", "escuro"] as const).map((valor) => (
              <label key={valor} className="inline-flex items-center gap-1.5 text-sm text-tinta">
                <input type="radio" name="tema" value={valor} checked={tema === valor} onChange={() => setTema(valor)} />
                {valor === "claro" ? "Claro (Ficha 360 / impressão)" : "Escuro (Modo Apresentação)"}
              </label>
            ))}
          </fieldset>

          <label className="inline-flex items-center gap-1.5 text-sm text-tinta">
            <input type="checkbox" checked={modoApresentacao} onChange={(e) => setModoApresentacao(e.target.checked)} />
            Simular Modo Apresentação (esconde gráfico indisponível)
          </label>
        </div>
      </header>

      <SeloDemonstracao />

      <div className="flex flex-col gap-6 rounded-sm p-1 transition-colors" style={{ background: fundoPreview }}>
        <Cartao numero={1} slide="Slide 4 · Patrimônio" nome="BarrasComposicao">
          <BarrasComposicao
            tema={tema}
            modoApresentacao={modoApresentacao}
            itens={[
              { tipo: "empresa", valor_mercado: 5_800_000 },
              { tipo: "imovel", valor_mercado: 3_200_000 },
              { tipo: "investimento", valor_mercado: 1_150_000 },
              { tipo: "previdencia", valor_historico: 420_000 },
              { tipo: "veiculo", valor_mercado: 180_000 },
            ]}
          />
        </Cartao>

        <Cartao numero="1b" slide="Slide 4 · Patrimônio (estado vazio)" nome="BarrasComposicao — sem dado">
          <BarrasComposicao tema={tema} modoApresentacao={modoApresentacao} itens={[]} />
        </Cartao>

        <Cartao numero={2} slide="Slide 11 · Economia" nome="BarrasComparativas">
          <BarrasComparativas tema={tema} modoApresentacao={modoApresentacao} custoInventario={520_000} custoEstrutura={98_000} />
        </Cartao>

        <Cartao numero="2b" slide="Slide 11 · Economia (custo da estrutura ainda não digitado)" nome="BarrasComparativas — sem dado">
          <BarrasComparativas tema={tema} modoApresentacao={modoApresentacao} custoInventario={520_000} custoEstrutura={null} />
        </Cartao>

        <Cartao numero={3} slide="Slide 3 · Família" nome="ArvoreFamiliar">
          <ArvoreFamiliar
            tema={tema}
            modoApresentacao={modoApresentacao}
            instituidores={[
              { id: "inst-1", nome: "Antônio Ferraz", papel: "instituidor", idade: 71 },
              { id: "inst-2", nome: "Marlene Ferraz", papel: "instituidor", idade: 68 },
            ]}
            nucleos={[
              {
                id: "nucleo-carla",
                rotulo: "Núcleo de Carla",
                pessoas: [
                  { id: "carla", nome: "Carla Ferraz", papel: "conjuge", idade: 44, regimeCasamento: "Comunhão parcial" },
                  { id: "bruno", nome: "Bruno Ferraz", papel: "filho", idade: 16, dependenteFinanceiro: true },
                ],
              },
              {
                id: "nucleo-diego",
                rotulo: "Núcleo de Diego",
                pessoas: [{ id: "diego", nome: "Diego Ferraz", papel: "filho", idade: 39 }],
              },
              {
                id: "nucleo-fernanda",
                rotulo: "Núcleo de Fernanda",
                pessoas: [
                  { id: "fernanda", nome: "Fernanda Ferraz", papel: "filho", idade: 36 },
                  { id: "lara", nome: "Lara", papel: "neto", idade: 8 },
                ],
              },
            ]}
          />
        </Cartao>

        <Cartao numero={4} slide="Slides 7-10 · Arquitetura de células" nome="DiagramaCelulas">
          <DiagramaCelulas
            tema={tema}
            modoApresentacao={modoApresentacao}
            arquitetura={3}
            celulas={[
              {
                tipo: "cofre",
                itens: [
                  { descricao: "3 imóveis de renda (SP capital)", categoria: "dado_documental" },
                  { descricao: "Sede própria da operação", categoria: "dado_documental" },
                ],
              },
              {
                tipo: "veiculo",
                destaqueInstituidor: "Antônio Ferraz",
                itens: [
                  { descricao: "Holding administradora — 100% Ferraz Participações", categoria: "fato_declarado" },
                  { descricao: "Antônio mantém a gestão vitalícia", categoria: "inferencia" },
                ],
              },
              {
                tipo: "destino",
                itens: [
                  { descricao: "Nua-propriedade dividida entre 3 núcleos", categoria: "ponto_a_validar" },
                  { descricao: "Usufruto vitalício dos instituidores", categoria: "fato_declarado" },
                ],
              },
            ]}
          />
        </Cartao>

        <Cartao numero={5} slide="Slide 6 · Alternativas" nome="MatrizCriterios">
          <MatrizCriterios
            tema={tema}
            modoApresentacao={modoApresentacao}
            recomendacao={3}
            criterios={[
              { id: "nucleos", criterio: "Existem múltiplos núcleos familiares?", celula1: { nivel: "nao_atende" }, celula2: { nivel: "atende_parcial" }, celula3: { nivel: "atende", nota: "3 núcleos com interesses distintos" } },
              { id: "empresa", criterio: "Há empresa operacional relevante?", celula1: { nivel: "nao_atende" }, celula2: { nivel: "atende_parcial" }, celula3: { nivel: "atende" } },
              { id: "imoveis-renda", criterio: "Há imóveis de renda?", celula1: { nivel: "atende_parcial" }, celula2: { nivel: "atende" }, celula3: { nivel: "atende" } },
              { id: "patrimonio-pessoal", criterio: "Há patrimônio pessoal relevante fora da empresa?", celula1: { nivel: "nao_atende" }, celula2: { nivel: "atende_parcial" }, celula3: { nivel: "atende" } },
              { id: "concentracao", criterio: "Há concentração excessiva em uma única empresa?", celula1: { nivel: "nao_atende" }, celula2: { nivel: "atende_parcial" }, celula3: { nivel: "atende" } },
              { id: "niveis-participacao", criterio: "Os herdeiros têm níveis diferentes de participação?", celula1: { nivel: "nao_atende" }, celula2: { nivel: "nao_atende" }, celula3: { nivel: "atende" } },
              { id: "controle", criterio: "O fundador deseja permanecer no controle?", celula1: { nivel: "atende" }, celula2: { nivel: "atende" }, celula3: { nivel: "atende", nota: "veículo isola o controle" } },
              { id: "separar-funcoes", criterio: "É preciso separar patrimônio, gestão e destino?", celula1: { nivel: "nao_atende" }, celula2: { nivel: "atende_parcial" }, celula3: { nivel: "atende" } },
              { id: "beneficio-complexidade", criterio: "O benefício justifica a complexidade extra?", celula1: { nivel: "nao_se_aplica" }, celula2: { nivel: "atende_parcial" }, celula3: { nivel: "atende", nota: "3 núcleos + empresa operacional justificam" } },
            ]}
          />
        </Cartao>

        <Cartao numero={6} slide="Jornada da família" nome="LinhaDoTempo">
          <LinhaDoTempo
            tema={tema}
            modoApresentacao={modoApresentacao}
            eventos={[
              { id: "e1", titulo: "Seminário Holding em 1 Dia", ocorridoEm: "2026-05-14", descricao: "Antônio e Marlene compareceram presencialmente" },
              { id: "e2", titulo: "Ligação de qualificação (5 min)", ocorridoEm: "2026-05-22" },
              { id: "e3", titulo: "Sessão de Viabilidade", ocorridoEm: "2026-06-10", descricao: "Diagnóstico com os 3 núcleos representados" },
              { id: "e4", titulo: "Análise da Sessão gerada", ocorridoEm: "2026-06-12" },
              { id: "e5", titulo: "Apresentação do Croqui", ocorridoEm: "2026-07-02" },
            ]}
          />
        </Cartao>

        <Cartao numero={7} slide="Slides 2 e 4 · Mapa societário" nome="QuadroSocietario">
          <QuadroSocietario
            tema={tema}
            modoApresentacao={modoApresentacao}
            razaoSocial="Ferraz Participações Ltda"
            cnpj="12345678000199"
            situacao="Ativa"
            capitalSocial={1_000_000}
            consultadoEm="2026-08-20"
            socios={[
              { nome: "Antônio Ferraz", qualificacao: "Sócio-Administrador", percentual: 60, dataEntrada: "2010-03-01" },
              { nome: "Marlene Ferraz", qualificacao: "Sócia", percentual: 40, dataEntrada: "2010-03-01" },
            ]}
          />
        </Cartao>

        <Cartao numero="7b" slide="Mapa societário (percentual não informado pela fonte pública)" nome="QuadroSocietario — sem percentual">
          <QuadroSocietario
            tema={tema}
            modoApresentacao={modoApresentacao}
            razaoSocial="Ferraz Operações Ltda"
            cnpj="98765432000188"
            situacao="Ativa"
            socios={[
              { nome: "Antônio Ferraz", qualificacao: "Sócio-Administrador" },
              { nome: "Diego Ferraz", qualificacao: "Sócio" },
            ]}
          />
        </Cartao>

        <Cartao numero="7c" slide="Mapa societário (CNPJ ainda não consultado)" nome="QuadroSocietario — sem dado">
          <QuadroSocietario tema={tema} modoApresentacao={modoApresentacao} socios={[]} />
        </Cartao>

        <Cartao numero={8} slide="Diagnóstico da SV (plano Fase C, não plugado ainda)" nome="TabelaPatrimonial">
          <TabelaPatrimonial
            tema={tema}
            modoApresentacao={modoApresentacao}
            itens={[
              { descricao: "Apartamento — Jardins, SP", tipo: "imovel", custoOrigemPF: 620_000, valorMercado: 1_850_000, rendimentoMensal: 6_800, tributacao: "IPTU + IR sobre aluguel" },
              { descricao: "Ferraz Participações Ltda — 60%", tipo: "empresa", custoOrigemPF: 400_000, valorMercado: 3_480_000, rendimentoMensal: null, tributacao: "IRPJ/CSLL na empresa" },
              { descricao: "Carteira de ações (B3)", tipo: "investimento", custoOrigemPF: 210_000, valorMercado: null, rendimentoMensal: 1_150, tributacao: null },
              { descricao: "Sítio — Atibaia", tipo: "imovel", custoOrigemPF: null, valorMercado: 980_000, rendimentoMensal: null, tributacao: "IPTU rural" },
            ]}
          />
        </Cartao>

        <Cartao numero="8b" slide="Diagnóstico da SV (nenhum bem cadastrado)" nome="TabelaPatrimonial — sem dado">
          <TabelaPatrimonial tema={tema} modoApresentacao={modoApresentacao} itens={[]} />
        </Cartao>

        <Cartao numero={9} slide="Cenário Patrimonial (plano Fase C — motor Fase B ainda bloqueado)" nome="BarrasCenarios">
          <BarrasCenarios
            tema={tema}
            modoApresentacao={modoApresentacao}
            cenarios={[
              { nome: "Inventário", custoTotal: 520_000, diferencaPercentual: null, ehReferencia: true },
              { nome: "Doação", custoTotal: 210_000, diferencaPercentual: -0.596 },
              { nome: "1 Célula", custoTotal: 138_000, diferencaPercentual: -0.735 },
              { nome: "2 Células", custoTotal: null, diferencaPercentual: null },
              { nome: "3 Células", custoTotal: null, diferencaPercentual: null },
            ]}
          />
        </Cartao>

        <Cartao numero="9b" slide="Cenário Patrimonial (nenhum cenário informado)" nome="BarrasCenarios — sem dado">
          <BarrasCenarios tema={tema} modoApresentacao={modoApresentacao} cenarios={[]} />
        </Cartao>
      </div>
    </div>
  );
}

function Cartao({ numero, slide, nome, children }: { numero: number | string; slide: string; nome: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <p className="nao-imprimir text-xs font-medium uppercase tracking-wide text-tinta-fraca">
        {numero} · {slide} — <code className="font-mono normal-case">{nome}</code>
      </p>
      {children}
    </section>
  );
}
