"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { formatarMoeda } from "@/lib/formatar";
import { CHAVE_PARAMETRO, ROTULO_CENARIO, type CenarioRubrica, type ParametroMetodo, type ProcedenciaValor, type TipoCenario } from "@/types/cenario";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada, Opcao, Selecao } from "@/components/ui/Campo";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro } from "@/components/ui/Estado";
import { Gaveta } from "@/components/ui/Gaveta";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { ErroFicha360Api } from "./api";
import { buscarCenario, buscarParametrosVigentes, gravarRubricaCenario, ROTULO_ERRO_CENARIO, rotularParametro } from "./api-cenario";

const ROTULO_RUBRICA: Record<string, string> = {
  itcmd: "ITCMD",
  itbi: "ITBI",
  custas_cartorio: "Custas de cartório",
  honorarios_advocaticios: "Honorários advocatícios",
  honorarios_croqui: "Honorários do Croqui",
  honorarios_holding: "Honorários da holding",
  manutencao_anual: "Manutenção anual",
};

function rotularRubrica(chave: string): string {
  return ROTULO_RUBRICA[chave] ?? chave.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Rubrica de imposto → chave do parâmetro percentual que pode multiplicar a base (B26). Outras rubricas: só digitado. */
function chaveParametroDaRubrica(rubrica: string): string | null {
  if (rubrica === "itcmd") return CHAVE_PARAMETRO.itcmdAliquota;
  if (rubrica === "itbi") return CHAVE_PARAMETRO.itbiAliquota;
  return null;
}

/* Procedência: glifo + texto sempre (nunca só cor). */
const PROCEDENCIA: Record<ProcedenciaValor, { rotulo: string; tom: "verde" | "azul" | "neutro"; glifo: string }> = {
  digitado: { rotulo: "digitado", tom: "azul", glifo: "✎" },
  calculado: { rotulo: "calculado", tom: "verde", glifo: "∑" },
  ausente: { rotulo: "ausente", tom: "neutro", glifo: "—" },
};

interface Celula {
  cenario: TipoCenario;
  rubrica: string;
}

/**
 * Gaveta "Cenário Patrimonial" (Fase 4 §4.3, B26): grade rubrica × cenário
 * com procedência por célula. O sistema NÃO calcula imposto sozinho —
 * `calculado` só quando a advogada informa a base e escolhe uma alíquota
 * cadastrada com base legal (Admin → Parâmetros); o banco multiplica e
 * carimba a versão do parâmetro. Total por cenário só aparece quando
 * nenhuma rubrica está ausente — "total incompleto" nunca vira zero.
 */
export function CenarioPatrimonialGaveta({
  jornadaId,
  aberta,
  aoFechar,
  nomeCliente,
  uf,
  aoAtualizar,
}: {
  jornadaId: string;
  aberta: boolean;
  aoFechar: () => void;
  nomeCliente: string;
  uf?: string | null;
  aoAtualizar?: () => void;
}) {
  return (
    <Gaveta aberta={aberta} aoFechar={aoFechar} rotulo={nomeCliente} titulo="Cenário Patrimonial" descricao="Custo de cada caminho — inventário, doação, holding — rubrica por rubrica, com a origem de cada número." largura="larga">
      {aberta && <ConteudoCenario jornadaId={jornadaId} uf={uf ?? null} aoAtualizar={aoAtualizar} />}
    </Gaveta>
  );
}

function ConteudoCenario({ jornadaId, uf, aoAtualizar }: { jornadaId: string; uf: string | null; aoAtualizar?: () => void }) {
  const { notificar } = useToast();
  const buscar = useCallback(() => buscarCenario(jornadaId), [jornadaId]);
  const { dados, carregando, erro, recarregar, setDados } = useRecurso(buscar, [jornadaId]);
  const [selecionada, setSelecionada] = useState<Celula | null>(null);
  const [rubricasLivres, setRubricasLivres] = useState<string[]>([]);
  const [novaRubrica, setNovaRubrica] = useState("");
  const [cenarioMovel, setCenarioMovel] = useState<TipoCenario>("inventario");

  if (erro) {
    const indisponivel = erro instanceof ErroFicha360Api && (erro.status === 500 || erro.status === 503 || erro.status === 404);
    if (indisponivel) return <SeloStub texto="Cenário Patrimonial ainda não disponível — as tabelas do cenário (migração 0057) não foram aplicadas neste ambiente." />;
    return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar o cenário" />;
  }
  if (carregando || !dados) return <EsqueletoLista linhas={7} rotulo="Carregando o cenário…" />;

  const tipos = dados.tipos.length > 0 ? dados.tipos : (Object.keys(ROTULO_CENARIO) as TipoCenario[]);
  const rubricasExistentes = dados.rubricas.map((r) => r.rubrica);
  const rubricas = Array.from(new Set([...dados.rubricas_padrao, ...rubricasExistentes, ...rubricasLivres]));
  const celulaPor = new Map<string, CenarioRubrica>();
  for (const r of dados.rubricas) {
    const tipo = dados.cenarios.find((c) => c.id === r.cenario_id)?.cenario;
    if (tipo) celulaPor.set(`${tipo}|${r.rubrica}`, r);
  }
  const totalPor = new Map(dados.totais.map((t) => [t.cenario, t] as const));

  function lerCelula(cenario: TipoCenario, rubrica: string): CenarioRubrica | null {
    return celulaPor.get(`${cenario}|${rubrica}`) ?? null;
  }

  function aplicarGravacao(res: Awaited<ReturnType<typeof gravarRubricaCenario>>) {
    if (!dados) return;
    const cenarios = dados.cenarios.some((c) => c.id === res.cenario.id) ? dados.cenarios : [...dados.cenarios, res.cenario];
    const rubricasNovas = dados.rubricas.filter((r) => r.id !== res.rubrica.id).concat(res.rubrica);
    const totais = res.totais ? dados.totais.filter((t) => t.cenario_id !== res.totais!.cenario_id).concat(res.totais) : dados.totais;
    setDados({ ...dados, cenarios, rubricas: rubricasNovas, totais });
    aoAtualizar?.();
  }

  function adicionarRubrica() {
    const chave = novaRubrica
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    if (!chave) return;
    if (rubricas.includes(chave)) {
      notificar({ tom: "aviso", titulo: "Essa rubrica já está na grade" });
      return;
    }
    setRubricasLivres((atual) => [...atual, chave]);
    setNovaRubrica("");
    notificar({ tom: "info", titulo: `Rubrica “${rotularRubrica(chave)}” adicionada`, descricao: "Ela é gravada quando você preencher a primeira célula." });
  }

  const rubricasComRotulo = rubricas.map((r) => ({ chave: r, rotulo: rotularRubrica(r) }));
  // Quem trava o total é a view (`vw_cenarios_totais`, 0060): `total` nulo
  // enquanto qualquer rubrica da config não existir ou estiver `ausente`, e
  // `rubricas_faltantes` diz quais. Sem a 0060 (`rubricas_faltantes`
  // undefined) cai na régua local — mesma conta, feita aqui.
  const totaisRotulados = tipos.map((tipo) => {
    const t = totalPor.get(tipo);
    const faltantes =
      t?.rubricas_faltantes ?? rubricas.filter((r) => (lerCelula(tipo, r)?.procedencia ?? "ausente") === "ausente");
    if (!t || faltantes.length > 0 || t.total === null) {
      const n = t ? faltantes.length : rubricas.length;
      return { tipo, texto: `incompleto · ${n === 1 ? "falta 1" : `faltam ${n}`}`, completo: false };
    }
    return { tipo, texto: formatarMoeda(t.total), completo: true };
  });

  // Função de render (não componente): recriar um componente a cada render
  // remontaria as células e perderia o foco do teclado.
  function celula(tipo: TipoCenario, rubrica: string) {
    const c = lerCelula(tipo, rubrica);
    const proc = c?.procedencia ?? "ausente";
    const ativa = selecionada?.cenario === tipo && selecionada.rubrica === rubrica;
    const parametro = c?.parametro_id ? dados!.parametros[c.parametro_id] : null;
    return (
      <button
        type="button"
        onClick={() => setSelecionada({ cenario: tipo, rubrica })}
        aria-pressed={ativa}
        aria-label={`${rotularRubrica(rubrica)} em ${ROTULO_CENARIO[tipo]}: ${c?.valor != null ? formatarMoeda(c.valor) : "sem valor"}, ${PROCEDENCIA[proc].rotulo}`}
        className={`flex min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-controle border px-2.5 py-1.5 text-left transition-[border-color,box-shadow] duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] ${
          ativa ? "border-[color:var(--latao)] bg-latao-fraco shadow-foco" : "border-linha bg-papel-elevado"
        }`}
      >
        <span className={`text-sm font-medium tabular-nums ${c?.valor != null ? "text-tinta" : "text-tinta-fraca"}`}>{c?.valor != null ? formatarMoeda(c.valor) : "—"}</span>
        <span className="text-legenda text-tinta-suave">
          <span aria-hidden="true">{PROCEDENCIA[proc].glifo} </span>
          {PROCEDENCIA[proc].rotulo}
          {proc === "calculado" && parametro ? ` · ${parametro.valor}% v${parametro.versao}` : ""}
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-tinta-suave">
        <span className="font-medium text-tinta">Legenda:</span>
        {(Object.keys(PROCEDENCIA) as ProcedenciaValor[]).map((p) => (
          <Selo key={p} tom={PROCEDENCIA[p].tom}>
            <span aria-hidden="true">{PROCEDENCIA[p].glifo} </span>
            {PROCEDENCIA[p].rotulo}
          </Selo>
        ))}
        <span>· o sistema não calcula imposto sozinho: “calculado” = base informada × alíquota cadastrada com base legal.</span>
      </div>

      {/* Desktop: grade completa. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[640px] border-separate border-spacing-1">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 bg-papel-elevado px-2 py-2 text-left text-rotulo font-medium uppercase text-tinta-fraca">
                Rubrica
              </th>
              {tipos.map((tipo) => (
                <th key={tipo} scope="col" className="px-2 py-2 text-left text-rotulo font-medium uppercase text-tinta-fraca">
                  {ROTULO_CENARIO[tipo]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rubricasComRotulo.map((r) => (
              <tr key={r.chave}>
                <th scope="row" className="sticky left-0 bg-papel-elevado px-2 py-1 text-left text-sm font-medium text-tinta">
                  {r.rotulo}
                </th>
                {tipos.map((tipo) => (
                  <td key={tipo} className="p-0 align-top">
                    {celula(tipo, r.chave)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="sticky left-0 bg-papel-elevado px-2 py-2 text-left text-sm font-bold text-tinta">
                Total
              </th>
              {totaisRotulados.map((t) => (
                <td key={t.tipo} className={`px-2.5 py-2 text-sm ${t.completo ? "font-bold tabular-nums text-tinta" : "text-tinta-suave"}`}>
                  {t.texto}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Celular: um cenário por vez. */}
      <div className="flex flex-col gap-3 sm:hidden">
        <Campo rotulo="Cenário">
          <Selecao value={cenarioMovel} onChange={(e) => setCenarioMovel(e.target.value as TipoCenario)}>
            {tipos.map((tipo) => (
              <option key={tipo} value={tipo}>
                {ROTULO_CENARIO[tipo]}
              </option>
            ))}
          </Selecao>
        </Campo>
        <ul className="flex flex-col gap-2">
          {rubricasComRotulo.map((r) => (
            <li key={r.chave} className="flex flex-col gap-1">
              <span className="text-sm font-medium text-tinta">{r.rotulo}</span>
              {celula(cenarioMovel, r.chave)}
            </li>
          ))}
        </ul>
        <p className="text-sm text-tinta">
          <span className="font-bold">Total: </span>
          {totaisRotulados.find((t) => t.tipo === cenarioMovel)?.texto}
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          adicionarRubrica();
        }}
      >
        <Campo rotulo="Rubrica livre" ajuda="Ex.: “seguro de vida”, “avaliação de imóveis”." className="min-w-56 flex-1">
          <Entrada value={novaRubrica} onChange={(e) => setNovaRubrica(e.target.value)} maxLength={60} />
        </Campo>
        <Botao type="submit" variante="secundario" disabled={!novaRubrica.trim()}>
          Adicionar rubrica
        </Botao>
      </form>

      {selecionada && (
        <EditorCelula
          key={`${selecionada.cenario}|${selecionada.rubrica}`}
          jornadaId={jornadaId}
          celula={selecionada}
          atual={lerCelula(selecionada.cenario, selecionada.rubrica)}
          parametroCarimbado={(() => {
            const c = lerCelula(selecionada.cenario, selecionada.rubrica);
            return c?.parametro_id ? (dados.parametros[c.parametro_id] ?? null) : null;
          })()}
          uf={uf}
          aoGravar={aplicarGravacao}
          aoFechar={() => setSelecionada(null)}
        />
      )}
    </div>
  );
}

