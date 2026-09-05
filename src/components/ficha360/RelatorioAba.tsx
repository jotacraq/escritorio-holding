"use client";

import { useCallback, useState, type ReactNode } from "react";
import { adicionarFamiliar, buscarRelatorio, salvarRelatorio, ApiError, type Familiar, type Ficha360, type PatrimonioItem } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Botao } from "@/components/ui/Botao";
import { formatarCidadeUf, formatarData, formatarMoeda, SEM_DADO } from "@/lib/formatar";
import { Cartao } from "@/components/ui/Cartao";
import { Selo } from "@/components/ui/Selo";
import { CenarioPatrimonialGaveta } from "@/components/ficha360/CenarioPatrimonialGaveta";
import { extrasDaFicha } from "@/components/ficha360/api-extras";

/**
 * Relatório da Sessão de Viabilidade — espelha, campo a campo,
 * `sic-hf-brain/06 - Materiais/Relatorio da Sessao de Viabilidade (template).md`,
 * o documento que a Dra. Elaine preenche à mão hoje. Escreve em
 * `relatorios_sessao` via `buscarRelatorio`/`salvarRelatorio` (`src/lib/api.ts`,
 * já existentes) — o corpo aceito é o `CorpoSchema` de
 * `src/app/api/jornadas/[id]/relatorio/route.ts`; os nomes de campo abaixo
 * são exatamente os dela. Nenhum cálculo de imposto acontece aqui: alíquota
 * e link de legislação são digitados pela advogada (ver nota daquela rota).
 */

/** Régua local só para banco ANTES da 0060 (`rubricas_faltantes` ausente): as 7 rubricas do seed `configuracoes['cenario.rubricas']` (0057/B37). */
const RUBRICAS_PADRAO_UI = ["itcmd", "itbi", "custas_cartorio", "honorarios_advocaticios", "honorarios_croqui", "honorarios_holding", "manutencao_anual"];

const ROTULO_CENARIO_RESUMO: Record<string, string> = {
  inventario: "Inventário",
  doacao: "Doação",
  holding_1_celula: "Holding 1 célula",
  holding_2_celulas: "Holding 2 células",
  holding_3_celulas: "Holding 3 células",
};

// ---------------------------------------------------------------------------
// Tipos do formulário (o backend guarda `relatorios_sessao` como registro
// aberto — `RelatorioSessao` em src/lib/api.ts é `[campo: string]: unknown`).
// ---------------------------------------------------------------------------

interface TributoItcmd {
  dispositivo_legal?: string;
  link_legislacao?: string;
  heranca_aliquota?: string;
  heranca_base_calculo?: string;
  heranca_dispositivo?: string;
  doacao_aliquota?: string;
  doacao_base_calculo?: string;
  doacao_dispositivo?: string;
  observacoes?: string;
}
interface TributoItbi {
  dispositivo_legal?: string;
  link_legislacao?: string;
  aliquota_base_dispositivo?: string;
  entendimento_prefeitura?: string;
  observacoes?: string;
}
interface TributoCartorio {
  estimativa_despesas?: string;
  link?: string;
}
interface Tributos {
  itcmd?: TributoItcmd;
  itbi?: TributoItbi;
  cartorio_notas?: TributoCartorio;
  cartorio_registro_imoveis?: TributoCartorio;
}

interface FormularioRelatorio {
  acompanhado?: boolean;
  quem_acompanha: string;
  acompanhante_decide?: boolean;
  acompanhante_assistiu?: boolean;
  data_contratacao: string;
  valor_pago_sessao?: number;
  parcelas?: number;
  motivacao_cliente: string;
  receita_familiar_mensal?: number;
  ideia_custo_inventario: string;
  reserva_ou_seguro: string;
  ciente_itcmd?: boolean;
  preocupacao_predominante: string;
  como_deseja_organizar: string;
  motiva_evitar_inventario: string;
  interesse_imediato: string;
  relacao_filhos_terceiros: string;
  porque_nos_procurou: string;
  falta_planejamento_preocupa: string;
  resultado_sessao: string;
  tributos: Tributos;
  consideracoes_apresentacao_croqui: string;
}

function formularioVazio(): FormularioRelatorio {
  return {
    quem_acompanha: "",
    data_contratacao: "",
    motivacao_cliente: "",
    ideia_custo_inventario: "",
    reserva_ou_seguro: "",
    preocupacao_predominante: "",
    como_deseja_organizar: "",
    motiva_evitar_inventario: "",
    interesse_imediato: "",
    relacao_filhos_terceiros: "",
    porque_nos_procurou: "",
    falta_planejamento_preocupa: "",
    resultado_sessao: "",
    tributos: {},
    consideracoes_apresentacao_croqui: "",
  };
}

