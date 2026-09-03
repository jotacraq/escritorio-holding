"use client";

import { useCallback, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { ApiError } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { formatarDataHora } from "@/lib/formatar";
import { atualizarConfiguracao, listarConfiguracoes } from "../adminApi";
import { AvisoInline } from "../AvisoInline";
import type { ConfiguracaoAdmin, ValidadeLinksDias } from "@/types/admin";

/** `descricao` vem do banco (0027) — quando carrega "VALOR INICIAL", é chute
 * operacional ajustável, não regra do método da Dra. Elaine (BLOQUEIO B12). */
function ehValorInicial(descricao: string): boolean {
  return descricao.toLowerCase().includes("valor inicial");
}

function ValidadeLinksEditor({ valor, onChange }: { valor: ValidadeLinksDias; onChange: (v: ValidadeLinksDias) => void }) {
  const CAMPOS: { chave: keyof ValidadeLinksDias; rotulo: string }[] = [
    { chave: "formulario", rotulo: "Formulário" },
    { chave: "agendamento", rotulo: "Agendamento" },
    { chave: "documentos", rotulo: "Documentos" },
    { chave: "material", rotulo: "Material" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {CAMPOS.map((campo) => (
        <label key={campo.chave} className="flex flex-col gap-1 text-xs">
          {campo.rotulo} (dias)
          <input
            type="number"
            min={1}
            value={valor[campo.chave]}
            onChange={(e) => onChange({ ...valor, [campo.chave]: Number(e.target.value) })}
            className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1"
          />
        </label>
      ))}
    </div>
  );
}

function NumeroEditor({ valor, sufixo, onChange }: { valor: number; sufixo?: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-32 rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1"
      />
      {sufixo && <span className="text-xs text-tinta-fraca">{sufixo}</span>}
    </div>
  );
}

function isValidadeLinksDias(valor: unknown): valor is ValidadeLinksDias {
  return (
    typeof valor === "object" &&
    valor !== null &&
    "formulario" in valor &&
    "agendamento" in valor &&
    "documentos" in valor &&
    "material" in valor
  );
}

const SUFIXO: Record<string, string> = {
  "link.limite_por_minuto": "requisições/minuto",
  "link.limite_por_dia": "requisições/dia",
  "ia.cooldown_segundos": "segundos",
  "ia.teto_execucoes_dia_por_usuario": "execuções/dia",
  "agenda.duracao_padrao_minutos": "minutos",
  "agenda.slots_ofertados_ao_cliente": "horários",
};

export function ConfiguracoesAba() {
  const buscar = useCallback(() => listarConfiguracoes(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);

  const [rascunhos, setRascunhos] = useState<Record<string, unknown>>({});
  const [salvandoChave, setSalvandoChave] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: "sucesso" | "erro"; texto: string } | null>(null);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar as configurações" />;
  if (carregando && !dados) return <EstadoCarregando rotulo="Carregando configurações…" />;
  if (!dados) return null;

  function valorAtual(config: ConfiguracaoAdmin) {
    return Object.prototype.hasOwnProperty.call(rascunhos, config.chave) ? rascunhos[config.chave] : config.valor;
  }

  function estaAlterado(config: ConfiguracaoAdmin) {
    return Object.prototype.hasOwnProperty.call(rascunhos, config.chave) && JSON.stringify(rascunhos[config.chave]) !== JSON.stringify(config.valor);
  }

  async function salvar(config: ConfiguracaoAdmin) {
    setSalvandoChave(config.chave);
    setAviso(null);
    try {
      await atualizarConfiguracao(config.chave, valorAtual(config));
      setAviso({ tom: "sucesso", texto: `"${config.chave}" atualizada.` });
      setRascunhos((atual) => {
        const proximo = { ...atual };
        delete proximo[config.chave];
        return proximo;
      });
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível salvar esta configuração." });
    } finally {
      setSalvandoChave(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-tinta-fraca">
        Prazo de link, cooldown de IA e duração de sessão. Chave nova é migration — esta tela só ajusta valor de chave que já
        existe.
      </p>

      {aviso && <AvisoInline tom={aviso.tom}>{aviso.texto}</AvisoInline>}

      <div className="flex flex-col gap-3">
        {dados.itens.map((config) => {
          const valor = valorAtual(config);
          const alterado = estaAlterado(config);
          return (
            <div key={config.chave} className="rounded-sm border border-linha bg-papel-elevado p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-sm font-medium text-tinta">{config.chave}</p>
                  <p className="text-xs text-tinta-suave">{config.descricao}</p>
                </div>
                {ehValorInicial(config.descricao) && (
                  <span className="whitespace-nowrap rounded-sm border border-ambar-borda bg-ambar-fraco px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--ambar)]">
                    valor inicial — não vem do método
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                {isValidadeLinksDias(valor) ? (
                  <ValidadeLinksEditor valor={valor} onChange={(v) => setRascunhos({ ...rascunhos, [config.chave]: v })} />
                ) : typeof valor === "number" ? (
                  <NumeroEditor
                    valor={valor}
                    sufixo={SUFIXO[config.chave]}
                    onChange={(v) => setRascunhos({ ...rascunhos, [config.chave]: v })}
                  />
                ) : (
                  <textarea
                    value={JSON.stringify(valor)}
                    onChange={(e) => {
                      try {
                        setRascunhos({ ...rascunhos, [config.chave]: JSON.parse(e.target.value) });
                      } catch {
                        /* mantém o texto digitado até ficar JSON válido */
                      }
                    }}
                    rows={2}
                    className="w-full rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1 font-mono text-xs"
                  />
                )}

                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-tinta-fraca">atualizada em {formatarDataHora(config.atualizado_em)}</span>
                  <Botao
                    variante="primario"
                    className="text-xs"
                    disabled={!alterado}
                    carregando={salvandoChave === config.chave}
                    onClick={() => salvar(config)}
                  >
                    Salvar
                  </Botao>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
