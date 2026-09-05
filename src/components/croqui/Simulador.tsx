"use client";

import Link from "next/link";
import { memo, useCallback, useDeferredValue, useMemo, useState } from "react";
import type { BemCroqui, EntradaCroqui, ModeloCroqui, ResultadoCroqui, Tabela } from "@/types/croqui-calculo";
import { MODELOS_CROQUI, ROTULO_MODELO } from "@/types/croqui-calculo";
import { calcularCroqui, formatarCelula, podeAfirmar } from "@/server/motor-croqui";
import { useRecurso } from "@/hooks/useRecurso";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { Campo, Entrada, Selecao } from "@/components/ui/Campo";
import { Selo } from "@/components/ui/Selo";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { LinkBotao } from "@/components/painel/LinkBotao";
import { buscarCroquiCalculo } from "./apiCroquiCalculo";
import { colunasVazias, melhorEconomia, type MelhorEconomia } from "./blocosCroqui";
import { ErroAoFixar } from "./ErroAoFixar";
import { TabelaCroqui } from "./TabelaCroqui";
import { useFixarCroqui } from "./useFixarCroqui";

/**
 * Simulador ao vivo (§7). A advogada mexe no valor de mercado de um imóvel ou
 * troca o modelo com a família na tela, e o comparativo muda na hora.
 *
 * **Zero rede enquanto simula.** `calcularCroqui` é puro e roda no navegador
 * com os `parametros_snapshot` do cálculo atual (ou os vigentes, quando ainda
 * não há versão fixada). Substitui o malabarismo de hoje: navegar por 19 abas
 * de uma planilha na frente do cliente.
 *
 * Nada é gravado enquanto se simula. "Fixar como versão" faz `POST` e o
 * SERVIDOR recalcula com a ficha e os parâmetros de verdade — se o que estava
 * na tela era premissa de simulação, a tela diz que a versão gravada ficou
 * diferente, em vez de fingir que era a mesma coisa.
 */

// ---------------------------------------------------------------------------
// Edição de número: guarda texto, devolve número|null (campo vazio ≠ zero)
// ---------------------------------------------------------------------------

const paraNumero = (texto: string): number | null => {
  const limpo = texto.replace(/\./g, "").replace(",", ".").trim();
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
};

const paraTexto = (valor: number | null | undefined): string =>
  valor === null || valor === undefined ? "" : String(valor);

function NumeroCompacto({
  rotulo,
  valor,
  aoMudar,
  prefixo,
}: {
  rotulo: string;
  valor: number | null;
  aoMudar: (v: number | null) => void;
  prefixo?: string;
}) {
  return (
    <Campo rotulo={rotulo} className="min-w-0">
      <div className="relative">
        {prefixo && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-tinta-fraca"
          >
            {prefixo}
          </span>
        )}
        <Entrada
          type="text"
          inputMode="decimal"
          value={paraTexto(valor)}
          onChange={(e) => aoMudar(paraNumero(e.target.value))}
          className={prefixo ? "pl-9 text-right tabular-nums" : "text-right tabular-nums"}
        />
      </div>
    </Campo>
  );
}

// ---------------------------------------------------------------------------
// Simulador
// ---------------------------------------------------------------------------