function paraFormulario(bruto: Record<string, unknown> | null): FormularioRelatorio {
  const base = formularioVazio();
  if (!bruto) return base;
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  const numero = (v: unknown) => (typeof v === "number" ? v : undefined);
  const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
  return {
    acompanhado: bool(bruto.acompanhado),
    quem_acompanha: texto(bruto.quem_acompanha),
    acompanhante_decide: bool(bruto.acompanhante_decide),
    acompanhante_assistiu: bool(bruto.acompanhante_assistiu),
    data_contratacao: texto(bruto.data_contratacao),
    valor_pago_sessao: numero(bruto.valor_pago_sessao),
    parcelas: numero(bruto.parcelas),
    motivacao_cliente: texto(bruto.motivacao_cliente),
    receita_familiar_mensal: numero(bruto.receita_familiar_mensal),
    ideia_custo_inventario: texto(bruto.ideia_custo_inventario),
    reserva_ou_seguro: texto(bruto.reserva_ou_seguro),
    ciente_itcmd: bool(bruto.ciente_itcmd),
    preocupacao_predominante: texto(bruto.preocupacao_predominante),
    como_deseja_organizar: texto(bruto.como_deseja_organizar),
    motiva_evitar_inventario: texto(bruto.motiva_evitar_inventario),
    interesse_imediato: texto(bruto.interesse_imediato),
    relacao_filhos_terceiros: texto(bruto.relacao_filhos_terceiros),
    porque_nos_procurou: texto(bruto.porque_nos_procurou),
    falta_planejamento_preocupa: texto(bruto.falta_planejamento_preocupa),
    resultado_sessao: texto(bruto.resultado_sessao),
    tributos: (bruto.tributos as Tributos | undefined) ?? {},
    consideracoes_apresentacao_croqui: texto(bruto.consideracoes_apresentacao_croqui),
  };
}

// ---------------------------------------------------------------------------
// Campos com "modo impressão": o controle some no papel (`.nao-imprimir`) e
// dá lugar ao valor em texto simples — é a diferença entre uma folha cheia de
// caixinhas de formulário e um relatório que a Dra. Elaine leva para a mesa.
// ---------------------------------------------------------------------------

function Campo({ id, rotulo, children, valorImpresso }: { id: string; rotulo: string; children: ReactNode; valorImpresso: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-tinta">{rotulo}</label>
      {children}
      <p className="hidden whitespace-pre-wrap text-sm text-tinta print:block">{valorImpresso}</p>
    </div>
  );
}

function Texto({ id, rotulo, valor, aoMudar, placeholder }: { id: string; rotulo: string; valor: string; aoMudar: (v: string) => void; placeholder?: string }) {
  return (
    <Campo id={id} rotulo={rotulo} valorImpresso={valor.trim() || SEM_DADO}>
      <input id={id} value={valor} onChange={(e) => aoMudar(e.target.value)} placeholder={placeholder} className="nao-imprimir min-h-11 rounded-controle border border-linha-forte bg-papel-elevado px-3 py-2 text-sm" />
    </Campo>
  );
}

function AreaTexto({ id, rotulo, valor, aoMudar, rows = 2 }: { id: string; rotulo: string; valor: string; aoMudar: (v: string) => void; rows?: number }) {
  return (
    <Campo id={id} rotulo={rotulo} valorImpresso={valor.trim() || SEM_DADO}>
      <textarea id={id} rows={rows} value={valor} onChange={(e) => aoMudar(e.target.value)} className="nao-imprimir min-h-11 rounded-controle border border-linha-forte bg-papel-elevado px-3 py-2 text-sm" />
    </Campo>
  );
}

function CampoData({ id, rotulo, valor, aoMudar }: { id: string; rotulo: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <Campo id={id} rotulo={rotulo} valorImpresso={valor ? formatarData(valor) : SEM_DADO}>
      <input id={id} type="date" value={valor} onChange={(e) => aoMudar(e.target.value)} className="nao-imprimir min-h-11 rounded-controle border border-linha-forte bg-papel-elevado px-3 py-2 text-sm" />
    </Campo>
  );
}

function CampoMoeda({ id, rotulo, valor, aoMudar }: { id: string; rotulo: string; valor: number | undefined; aoMudar: (v: number | undefined) => void }) {
  return (
    <Campo id={id} rotulo={rotulo} valorImpresso={formatarMoeda(valor ?? null)}>
      <input id={id} type="number" min={0} step="0.01" value={valor ?? ""} onChange={(e) => aoMudar(e.target.value === "" ? undefined : Number(e.target.value))} className="nao-imprimir min-h-11 rounded-controle border border-linha-forte bg-papel-elevado px-3 py-2 text-sm" />
    </Campo>
  );
}

