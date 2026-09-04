"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useEtapasOrdem } from "@/hooks/useJornadas";
import { atualizarEtapa, buscarBriefing, ApiError, type Briefing, type DesfechoJornada, type Ficha360 } from "@/lib/api";
import { formatarCidadeUf, formatarTelefone } from "@/lib/formatar";
import { Selo, SeloDadoExemplo } from "@/components/ui/Selo";
import { Botao } from "@/components/ui/Botao";
import { calcularPendencias } from "@/components/ui/pendencias";

const ROTULOS_DESFECHO: Record<DesfechoJornada, { rotulo: string; tom: "verde" | "vermelho" | "azul" | "neutro" }> = {
  aberta: { rotulo: "Aberta", tom: "azul" },
  ganha: { rotulo: "Ganha", tom: "verde" },
  perdida: { rotulo: "Perdida", tom: "vermelho" },
  descartada: { rotulo: "Descartada", tom: "vermelho" },
  congelada: { rotulo: "Congelada", tom: "neutro" },
};

const ROTULOS_NIVEL_PAGO = ["Nada pago", "Sessão paga", "Croqui pago", "Holding paga"];

const ORDEM_PROBABILIDADE: Record<"alta" | "media" | "baixa", number> = { alta: 0, media: 1, baixa: 2 };

/** A objeção mais provável do Briefing — a de maior probabilidade primeiro. */
function objecaoPrincipal(briefing: Briefing | null): string | null {
  const lista = briefing?.conteudo.objecoes_provaveis;
  if (!lista || lista.length === 0) return null;
  const ordenada = [...lista].sort((a, b) => ORDEM_PROBABILIDADE[a.probabilidade] - ORDEM_PROBABILIDADE[b.probabilidade]);
  return ordenada[0].objecao;
}

interface ItemFaixa {
  rotulo: string;
  valor: string;
  href?: string;
}

/**
 * U2 — faixa de sinais vitais: quem é a pessoa, em que etapa está, o que já
 * pagou, o que falta — sempre visível, nunca some ao rolar (ver `sticky` no
 * `<dl>` abaixo, cujo container de posicionamento é o `<div className="flex
 * flex-col gap-6">` de `jornadas/[id]/page.tsx`, que também contém `<Abas>`
 * — por isso a faixa continua fixa durante a rolagem da ficha inteira, não
 * só deste cabeçalho).
 */
