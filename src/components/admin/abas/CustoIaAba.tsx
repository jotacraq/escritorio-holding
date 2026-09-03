"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRecurso } from "@/hooks/useRecurso";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { formatarDataHora, formatarMoeda } from "@/lib/formatar";
import { buscarCustoIa } from "../adminApi";

const FORMATADOR_MES = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: "long", year: "numeric" });

function formatarMes(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  const texto = FORMATADOR_MES.format(data);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function CustoIaAba() {
  const buscar = useCallback(() => buscarCustoIa(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar o custo de IA" />;
  if (carregando && !dados) return <EstadoCarregando rotulo="Carregando custo de IA…" />;
  if (!dados) return null;

  const { resumo, por_mes, por_prompt, por_jornada } = dados;
  const semExecucaoReal = resumo.execucoes_reais === 0 && resumo.custo_real_total_usd === 0;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-tinta-fraca">
        Só execução real conta neste custo. Execução de demonstração aparece separada e nunca soma no total real.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-sm border border-linha bg-papel-elevado p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-tinta-fraca">Custo real</p>
          {semExecucaoReal ? (
            <p className="mt-1 text-sm text-tinta-suave">
              Nenhuma execução real de IA registrada ainda. O custo aparece aqui assim que a primeira análise rodar.
            </p>
          ) : (
            <>
              <p className="font-serif text-3xl font-semibold text-tinta">{formatarMoeda(resumo.custo_real_total_usd)}</p>
              <p className="text-xs text-tinta-suave">{resumo.execucoes_reais} execução(ões) real(is)</p>
            </>
          )}
        </div>
        <div className="rounded-sm border border-linha border-dashed bg-papel p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-tinta-fraca">Demonstração (não soma no real)</p>
          <p className="font-serif text-3xl font-semibold text-tinta-suave">{formatarMoeda(resumo.custo_demonstracao_total_usd)}</p>
          <p className="text-xs text-tinta-suave">{resumo.execucoes_demonstracao} execução(ões) de demonstração</p>
        </div>
      </div>

      {por_mes.length > 0 && (
        <div>
          <h3 className="mb-1.5 font-serif text-base font-semibold text-tinta">Por mês</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-linha-forte text-left text-tinta-suave">
                  <th className="py-1.5 pr-3 font-medium">Mês</th>
                  <th className="py-1.5 pr-3 font-medium">Modo</th>
                  <th className="py-1.5 pr-3 font-medium">Execuções</th>
                  <th className="py-1.5 pr-3 font-medium">Custo</th>
                </tr>
              </thead>
              <tbody>
                {por_mes.map((linha, indice) => (
                  <tr key={`${linha.mes}-${linha.modo}-${indice}`} className="border-b border-linha">
                    <td className="py-1.5 pr-3">{formatarMes(linha.mes)}</td>
                    <td className="py-1.5 pr-3">
                      <span
                        className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${
                          linha.modo === "real" ? "bg-latao-fraco text-[color:var(--latao-forte)]" : "border border-linha text-tinta-fraca"
                        }`}
                      >
                        {linha.modo === "real" ? "real" : "demonstração"}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">{linha.execucoes}</td>
                    <td className="py-1.5 pr-3 font-mono">{formatarMoeda(linha.custo_usd_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {por_prompt.length > 0 && (
        <div>
          <h3 className="mb-1.5 font-serif text-base font-semibold text-tinta">Por versão de prompt</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-linha-forte text-left text-tinta-suave">
                  <th className="py-1.5 pr-3 font-medium">Chave</th>
                  <th className="py-1.5 pr-3 font-medium">Versão</th>
                  <th className="py-1.5 pr-3 font-medium">Modo</th>
                  <th className="py-1.5 pr-3 font-medium">Execuções</th>
                  <th className="py-1.5 pr-3 font-medium">Custo</th>
                </tr>
              </thead>
              <tbody>
                {por_prompt.map((linha, indice) => (
                  <tr key={`${linha.prompt_versao_id}-${linha.modo}-${indice}`} className="border-b border-linha">
                    <td className="py-1.5 pr-3">{linha.chave}</td>
                    <td className="py-1.5 pr-3">
                      v{linha.versao}
                      {linha.versao_ativa && (
                        <span className="ml-1.5 inline-flex items-center rounded-sm bg-verde-fraco px-1 py-0.5 text-[10px] font-medium text-[color:var(--verde)]">
                          ativa
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">{linha.modo === "real" ? "real" : "demonstração"}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{linha.execucoes}</td>
                    <td className="py-1.5 pr-3 font-mono">{formatarMoeda(linha.custo_usd_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {por_jornada.length > 0 && (
        <div>
          <h3 className="mb-1.5 font-serif text-base font-semibold text-tinta">Por jornada (top 50)</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-linha-forte text-left text-tinta-suave">
                  <th className="py-1.5 pr-3 font-medium">Jornada</th>
                  <th className="py-1.5 pr-3 font-medium">Modo</th>
                  <th className="py-1.5 pr-3 font-medium">Execuções</th>
                  <th className="py-1.5 pr-3 font-medium">Custo</th>
                  <th className="py-1.5 pr-3 font-medium">Última execução</th>
                </tr>
              </thead>
              <tbody>
                {por_jornada.map((linha, indice) => (
                  <tr key={`${linha.jornada_id}-${linha.modo}-${indice}`} className="border-b border-linha">
                    <td className="py-1.5 pr-3">
                      <Link href={`/jornadas/${linha.jornada_id}`} className="text-latao-forte underline-offset-2 hover:underline">
                        ver jornada
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3">{linha.modo === "real" ? "real" : "demonstração"}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{linha.execucoes}</td>
                    <td className="py-1.5 pr-3 font-mono">{formatarMoeda(linha.custo_usd_total)}</td>
                    <td className="py-1.5 pr-3">{formatarDataHora(linha.ultima_execucao_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