function CampoNumero({ id, rotulo, valor, aoMudar }: { id: string; rotulo: string; valor: number | undefined; aoMudar: (v: number | undefined) => void }) {
  return (
    <Campo id={id} rotulo={rotulo} valorImpresso={valor === undefined ? SEM_DADO : String(valor)}>
      <input id={id} type="number" min={1} step="1" value={valor ?? ""} onChange={(e) => aoMudar(e.target.value === "" ? undefined : Number(e.target.value))} className="nao-imprimir min-h-11 rounded-controle border border-linha-forte bg-papel-elevado px-3 py-2 text-sm" />
    </Campo>
  );
}

function CampoBooleano({ id, rotulo, valor, aoMudar }: { id: string; rotulo: string; valor: boolean | undefined; aoMudar: (v: boolean | undefined) => void }) {
  const pill = (ativo: boolean) =>
    `inline-flex min-h-11 items-center rounded-pilula border px-4 text-sm font-medium ${ativo ? "border-[color:var(--latao)] bg-[color:var(--latao-fraco)] text-tinta" : "border-linha-forte text-tinta-suave hover:text-tinta"}`;
  return (
    <div className="flex flex-col gap-1">
      <span id={`${id}-rotulo`} className="text-sm font-medium text-tinta">{rotulo}</span>
      <div role="group" aria-labelledby={`${id}-rotulo`} className="nao-imprimir flex gap-1.5">
        <button type="button" aria-pressed={valor === true} onClick={() => aoMudar(valor === true ? undefined : true)} className={pill(valor === true)}>Sim</button>
        <button type="button" aria-pressed={valor === false} onClick={() => aoMudar(valor === false ? undefined : false)} className={pill(valor === false)}>Não</button>
      </div>
      <p className="hidden text-sm text-tinta print:block">{valor === true ? "Sim" : valor === false ? "Não" : SEM_DADO}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composição patrimonial — leitura do que já está na aba Patrimônio (mesma
// fonte, `ficha.patrimonio`). Editar continua só lá: duplicar o formulário
// aqui criaria dois lugares para o mesmo dado divergir.
// ---------------------------------------------------------------------------

const ROTULOS_TIPO_PATRIMONIO: Record<PatrimonioItem["tipo"], string> = {
  imovel: "Imóveis",
  veiculo: "Veículos",
  investimento: "Investimentos",
  previdencia: "Previdência",
  empresa: "Empresas",
  outro: "Outros bens",
};

function SecaoPatrimonial({ patrimonio }: { patrimonio: PatrimonioItem[] }) {
  if (patrimonio.length === 0) {
    return <EstadoVazio titulo="Nenhum item patrimonial registrado" descricao="Registre os bens na aba Patrimônio — este relatório reflete o mesmo dado." />;
  }
  const grupos = new Map<PatrimonioItem["tipo"], PatrimonioItem[]>();
  for (const item of patrimonio) {
    grupos.set(item.tipo, [...(grupos.get(item.tipo) ?? []), item]);
  }
  return (
    <div className="flex flex-col gap-4">
      {[...grupos.entries()].map(([tipo, itens]) => (
        <div key={tipo} className="flex flex-col gap-1.5">
          <p className="text-xs font-bold uppercase tracking-wide text-tinta-fraca">{ROTULOS_TIPO_PATRIMONIO[tipo]}</p>
          <ul className="flex flex-col gap-1">
            {itens.map((item) => (
              <li key={item.id} className="rounded-controle bg-papel-fundo px-2.5 py-1.5 text-sm text-tinta">
                <span className="font-medium">{item.descricao}</span>
                <span className="text-tinta-suave">
                  {item.ano_aquisicao ? ` · aquisição ${item.ano_aquisicao}` : ""}
                  {` · histórico ${formatarMoeda(item.valor_historico)}`}
                  {` · mercado ${formatarMoeda(item.valor_mercado)}`}
                  {item.destinacao ? ` · ${item.destinacao}` : ""}
                  {item.valor_locacao_mensal ? ` · locação ${formatarMoeda(item.valor_locacao_mensal)}/mês` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composição familiar — lista + registro novo (`GET`/`POST /familiares`, já
// existentes). Não há `PUT`/`DELETE` no backend para esta tabela — a tela não
// inventa o que a API não oferece.
// ---------------------------------------------------------------------------

function SecaoFamiliar({ jornadaId, familiares, aoAtualizar }: { jornadaId: string; familiares: Familiar[]; aoAtualizar: () => void }) {
  const [novo, setNovo] = useState<{ parentesco: string; nome: string; idade: string; ocupacao: string; regime_casamento: string; ano_casamento: string; observacoes: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (!novo || !novo.parentesco.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      // `ano_casamento` existe na tabela (`src/types/banco.ts`) mas não no tipo
      // `Familiar` de `src/lib/api.ts` (drift entre os dois arquivos de tipo,
      // ambos fora da minha fronteira) — o objeto abaixo tem o campo real; só
      // a checagem de excesso do TypeScript é contornada pelo `as`.
      const payload = {
        parentesco: novo.parentesco.trim(),
        nome: novo.nome.trim() || undefined,
        idade: novo.idade === "" ? undefined : Number(novo.idade),
        ocupacao: novo.ocupacao.trim() || undefined,
        regime_casamento: novo.regime_casamento.trim() || undefined,
        ano_casamento: novo.ano_casamento === "" ? undefined : Number(novo.ano_casamento),
        dependente_financeiro: null,
        observacoes: novo.observacoes.trim() || undefined,
      };
      await adicionarFamiliar(jornadaId, payload as Omit<Familiar, "id" | "pessoa_id">);
      setNovo(null);
      aoAtualizar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível registrar o familiar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {familiares.length === 0 && !novo && (
        <EstadoVazio titulo="Nenhum familiar registrado" descricao="Ex.: casal, idade, ocupação, regime de casamento, ano do casamento, filhos e netos." />
      )}
      {familiares.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {familiares.map((f) => {
            const anoCasamento = (f as unknown as { ano_casamento?: number | null }).ano_casamento;
            const partes = [
              f.idade ? `${f.idade} anos` : null,
              f.ocupacao,
              f.regime_casamento,
              anoCasamento ? `casados em ${anoCasamento}` : null,
              f.dependente_financeiro ? "dependente financeiro" : null,
              f.observacoes,
            ].filter(Boolean);
            return (
              <li key={f.id} className="rounded-controle bg-papel-fundo px-2.5 py-1.5 text-sm">
                <span className="font-medium text-tinta">{f.nome || f.parentesco}</span>
                <span className="text-tinta-fraca"> — {f.parentesco}</span>
                {partes.length > 0 && <p className="text-xs text-tinta-suave">{partes.join(" · ")}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {novo ? (
        <div className="nao-imprimir flex flex-col gap-3 rounded-controle border border-linha bg-papel-fundo p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              Parentesco
              <input value={novo.parentesco} onChange={(e) => setNovo({ ...novo, parentesco: e.target.value })} placeholder="Ex.: cônjuge, filho, neto…" className="rounded-controle border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Nome
              <input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} className="rounded-controle border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Idade
              <input type="number" min={0} value={novo.idade} onChange={(e) => setNovo({ ...novo, idade: e.target.value })} className="rounded-controle border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Ocupação
              <input value={novo.ocupacao} onChange={(e) => setNovo({ ...novo, ocupacao: e.target.value })} className="rounded-controle border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Regime de casamento
              <input value={novo.regime_casamento} onChange={(e) => setNovo({ ...novo, regime_casamento: e.target.value })} className="rounded-controle border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Ano do casamento
              <input type="number" min={1900} max={2100} value={novo.ano_casamento} onChange={(e) => setNovo({ ...novo, ano_casamento: e.target.value })} className="rounded-controle border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-3">
              Observações (ex.: netos)
              <input value={novo.observacoes} onChange={(e) => setNovo({ ...novo, observacoes: e.target.value })} className="rounded-controle border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
          </div>
          {erro && <p className="text-xs text-[color:var(--vermelho)]">{erro}</p>}
          <div className="flex gap-2">
            <Botao variante="primario" carregando={salvando} onClick={salvar} className="text-xs">Adicionar</Botao>
            <Botao variante="fantasma" className="text-xs" onClick={() => setNovo(null)}>Cancelar</Botao>
          </div>
        </div>
      ) : (
        <div className="nao-imprimir">
          <Botao variante="secundario" onClick={() => setNovo({ parentesco: "", nome: "", idade: "", ocupacao: "", regime_casamento: "", ano_casamento: "", observacoes: "" })}>
            + Adicionar familiar
          </Botao>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tela principal
// ---------------------------------------------------------------------------

export function RelatorioAba({ jornadaId, ficha, aoAtualizar }: { jornadaId: string; ficha: Ficha360; aoAtualizar: () => void }) {
  const buscar = useCallback(() => buscarRelatorio(jornadaId), [jornadaId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [jornadaId]);
  const [form, setForm] = useState<FormularioRelatorio | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  // Fase 4 §4.3 — gaveta "Cenário Patrimonial" (grade rubrica × cenário com
  // procedência). O resumo do cartão lê `ficha.cenarios` (payload da Ficha,
  // tolerante a tabela ausente); a gaveta busca a grade completa ao abrir.
  const [cenarioAberto, setCenarioAberto] = useState(false);
  const cenariosDaFicha = extrasDaFicha(ficha).cenarios;

  const formAtual = form ?? (dados ? paraFormulario(dados.relatorio) : null);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar o relatório" />;
  if (carregando || !formAtual) return <EstadoCarregando rotulo="Carregando relatório…" />;

  const patrimonio = ficha.patrimonio ?? [];
  const familiares = ficha.familiares ?? [];
  const itensComValor = patrimonio.filter((i) => i.valor_mercado != null || i.valor_historico != null);
  const valorPatrimonio = patrimonio.length === 0 ? null : itensComValor.reduce((acc, i) => acc + (i.valor_mercado ?? i.valor_historico ?? 0), 0);
  const naturezaDosBens = patrimonio.length === 0 ? null : [...new Set(patrimonio.map((i) => ROTULOS_TIPO_PATRIMONIO[i.tipo]))].join(", ");
  const quantidadeImoveis = patrimonio.length === 0 ? null : patrimonio.filter((i) => i.tipo === "imovel").length;

  function mudar<K extends keyof FormularioRelatorio>(campo: K, valor: FormularioRelatorio[K]) {
    setForm({ ...(formAtual as FormularioRelatorio), [campo]: valor });
  }

  function mudarTributo<S extends keyof Tributos>(secao: S, campo: keyof NonNullable<Tributos[S]>, valor: string) {
    setForm({
      ...(formAtual as FormularioRelatorio),
      tributos: { ...(formAtual as FormularioRelatorio).tributos, [secao]: { ...(formAtual as FormularioRelatorio).tributos[secao], [campo]: valor } },
    });
  }

  async function salvar() {
    setSalvando(true);
    setErroSalvar(null);
    try {
      const payload: Record<string, unknown> = { ...formAtual };
      // Strings vazias não são "resposta"; omitir mantém o registro honesto
      // (o backend, num PUT, só sobrescreve as chaves que a gente manda).
      for (const [chave, valor] of Object.entries(payload)) {
        if (valor === "" || valor === undefined) delete payload[chave];
      }
      const res = await salvarRelatorio(jornadaId, payload);
      setForm(paraFormulario(res.relatorio));
      setSalvoEm(new Date().toISOString());
      aoAtualizar();
    } catch (e) {
      setErroSalvar(e instanceof ApiError ? e.message : "Não foi possível salvar o relatório.");
    } finally {
      setSalvando(false);
    }
  }

  const t = formAtual.tributos;

  // Com a 0060 a view já trava o total (rubrica da config nunca gravada conta
  // como ausente) e diz quais faltam em `rubricas_faltantes`. Sem ela, a
  // régua local das 7 rubricas — mesma conta de `CenarioPatrimonialGaveta`.
  const totaisCenario = (cenariosDaFicha?.totais ?? []).map((t) => {
    if (t.rubricas_faltantes) return t;
    const gravadas = (cenariosDaFicha?.rubricas ?? []).filter((r) => r.cenario_id === t.cenario_id);
    const faltam = RUBRICAS_PADRAO_UI.filter((chave) => (gravadas.find((r) => r.rubrica === chave)?.procedencia ?? "ausente") === "ausente").length;
    return faltam > 0 ? { ...t, total: null, rubricas_ausentes: faltam } : t;
  });
  const cenariosCompletos = totaisCenario.filter((t) => t.total !== null).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="nao-imprimir flex items-center justify-between gap-3">
        <p className="text-xs text-tinta-fraca">Relatório da Sessão de Viabilidade — espelha o formulário em papel, campo a campo.</p>
        <Botao variante="secundario" tamanho="compacto" onClick={() => window.print()}>Imprimir relatório</Botao>
      </div>

      <Cartao
        rotulo="Números da sessão"
        titulo="Cenário Patrimonial"
        descricao="Custo de cada caminho (inventário, doação, holding) rubrica por rubrica — com a origem de cada número. O sistema não calcula imposto sozinho."
        realce="latao"
        acao={
          <Botao variante="primario" tamanho="compacto" onClick={() => setCenarioAberto(true)}>
            Abrir cenário
          </Botao>
        }
      >
        {cenariosDaFicha === null ? (
          <p className="text-sm text-tinta-suave">Ainda não disponível neste ambiente ou sem cenário iniciado — abra para começar.</p>
        ) : totaisCenario.length === 0 ? (
          <p className="text-sm text-tinta-suave">Nenhum cenário preenchido ainda. Abra a grade e digite ou calcule a primeira rubrica.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {totaisCenario.map((t) => (
              <Selo key={t.cenario_id} tom={t.total !== null ? "verde" : "ambar"}>
                {ROTULO_CENARIO_RESUMO[t.cenario] ?? t.cenario}: {t.total !== null ? formatarMoeda(t.total) : `faltam ${t.rubricas_ausentes}`}
              </Selo>
            ))}
            <span className="text-xs text-tinta-suave">
              {cenariosCompletos} de {totaisCenario.length} {totaisCenario.length === 1 ? "cenário completo" : "cenários completos"}
            </span>
          </div>
        )}
      </Cartao>
      <CenarioPatrimonialGaveta jornadaId={jornadaId} aberta={cenarioAberto} aoFechar={() => setCenarioAberto(false)} nomeCliente={ficha.pessoa.nome} uf={ficha.pessoa.uf} aoAtualizar={aoAtualizar} />

      <header className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-tinta">Relatório da Sessão de Viabilidade</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-tinta-fraca">Cliente</dt><dd className="text-tinta">{ficha.pessoa.nome}</dd></div>
          <div><dt className="text-tinta-fraca">Cidade em que reside</dt><dd className="text-tinta">{formatarCidadeUf(ficha.pessoa.cidade, ficha.pessoa.uf)}</dd></div>
          <div><dt className="text-tinta-fraca">Estado civil</dt><dd className="text-tinta">{ficha.pessoa.estado_civil ?? SEM_DADO}</dd></div>
          <div><dt className="text-tinta-fraca">Profissão</dt><dd className="text-tinta">{ficha.pessoa.profissao ?? SEM_DADO}</dd></div>
          <div><dt className="text-tinta-fraca">Natureza dos bens</dt><dd className="text-tinta">{naturezaDosBens ?? SEM_DADO}</dd></div>
          <div><dt className="text-tinta-fraca">Quantidade de imóveis</dt><dd className="text-tinta">{quantidadeImoveis ?? SEM_DADO}</dd></div>
          <div><dt className="text-tinta-fraca">Valor do patrimônio</dt><dd className="text-tinta">{valorPatrimonio === null ? SEM_DADO : formatarMoeda(valorPatrimonio)}</dd></div>
          <div><dt className="text-tinta-fraca">Data da sessão de viabilidade</dt><dd className="text-tinta">{formatarData(ficha.sessao?.realizada_em)}</dd></div>
        </dl>
      </header>

      <fieldset className="flex flex-col gap-3 border-t border-linha pt-4">
        <legend className="text-base font-bold text-tinta">Sessão acompanhada</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoBooleano id="acompanhado" rotulo="Participará da sessão de viabilidade acompanhado" valor={formAtual.acompanhado} aoMudar={(v) => mudar("acompanhado", v)} />
          <CampoData id="data-contratacao" rotulo="Data da contratação da sessão" valor={formAtual.data_contratacao} aoMudar={(v) => mudar("data_contratacao", v)} />
          {formAtual.acompanhado && (
            <>
              <Texto id="quem-acompanha" rotulo="Quem acompanhará na sessão" valor={formAtual.quem_acompanha} aoMudar={(v) => mudar("quem_acompanha", v)} />
              <CampoBooleano id="acompanhante-decide" rotulo="O acompanhante é responsável pela decisão" valor={formAtual.acompanhante_decide} aoMudar={(v) => mudar("acompanhante_decide", v)} />
              <CampoBooleano id="acompanhante-assistiu" rotulo="O acompanhante assistiu palestra/site" valor={formAtual.acompanhante_assistiu} aoMudar={(v) => mudar("acompanhante_assistiu", v)} />
            </>
          )}
          <CampoMoeda id="valor-pago-sessao" rotulo="Valor pago pela sessão" valor={formAtual.valor_pago_sessao} aoMudar={(v) => mudar("valor_pago_sessao", v)} />
          <CampoNumero id="parcelas" rotulo="Parcelas" valor={formAtual.parcelas} aoMudar={(v) => mudar("parcelas", v)} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-linha pt-4">
        <legend className="text-base font-bold text-tinta">Motivação do cliente em realizar a sessão</legend>
        <AreaTexto id="motivacao-cliente" rotulo="Motivação" valor={formAtual.motivacao_cliente} aoMudar={(v) => mudar("motivacao_cliente", v)} rows={3} />
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-linha pt-4">
        <legend className="text-base font-bold text-tinta">Composição familiar</legend>
        <p className="text-xs text-tinta-fraca">Casal — idade, ocupação, regime de casamento, ano do casamento. Filhos — idade, ocupação, regime de casamento, netos.</p>
        <SecaoFamiliar jornadaId={jornadaId} familiares={familiares} aoAtualizar={aoAtualizar} />
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-linha pt-4">
        <legend className="text-base font-bold text-tinta">Composição patrimonial</legend>
        <p className="nao-imprimir text-xs text-tinta-fraca">Mesma fonte da aba Patrimônio — imóveis (ano de aquisição, valor histórico e de mercado, destinação e locação), veículos, investimentos e empresas (objeto, sócios, capital social, PL, faturamento).</p>
        <SecaoPatrimonial patrimonio={patrimonio} />
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-linha pt-4">
        <legend className="text-base font-bold text-tinta">Situação financeira e percepção de risco</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoMoeda id="receita-familiar" rotulo="Receita familiar mensal" valor={formAtual.receita_familiar_mensal} aoMudar={(v) => mudar("receita_familiar_mensal", v)} />
          <CampoBooleano id="ciente-itcmd" rotulo="Está ciente da proposta de aumento do ITCMD?" valor={formAtual.ciente_itcmd} aoMudar={(v) => mudar("ciente_itcmd", v)} />
        </div>
        <AreaTexto id="custo-inventario" rotulo="Tem ideia de qual seria o custo do inventário" valor={formAtual.ideia_custo_inventario} aoMudar={(v) => mudar("ideia_custo_inventario", v)} />
        <AreaTexto id="reserva-seguro" rotulo="Reserva ou seguro" valor={formAtual.reserva_ou_seguro} aoMudar={(v) => mudar("reserva_ou_seguro", v)} />
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-t border-linha pt-4">
        <legend className="text-base font-bold text-tinta">Aprofundamento</legend>
        <AreaTexto id="preocupacao-predominante" rotulo="Entre a pandemia e o risco do ITCMD aumentar, o que te preocupa mais?" valor={formAtual.preocupacao_predominante} aoMudar={(v) => mudar("preocupacao_predominante", v)} />
        <AreaTexto id="como-organizar" rotulo="Hoje, como você gostaria de deixar organizado o patrimônio para os seus filhos?" valor={formAtual.como_deseja_organizar} aoMudar={(v) => mudar("como_deseja_organizar", v)} />
        <AreaTexto id="motiva-evitar-inventario" rotulo="A ideia de seu filho não precisar passar por Inventário te motiva a realizar um sistema de planejamento sucessório?" valor={formAtual.motiva_evitar_inventario} aoMudar={(v) => mudar("motiva_evitar_inventario", v)} />
        <AreaTexto id="interesse-imediato" rotulo="Você tem interesse em realizar esse sistema o quanto antes?" valor={formAtual.interesse_imediato} aoMudar={(v) => mudar("interesse_imediato", v)} />
        <AreaTexto id="relacao-filhos-terceiros" rotulo="Como você acredita que será o relacionamento dos seus filhos (por causa dos “terceiros”) se eles nunca precisarem passar por Inventário?" valor={formAtual.relacao_filhos_terceiros} aoMudar={(v) => mudar("relacao_filhos_terceiros", v)} />
        <AreaTexto id="porque-nos-procurou" rotulo="Porque nos procurou" valor={formAtual.porque_nos_procurou} aoMudar={(v) => mudar("porque_nos_procurou", v)} />
        <AreaTexto id="falta-planejamento" rotulo="Falta de planejamento está causando preocupação" valor={formAtual.falta_planejamento_preocupa} aoMudar={(v) => mudar("falta_planejamento_preocupa", v)} />
        <AreaTexto id="resultado-sessao" rotulo="Resultado da sessão: cliente fechou ou não e por quê" valor={formAtual.resultado_sessao} aoMudar={(v) => mudar("resultado_sessao", v)} rows={3} />
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-t border-linha pt-4">
        <legend className="text-base font-bold text-tinta">Dados para início da execução do croqui</legend>
        <p className="nao-imprimir rounded-controle border border-ambar-borda bg-ambar-fraco px-3 py-2 text-xs text-[color:var(--ambar)]">
          Alíquota e link de legislação são digitados pela advogada — o sistema não calcula tributo nenhum.
        </p>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-tinta-fraca">ITCMD</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Texto id="itcmd-dispositivo" rotulo="Dispositivo legal (Lei Estadual)" valor={t.itcmd?.dispositivo_legal ?? ""} aoMudar={(v) => mudarTributo("itcmd", "dispositivo_legal", v)} />
            <Texto id="itcmd-link" rotulo="Link da legislação aplicável" valor={t.itcmd?.link_legislacao ?? ""} aoMudar={(v) => mudarTributo("itcmd", "link_legislacao", v)} placeholder="https://…" />
            <Texto id="itcmd-heranca-aliquota" rotulo="Herança — alíquota" valor={t.itcmd?.heranca_aliquota ?? ""} aoMudar={(v) => mudarTributo("itcmd", "heranca_aliquota", v)} />
            <Texto id="itcmd-heranca-base" rotulo="Herança — base de cálculo" valor={t.itcmd?.heranca_base_calculo ?? ""} aoMudar={(v) => mudarTributo("itcmd", "heranca_base_calculo", v)} />
            <Texto id="itcmd-heranca-dispositivo" rotulo="Herança — dispositivo legal" valor={t.itcmd?.heranca_dispositivo ?? ""} aoMudar={(v) => mudarTributo("itcmd", "heranca_dispositivo", v)} />
            <Texto id="itcmd-doacao-aliquota" rotulo="Doação — alíquota" valor={t.itcmd?.doacao_aliquota ?? ""} aoMudar={(v) => mudarTributo("itcmd", "doacao_aliquota", v)} />
            <Texto id="itcmd-doacao-base" rotulo="Doação — base de cálculo" valor={t.itcmd?.doacao_base_calculo ?? ""} aoMudar={(v) => mudarTributo("itcmd", "doacao_base_calculo", v)} />
            <Texto id="itcmd-doacao-dispositivo" rotulo="Doação — dispositivo legal" valor={t.itcmd?.doacao_dispositivo ?? ""} aoMudar={(v) => mudarTributo("itcmd", "doacao_dispositivo", v)} />
          </div>
          <AreaTexto id="itcmd-observacoes" rotulo="Observações/ressalvas" valor={t.itcmd?.observacoes ?? ""} aoMudar={(v) => mudarTributo("itcmd", "observacoes", v)} />
        </div>

        <div className="flex flex-col gap-2 border-t border-linha pt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-tinta-fraca">ITBI</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Texto id="itbi-dispositivo" rotulo="Dispositivo legal (Lei Municipal)" valor={t.itbi?.dispositivo_legal ?? ""} aoMudar={(v) => mudarTributo("itbi", "dispositivo_legal", v)} />
            <Texto id="itbi-link" rotulo="Link da legislação aplicável" valor={t.itbi?.link_legislacao ?? ""} aoMudar={(v) => mudarTributo("itbi", "link_legislacao", v)} placeholder="https://…" />
            <Texto id="itbi-aliquota" rotulo="Alíquota, base de cálculo e dispositivo legal" valor={t.itbi?.aliquota_base_dispositivo ?? ""} aoMudar={(v) => mudarTributo("itbi", "aliquota_base_dispositivo", v)} />
            <Texto id="itbi-entendimento" rotulo="Entendimento da prefeitura sobre ITBI na diferença entre valor histórico e valor de mercado" valor={t.itbi?.entendimento_prefeitura ?? ""} aoMudar={(v) => mudarTributo("itbi", "entendimento_prefeitura", v)} />
          </div>
          <AreaTexto id="itbi-observacoes" rotulo="Observações/ressalvas" valor={t.itbi?.observacoes ?? ""} aoMudar={(v) => mudarTributo("itbi", "observacoes", v)} />
        </div>

        <div className="flex flex-col gap-2 border-t border-linha pt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-tinta-fraca">Cartório de notas</p>
          <p className="text-xs text-tinta-fraca">Estimativa das despesas para escritura de inventário extrajudicial — consultar atos da corregedoria.</p>
          <AreaTexto id="cartorio-notas-estimativa" rotulo="Estimativa das despesas" valor={t.cartorio_notas?.estimativa_despesas ?? ""} aoMudar={(v) => mudarTributo("cartorio_notas", "estimativa_despesas", v)} />
          <Texto id="cartorio-notas-link" rotulo="Link da página consultada" valor={t.cartorio_notas?.link ?? ""} aoMudar={(v) => mudarTributo("cartorio_notas", "link", v)} placeholder="https://…" />
        </div>

        <div className="flex flex-col gap-2 border-t border-linha pt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-tinta-fraca">Cartório de registro de imóveis</p>
          <p className="text-xs text-tinta-fraca">Estimativa das despesas com registro de imóveis — consultar atos.</p>
          <AreaTexto id="cartorio-registro-estimativa" rotulo="Estimativa das despesas" valor={t.cartorio_registro_imoveis?.estimativa_despesas ?? ""} aoMudar={(v) => mudarTributo("cartorio_registro_imoveis", "estimativa_despesas", v)} />
          <Texto id="cartorio-registro-link" rotulo="Link da página consultada" valor={t.cartorio_registro_imoveis?.link ?? ""} aoMudar={(v) => mudarTributo("cartorio_registro_imoveis", "link", v)} placeholder="https://…" />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-linha pt-4">
        <legend className="text-base font-bold text-tinta">Registro das considerações relevantes observadas durante a apresentação do croqui</legend>
        <AreaTexto id="consideracoes-croqui" rotulo="Considerações" valor={formAtual.consideracoes_apresentacao_croqui} aoMudar={(v) => mudar("consideracoes_apresentacao_croqui", v)} rows={3} />
      </fieldset>

      {erroSalvar && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erroSalvar}</p>}
      {salvoEm && !erroSalvar && <p role="status" className="text-sm text-[color:var(--verde)]">Relatório salvo.</p>}

      <div className="nao-imprimir">
        <Botao variante="primario" carregando={salvando} onClick={salvar}>Salvar relatório</Botao>
      </div>
    </div>
  );
}