function FaixaVital({ ficha, rotuloEtapa, briefing, podeVerPatrimonio }: { ficha: Ficha360; rotuloEtapa: string; briefing: Briefing | null; podeVerPatrimonio: boolean }) {
  const { jornada, familiares } = ficha;
  const pendencias = calcularPendencias(ficha, podeVerPatrimonio);
  const objecao = objecaoPrincipal(briefing);
  const disc = briefing?.conteudo.perfil_disc;

  const itens: ItemFaixa[] = [{ rotulo: "Etapa", valor: rotuloEtapa }];

  if (jornada.faixa_patrimonio_declarada) {
    itens.push({ rotulo: "Patrimônio", valor: jornada.faixa_patrimonio_declarada, href: podeVerPatrimonio ? "#patrimonio" : undefined });
  }
  if (familiares && familiares.length > 0) {
    itens.push({ rotulo: "Familiares mapeados", valor: String(familiares.length), href: "#patrimonio" });
  }
  if (disc) {
    itens.push({ rotulo: "DISC", valor: disc.secundario ? `${disc.predominante} / ${disc.secundario}` : disc.predominante, href: "#briefing" });
  }
  if (objecao) {
    itens.push({ rotulo: "Objeção provável", valor: objecao, href: "#briefing" });
  }
  itens.push({
    rotulo: "Próxima ação",
    valor: pendencias[0]?.rotulo ?? "Nenhuma pendência",
    href: pendencias[0] ? `#${pendencias[0].abaId}` : undefined,
  });

  return (
    <dl className="nao-imprimir sticky top-0 z-20 flex flex-wrap items-baseline gap-x-5 gap-y-1.5 rounded-sm border border-linha-forte bg-papel-elevado px-3.5 py-2 text-xs shadow-[var(--sombra-cartao)] sm:text-[13px]">
      {itens.map((item) => (
        <div key={item.rotulo} className="flex items-baseline gap-1.5">
          <dt className="text-tinta-fraca">{item.rotulo}</dt>
          <dd>
            {item.href ? (
              <a
                href={item.href}
                className="rounded-sm font-medium text-tinta underline decoration-tinta-fraca decoration-dotted underline-offset-2 hover:text-[color:var(--latao-forte)] hover:decoration-[color:var(--latao)]"
              >
                {item.valor}
              </a>
            ) : (
              <span className="font-medium text-tinta">{item.valor}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CabecalhoFicha({ ficha, aoAtualizar }: { ficha: Ficha360; aoAtualizar: () => void }) {
  const { etapas } = useEtapasOrdem();
  const { jornada, pessoa } = ficha;
  const podeVerPatrimonio = ficha.patrimonio !== null;
  const [editandoDesfecho, setEditandoDesfecho] = useState(false);
  const [novoDesfecho, setNovoDesfecho] = useState<DesfechoJornada>(jornada.desfecho);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);

  const rotuloEtapa = etapas?.find((e) => e.etapa === jornada.etapa)?.rotulo ?? jornada.etapa;

  // Só para DISC e objeção provável na faixa vital — a aba Briefing já carrega
  // o próprio conteúdo completo de forma independente. Sem polling: busca uma
  // vez quando o id do briefing atual muda.
  useEffect(() => {
    const id = ficha.briefingAtual?.id;
    if (!id) {
      setBriefing(null);
      return;
    }
    let vivo = true;
    buscarBriefing(id)
      .then((b) => {
        if (vivo) setBriefing(b);
      })
      .catch(() => {
        if (vivo) setBriefing(null);
      });
    return () => {
      vivo = false;
    };
  }, [ficha.briefingAtual?.id]);

  async function salvarDesfecho() {
    if (novoDesfecho !== "aberta" && !motivo.trim()) {
      setErro("Motivo é obrigatório para qualquer desfecho diferente de aberta.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await atualizarEtapa(jornada.id, { desfecho: novoDesfecho, motivo: motivo.trim() || undefined });
      setEditandoDesfecho(false);
      aoAtualizar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar o desfecho.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <FaixaVital ficha={ficha} rotuloEtapa={rotuloEtapa} briefing={briefing} podeVerPatrimonio={podeVerPatrimonio} />
      <header className="flex flex-col gap-3 border-b border-linha-forte pb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-2xl font-semibold text-tinta">{pessoa.nome}</h1>
            {jornada.origem_dado === "exemplo" && <SeloDadoExemplo />}
          </div>
          <p className="text-sm text-tinta-suave">
            {formatarCidadeUf(pessoa.cidade, pessoa.uf)}
            {pessoa.profissao && ` · ${pessoa.profissao}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Selo tom="azul">{rotuloEtapa}</Selo>
          <Selo tom={ROTULOS_DESFECHO[jornada.desfecho].tom}>{ROTULOS_DESFECHO[jornada.desfecho].rotulo}</Selo>
          <Selo tom="neutro">{ROTULOS_NIVEL_PAGO[jornada.nivel_pago]}</Selo>
          <Link
            href={`/sessoes/${jornada.id}/conduzir`}
            className="nao-imprimir inline-flex items-center justify-center gap-1.5 rounded-sm border border-transparent bg-[color:var(--latao)] px-3.5 py-2 text-sm font-medium text-papel-elevado transition-colors hover:bg-[color:var(--latao-forte)]"
          >
            Conduzir sessão
          </Link>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-tinta-fraca">Origem</dt>
          <dd className="text-tinta">
            {jornada.origem}
            {jornada.edicao_id && (
              <span title={jornada.edicao_id} className="ml-1 font-mono text-xs text-tinta-fraca">
                ({jornada.edicao_id.slice(0, 8)})
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-tinta-fraca">Trilha</dt>
          <dd className="text-tinta">{jornada.trilha === "seminario" ? "Seminário" : "Preliminar"}</dd>
        </div>
        <div>
          <dt className="text-tinta-fraca">Telefone</dt>
          <dd className="font-mono text-tinta">{formatarTelefone(pessoa.telefone)}</dd>
        </div>
        <div>
          <dt className="text-tinta-fraca">E-mail</dt>
          <dd className="text-tinta">{pessoa.email ?? "—"}</dd>
        </div>
      </dl>

      {jornada.motivo_desfecho && jornada.desfecho !== "aberta" && (
        <p className="rounded-sm bg-papel-fundo px-3 py-2 text-sm text-tinta-suave">
          <span className="font-medium text-tinta">Motivo do desfecho: </span>
          {jornada.motivo_desfecho}
        </p>
      )}

      {!editandoDesfecho ? (
        <div className="nao-imprimir">
          <Botao variante="fantasma" className="px-2 py-1 text-xs" onClick={() => setEditandoDesfecho(true)}>
            Alterar desfecho
          </Botao>
        </div>
      ) : (
        <div className="nao-imprimir flex flex-col gap-2 rounded-sm border border-linha bg-papel-fundo p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="novo-desfecho" className="text-xs font-medium text-tinta-suave">
              Novo desfecho
            </label>
            <select
              id="novo-desfecho"
              value={novoDesfecho}
              onChange={(e) => setNovoDesfecho(e.target.value as DesfechoJornada)}
              className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1 text-sm"
            >
              {Object.entries(ROTULOS_DESFECHO).map(([valor, info]) => (
                <option key={valor} value={valor}>
                  {info.rotulo}
                </option>
              ))}
            </select>
          </div>
          {novoDesfecho !== "aberta" && (
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo (obrigatório)"
              rows={2}
              className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5 text-sm"
            />
          )}
          {erro && <p className="text-xs text-[color:var(--vermelho)]">{erro}</p>}
          <div className="flex gap-2">
            <Botao variante="primario" carregando={salvando} onClick={salvarDesfecho} className="text-xs">
              Salvar
            </Botao>
            <Botao
              variante="fantasma"
              className="text-xs"
              onClick={() => {
                setEditandoDesfecho(false);
                setErro(null);
              }}
            >
              Cancelar
            </Botao>
          </div>
        </div>
      )}
      </header>
    </>
  );
}