export function Simulador({
  jornadaId,
  croquiId = null,
  voltar,
}: {
  jornadaId: string;
  croquiId?: string | null;
  voltar?: { href: string; rotulo: string };
}) {
  const buscar = useCallback(() => buscarCroquiCalculo(jornadaId), [jornadaId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [jornadaId]);

  const [entrada, setEntrada] = useState<EntradaCroqui | null>(null);

  // A entrada da ficha é a base; a simulação nasce dela e só existe em memória.
  const base = dados?.entrada ?? null;
  const entradaAtual = entrada ?? base;

  // Os parâmetros do cálculo FIXADO, quando há um: simular contra outra tabela
  // de alíquota daria um número que ninguém consegue reproduzir depois.
  const parametros = dados?.atual?.parametros_snapshot ?? dados?.parametros ?? null;

  const entradaAdiada = useDeferredValue(entradaAtual);
  // Uma passada só por tecla: cálculo + as colunas que ficaram vazias. As
  // `colunasOcultas` PRECISAM ter identidade estável, senão o `memo` de
  // `TabelaCroqui` nunca acerta e reformatamos ~250 células por caractere.
  const { resultado, ocultas } = useMemo(() => {
    if (!entradaAdiada || !parametros) {
      return { resultado: null as ResultadoCroqui | null, ocultas: {} as Record<string, string[]> };
    }
    const calculado = calcularCroqui(entradaAdiada, parametros);
    const mapa: Record<string, string[]> = {};
    for (const tabela of Object.values(calculado.tabelas)) {
      if (tabela) mapa[tabela.chave] = colunasVazias(tabela);
    }
    return { resultado: calculado, ocultas: mapa };
  }, [entradaAdiada, parametros]);

  // "Mexeu" é o que a tela precisa saber, e `editar` já sabe disso. Comparar
  // as duas entradas a cada render custaria duas serializações por tecla para
  // cobrir só o caso de digitar de volta o valor original.
  const alterado = entrada !== null;

  const editar = useCallback(
    (mudanca: (atual: EntradaCroqui) => EntradaCroqui) => {
      setEntrada((atual) => {
        const partida = atual ?? base;
        return partida ? mudanca(partida) : partida;
      });
    },
    [base],
  );

  const editarBem = useCallback(
    (id: string, mudanca: (bem: BemCroqui) => BemCroqui) => {
      // `map` preserva a identidade dos bens não tocados — é o que deixa o
      // `memo` de `BemControles` cortar os outros N-1 do re-render.
      editar((atual) => ({ ...atual, bens: atual.bens.map((b) => (b.id === id ? mudanca(b) : b)) }));
    },
    [editar],
  );

  const aoFixar = useCallback(() => {
    setEntrada(null);
    recarregar();
  }, [recarregar]);

  const { fixar, fixando, erro: erroAoFixar, divergiu } = useFixarCroqui({
    jornadaId,
    croquiId,
    resultadoNaTela: resultado,
    aoFixar,
  });

  if (carregando) return <EstadoCarregando rotulo="Carregando a simulação…" />;
  if (erro) {
    return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para abrir o simulador" />;
  }
  if (!entradaAtual || !parametros || !resultado || entradaAtual.bens.length === 0) {
    return (
      <EstadoVazio
        titulo="Sem patrimônio na ficha"
        descricao="A simulação parte dos bens do cliente."
        acao={<LinkBotao href={`/jornadas/${jornadaId}#patrimonio`}>Cadastrar bens</LinkBotao>}
      />
    );
  }

  const modeloEmFoco = entradaAtual.modelos.find((m) => m !== "inventario" && m !== "doacao") ?? null;
  const emDestaque = [
    resultado.tabelas.comparativo_geral,
    resultado.tabelas.payback,
    modeloEmFoco ? resultado.tabelas[modeloEmFoco] : undefined,
  ].filter((t): t is Tabela => Boolean(t));

  return (
    <div className="flex flex-col gap-secao">
      <div className="flex flex-wrap items-center justify-between gap-item">
        <div className="flex flex-wrap items-center gap-item">
          {voltar && (
            <Link
              href={voltar.href}
              className="inline-flex min-h-11 items-center rounded-controle text-sm text-tinta-suave underline decoration-linha-forte underline-offset-2 transition-colors duration-[var(--transicao-rapida)] hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--latao-cta)]"
            >
              ← {voltar.rotulo}
            </Link>
          )}
          <Selo tom={alterado ? "ambar" : "neutro"}>{alterado ? "Não fixado" : "Igual à ficha"}</Selo>
        </div>
        <div className="flex flex-wrap items-center gap-item">
          {alterado && (
            <Botao variante="fantasma" onClick={() => setEntrada(null)}>
              Voltar à ficha
            </Botao>
          )}
          <Botao variante="primario" onClick={fixar} carregando={fixando}>
            Fixar como versão
          </Botao>
        </div>
      </div>

      {divergiu && (
        <Cartao realce="ambar" preenchimento="compacto">
          <p role="status" className="text-sm font-medium text-[color:var(--ambar)]">
            A versão gravada saiu da ficha, não da simulação. Edite a ficha para gravar estes números.
          </p>
        </Cartao>
      )}
      {erroAoFixar != null && <ErroAoFixar erro={erroAoFixar} />}

      <Economia
        melhor={melhorEconomia(resultado.tabelas.comparativo_geral)}
        payback={resultado.tabelas.payback}
      />

      <div className="grid gap-bloco lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Controles entrada={entradaAtual} editar={editar} editarBem={editarBem} />

        <div className="flex flex-col gap-bloco">
          {emDestaque.map((t) => (
            <TabelaCroqui key={t.chave} tabela={t} nivelTitulo="h2" colunasOcultas={ocultas[t.chave]} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// O número grande — a economia do melhor modelo contra o inventário
// ---------------------------------------------------------------------------

/**
 * O argumento da sessão em uma linha: quanto a família economiza e em quanto
 * tempo o investimento se paga. A escolha do modelo é `melhorEconomia`
 * (`blocosCroqui.ts`), a MESMA que monta o slide — antes eram duas regras, e
 * um croqui em que a melhor arquitetura sai mais cara mostrava um número
 * grande negativo aqui e nada no slide, na mesma reunião.
 *
 * Frase só é montada quando o número existe (`podeAfirmar`): "a família perde
 * aproximadamente R$ 0,00" é exatamente o que o escritório já entregou uma
 * vez, e não acontece de novo aqui.
 */
function Economia({ melhor, payback }: { melhor: MelhorEconomia | null; payback?: Tabela }) {
  const linhaPayback = payback?.linhas.find((l) => l.chave === "payback_meses")?.celulas.valor;

  if (!melhor) {
    return (
      <Cartao preenchimento="compacto">
        <p className="text-sm text-tinta-suave">
          A economia não fecha com os parâmetros de hoje. O comparativo abaixo mostra o que falta.
        </p>
      </Cartao>
    );
  }

  return (
    <section
      aria-label="Economia"
      className="flex flex-wrap items-end gap-x-8 gap-y-item rounded-controle border border-linha bg-papel-elevado p-5 sm:p-6"
    >
      <p className="flex flex-col gap-1">
        <span className="text-rotulo font-medium uppercase text-tinta-fraca">Economia · {melhor.modelo}</span>
        <span className="text-[clamp(2rem,5vw,3.25rem)] font-bold leading-[1.1] tabular-nums text-tinta">
          {formatarCelula(melhor.economia)}
        </span>
      </p>
      {melhor.percentual && podeAfirmar(melhor.percentual) && (
        <p className="flex flex-col gap-1">
          <span className="text-rotulo font-medium uppercase text-tinta-fraca">Sobre o inventário</span>
          <span className="text-titulo font-bold tabular-nums text-[color:var(--verde)]">
            {formatarCelula(melhor.percentual, "percentual")}
          </span>
        </p>
      )}
      {linhaPayback && podeAfirmar(linhaPayback) && (
        <p className="flex flex-col gap-1">
          <span className="text-rotulo font-medium uppercase text-tinta-fraca">Se paga em</span>
          <span className="text-titulo font-bold tabular-nums text-tinta">
            {formatarCelula(linhaPayback, "meses")}
          </span>
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------

const DESTINACOES: Array<{ valor: NonNullable<BemCroqui["destinacao"]> | ""; rotulo: string }> = [
  { valor: "", rotulo: "Não informado" },
  { valor: "uso", rotulo: "Uso" },
  { valor: "locacao", rotulo: "Locação" },
  { valor: "venda", rotulo: "Venda" },
  { valor: "operacional", rotulo: "Operacional" },
];

const CLASSE_MARCAR =
  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-controle text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color:var(--latao-cta)]";

/**
 * Um bem por vez, memoizado: editar o valor de mercado do primeiro imóvel de
 * uma família com 30 bens não pode re-renderizar os outros 29 blocos de
 * campos controlados. `editarBem` preserva a identidade dos não tocados.
 */
const BemControles = memo(function BemControles({
  bem,
  editarBem,
}: {
  bem: BemCroqui;
  editarBem: (id: string, m: (bem: BemCroqui) => BemCroqui) => void;
}) {
  return (
    <div className="flex flex-col gap-item border-b border-linha pb-4 last:border-b-0 last:pb-0">
      <p className="text-sm font-bold text-tinta">{bem.descricao}</p>
      <div className="grid gap-item sm:grid-cols-2">
        <NumeroCompacto
          rotulo="Custo (DIRPF)"
          prefixo="R$"
          valor={bem.valor_dirpf}
          aoMudar={(v) => editarBem(bem.id, (b) => ({ ...b, valor_dirpf: v }))}
        />
        <NumeroCompacto
          rotulo="Mercado"
          prefixo="R$"
          valor={bem.valor_mercado}
          aoMudar={(v) => editarBem(bem.id, (b) => ({ ...b, valor_mercado: v }))}
        />
        <Campo rotulo="Destinação">
          <Selecao
            value={bem.destinacao ?? ""}
            onChange={(e) =>
              editarBem(bem.id, (b) => ({
                ...b,
                destinacao: (e.target.value || null) as BemCroqui["destinacao"],
              }))
            }
          >
            {DESTINACOES.map((d) => (
              <option key={d.valor} value={d.valor}>
                {d.rotulo}
              </option>
            ))}
          </Selecao>
        </Campo>
        <NumeroCompacto
          rotulo="Aluguel mensal"
          prefixo="R$"
          valor={bem.valor_locacao_mensal}
          aoMudar={(v) => editarBem(bem.id, (b) => ({ ...b, valor_locacao_mensal: v }))}
        />
      </div>
      <label className={`${CLASSE_MARCAR} text-tinta-suave`}>
        <input
          type="checkbox"
          className="h-4 w-4 accent-[color:var(--latao-cta)]"
          checked={Boolean(bem.vender_para_levantar)}
          onChange={(e) => editarBem(bem.id, (b) => ({ ...b, vender_para_levantar: e.target.checked }))}
        />
        Vender para pagar o inventário
      </label>
    </div>
  );
});

function Controles({
  entrada,
  editar,
  editarBem,
}: {
  entrada: EntradaCroqui;
  editar: (m: (atual: EntradaCroqui) => EntradaCroqui) => void;
  editarBem: (id: string, m: (bem: BemCroqui) => BemCroqui) => void;
}) {
  return (
    <div className="flex flex-col gap-bloco">
      <fieldset className="flex flex-col gap-item rounded-controle border border-linha bg-papel-elevado p-4">
        <legend className="px-1 text-rotulo font-medium uppercase text-tinta-fraca">Arquiteturas</legend>
        <div className="flex flex-wrap gap-item">
          {MODELOS_CROQUI.map((modelo) => {
            const marcado = entrada.modelos.includes(modelo);
            return (
              <label key={modelo} className={`${CLASSE_MARCAR} border border-linha-controle px-3 text-tinta`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[color:var(--latao-cta)]"
                  checked={marcado}
                  onChange={() =>
                    editar((atual) => ({
                      ...atual,
                      modelos: marcado
                        ? atual.modelos.filter((m) => m !== modelo)
                        : ([...atual.modelos, modelo] as ModeloCroqui[]),
                    }))
                  }
                />
                {ROTULO_MODELO[modelo]}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="grid gap-item rounded-controle border border-linha bg-papel-elevado p-4 sm:grid-cols-2">
        <legend className="px-1 text-rotulo font-medium uppercase text-tinta-fraca">Jurisdição e família</legend>
        <Campo rotulo="UF">
          <Entrada
            type="text"
            maxLength={2}
            value={entrada.uf ?? ""}
            onChange={(e) => editar((a) => ({ ...a, uf: e.target.value.toUpperCase() || null }))}
            className="uppercase"
          />
        </Campo>
        <Campo rotulo="UF vantajosa">
          <Entrada
            type="text"
            maxLength={2}
            value={entrada.uf_domicilio_vantajoso ?? ""}
            onChange={(e) =>
              editar((a) => ({ ...a, uf_domicilio_vantajoso: e.target.value.toUpperCase() || null }))
            }
            className="uppercase"
          />
        </Campo>
        <NumeroCompacto
          rotulo="Filhos"
          valor={entrada.familia.filhos}
          aoMudar={(v) => editar((a) => ({ ...a, familia: { ...a.familia, filhos: v } }))}
        />
        <NumeroCompacto
          rotulo="Netos"
          valor={entrada.familia.netos}
          aoMudar={(v) => editar((a) => ({ ...a, familia: { ...a.familia, netos: v } }))}
        />
        <NumeroCompacto
          rotulo="Núcleos"
          valor={entrada.familia.nucleos}
          aoMudar={(v) => editar((a) => ({ ...a, familia: { ...a.familia, nucleos: v } }))}
        />
        <NumeroCompacto
          rotulo="CDI ao ano"
          prefixo="%"
          valor={entrada.cdi_anual ?? null}
          aoMudar={(v) => editar((a) => ({ ...a, cdi_anual: v }))}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-item rounded-controle border border-linha bg-papel-elevado p-4">
        <legend className="px-1 text-rotulo font-medium uppercase text-tinta-fraca">
          {entrada.bens.length} {entrada.bens.length === 1 ? "bem" : "bens"}
        </legend>
        {entrada.bens.map((bem) => (
          <BemControles key={bem.id} bem={bem} editarBem={editarBem} />
        ))}
      </fieldset>
    </div>
  );
}