type Modo = "digitado" | "calculado" | "ausente";

function EditorCelula({
  jornadaId,
  celula,
  atual,
  parametroCarimbado,
  uf,
  aoGravar,
  aoFechar,
}: {
  jornadaId: string;
  celula: Celula;
  atual: CenarioRubrica | null;
  parametroCarimbado: ParametroMetodo | null;
  uf: string | null;
  aoGravar: (res: Awaited<ReturnType<typeof gravarRubricaCenario>>) => void;
  aoFechar: () => void;
}) {
  const { notificar } = useToast();
  const chaveParametro = chaveParametroDaRubrica(celula.rubrica);
  const [modo, setModo] = useState<Modo>(atual?.procedencia ?? (chaveParametro ? "calculado" : "digitado"));
  const [valor, setValor] = useState(atual?.valor != null ? String(atual.valor) : "");
  const [base, setBase] = useState(atual?.base_calculo != null ? String(atual.base_calculo) : "");
  const [nota, setNota] = useState(atual?.nota ?? "");
  const [parametroId, setParametroId] = useState<string>(atual?.parametro_id ?? "");
  // `undefined` = buscando; `null` = nenhum vigente. Rubrica sem parâmetro possível nasce `null` (sem efeito).
  const [parametroVigente, setParametroVigente] = useState<ParametroMetodo | null | undefined>(chaveParametro ? undefined : null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!chaveParametro) return;
    let vivo = true;
    buscarParametrosVigentes([chaveParametro], uf)
      .then((r) => {
        if (!vivo) return;
        const p = r.parametros[chaveParametro] ?? null;
        setParametroVigente(p);
        setParametroId((atual) => atual || p?.id || "");
      })
      .catch(() => {
        if (vivo) setParametroVigente(null);
      });
    return () => {
      vivo = false;
    };
  }, [chaveParametro, uf]);

  const opcoesParametro = useMemo(() => {
    const lista: ParametroMetodo[] = [];
    if (parametroVigente) lista.push(parametroVigente);
    if (parametroCarimbado && !lista.some((p) => p.id === parametroCarimbado.id)) lista.push(parametroCarimbado);
    return lista;
  }, [parametroVigente, parametroCarimbado]);

  const baseNumero = Number(base.replace(/\./g, "").replace(",", "."));
  const parametroEscolhido = opcoesParametro.find((p) => p.id === parametroId) ?? null;
  const previa = modo === "calculado" && parametroEscolhido && Number.isFinite(baseNumero) && base.trim() ? Math.round(baseNumero * parametroEscolhido.valor) / 100 : null;

  function lerNumero(texto: string): number | null {
    const n = Number(texto.replace(/\./g, "").replace(",", "."));
    return texto.trim() && Number.isFinite(n) && n >= 0 ? n : null;
  }

  async function salvar() {
    setErro(null);
    const corpo: Parameters<typeof gravarRubricaCenario>[1] = { cenario: celula.cenario, rubrica: celula.rubrica, procedencia: modo, nota: nota.trim() || null };
    if (modo === "digitado") {
      const n = lerNumero(valor);
      if (n === null) {
        setErro("Digite o valor em reais (só números; use vírgula para centavos).");
        return;
      }
      corpo.valor = n;
    } else if (modo === "calculado") {
      const n = lerNumero(base);
      if (n === null) {
        setErro("Informe a base de cálculo em reais.");
        return;
      }
      if (!parametroId) {
        setErro(ROTULO_ERRO_CENARIO.parametro_ausente);
        return;
      }
      corpo.base_calculo = n;
      corpo.parametro_id = parametroId;
    }
    setSalvando(true);
    try {
      const res = await gravarRubricaCenario(jornadaId, corpo);
      aoGravar(res);
      notificar({
        tom: "sucesso",
        titulo: modo === "ausente" ? "Rubrica zerada (ausente)" : `${rotularRubrica(celula.rubrica)} salvo em ${ROTULO_CENARIO[celula.cenario]}`,
        descricao: res.rubrica.valor != null ? `${formatarMoeda(res.rubrica.valor)} · ${PROCEDENCIA[res.rubrica.procedencia].rotulo}` : undefined,
      });
      aoFechar();
    } catch (e) {
      const erroApi = e instanceof ErroFicha360Api ? e : null;
      const humano = erroApi?.codigo ? ROTULO_ERRO_CENARIO[erroApi.codigo] : undefined;
      setErro(humano ?? erroApi?.message ?? "Não foi possível salvar. Confira a internet e tente de novo.");
      notificar({ tom: "erro", titulo: "Não foi possível salvar a célula", descricao: humano ?? erroApi?.message ?? "Tente de novo." });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-cartao border border-linha-forte bg-papel p-4 sm:p-5"
      noValidate
      aria-labelledby="editor-celula-titulo"
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-rotulo font-medium uppercase text-tinta-fraca">{ROTULO_CENARIO[celula.cenario]}</p>
          <h3 id="editor-celula-titulo" className="text-subtitulo font-bold text-tinta">
            {rotularRubrica(celula.rubrica)}
          </h3>
        </div>
        {atual && (
          <Selo tom={PROCEDENCIA[atual.procedencia].tom}>
            hoje: {atual.valor != null ? formatarMoeda(atual.valor) : "—"} · {PROCEDENCIA[atual.procedencia].rotulo}
          </Selo>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold text-tinta">Como este número entra</legend>
        <Opcao tipo="radio" name="modo" checked={modo === "digitado"} onChange={() => setModo("digitado")} rotulo="Digitar o valor" descricao="Você informa o número final, em reais." />
        {chaveParametro && (
          <Opcao tipo="radio" name="modo" checked={modo === "calculado"} onChange={() => setModo("calculado")} rotulo="Calcular: base × alíquota cadastrada" descricao="Você informa a base; a alíquota vem do parâmetro vigente com base legal, e a versão fica carimbada." />
        )}
        <Opcao tipo="radio" name="modo" checked={modo === "ausente"} onChange={() => setModo("ausente")} rotulo="Deixar ausente" descricao="Sem número — o total do cenário fica incompleto até preencher." />
      </fieldset>

      {modo === "digitado" && (
        <Campo rotulo="Valor (R$)" obrigatorio>
          <Entrada inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" autoFocus />
        </Campo>
      )}

      {modo === "calculado" && (
        <div className="flex flex-col gap-4">
          <Campo rotulo="Base de cálculo (R$)" obrigatorio ajuda="Valor sobre o qual a alíquota incide (ex.: valor de mercado dos bens transmitidos).">
            <Entrada inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} placeholder="0,00" autoFocus />
          </Campo>
          {parametroVigente === undefined ? (
            <p role="status" className="text-sm text-tinta-suave">
              Buscando alíquota vigente…
            </p>
          ) : opcoesParametro.length === 0 ? (
            <div className="flex flex-col gap-2 rounded-controle border border-ambar-borda bg-ambar-fraco px-3.5 py-2.5 text-sm text-[color:var(--ambar)]">
              <p className="font-bold">Nenhuma alíquota de {celula.rubrica.toUpperCase()} cadastrada{uf ? ` para ${uf}` : ""}.</p>
              <p>
                O sistema não inventa alíquota: cadastre em{" "}
                <Link href="/admin#parametros" className="inline-flex min-h-11 items-center font-medium underline underline-offset-2">
                  Admin → Parâmetros
                </Link>{" "}
                (com base legal) ou digite o valor.
              </p>
            </div>
          ) : (
            <Campo rotulo="Alíquota (parâmetro vigente)" obrigatorio ajuda="Só alíquota cadastrada com base legal multiplica a base.">
              <Selecao value={parametroId} onChange={(e) => setParametroId(e.target.value)}>
                <option value="">Escolha…</option>
                {opcoesParametro.map((p) => (
                  <option key={p.id} value={p.id}>
                    {rotularParametro(p)}
                    {!p.ativo ? " (versão antiga carimbada)" : ""}
                  </option>
                ))}
              </Selecao>
            </Campo>
          )}
          {previa !== null && (
            <p className="text-sm text-tinta">
              Prévia: <strong className="tabular-nums">{formatarMoeda(previa)}</strong>{" "}
              <span className="text-tinta-suave">(o banco confirma o cálculo ao salvar)</span>
            </p>
          )}
        </div>
      )}

      <Campo rotulo="Nota" extra="opcional">
        <Entrada value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} />
      </Campo>

      {erro && (
        <p role="alert" className="text-sm font-medium text-[color:var(--vermelho)]">
          {erro}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Botao type="submit" variante="primario" carregando={salvando}>
          Salvar célula
        </Botao>
        <Botao variante="fantasma" onClick={aoFechar} disabled={salvando}>
          Fechar
        </Botao>
      </div>
    </form>
  );
}
