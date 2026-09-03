"use client";

import { useCallback, useState } from "react";
import { buscarFormulario, salvarFormulario, ApiError, type FormularioComResposta, type FormularioDefinicaoPergunta } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Botao } from "@/components/ui/Botao";
import { formatarDataHora } from "@/lib/formatar";

/** Avalia a condicional de uma pergunta (ex.: P11 só aparece se P10 incluir "Imóveis"). */
function perguntaVisivel(pergunta: FormularioDefinicaoPergunta, respostas: Record<string, unknown>): boolean {
  if (!pergunta.condicional) return true;
  const valorDependido = respostas[pergunta.condicional.depende_de];
  if (pergunta.condicional.igual !== undefined) return valorDependido === pergunta.condicional.igual;
  if (pergunta.condicional.contem !== undefined) {
    const lista = Array.isArray(valorDependido) ? valorDependido : [];
    return lista.includes(pergunta.condicional.contem);
  }
  return true;
}

function CampoPergunta({
  pergunta,
  valor,
  aoMudar,
}: {
  pergunta: FormularioDefinicaoPergunta;
  valor: unknown;
  aoMudar: (valor: unknown) => void;
}) {
  const idCampo = `pergunta-${pergunta.id}`;
  switch (pergunta.tipo) {
    case "texto":
      return <input id={idCampo} type="text" value={(valor as string) ?? ""} onChange={(e) => aoMudar(e.target.value)} className="w-full rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm" />;
    case "numero":
      return <input id={idCampo} type="number" value={(valor as number) ?? ""} onChange={(e) => aoMudar(e.target.value === "" ? null : Number(e.target.value))} className="w-40 rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm" />;
    case "texto_longo":
      return <textarea id={idCampo} rows={3} value={(valor as string) ?? ""} onChange={(e) => aoMudar(e.target.value)} className="w-full rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm" />;
    case "sim_nao":
      return (
        <div role="radiogroup" aria-labelledby={`${idCampo}-rotulo`} className="flex gap-4">
          {(["sim", "nao"] as const).map((opcao) => (
            <label key={opcao} className="flex items-center gap-2 text-sm text-tinta">
              <input type="radio" name={idCampo} checked={valor === opcao} onChange={() => aoMudar(opcao)} className="h-4 w-4 accent-[color:var(--latao)]" />
              {opcao === "sim" ? "Sim" : "Não"}
            </label>
          ))}
        </div>
      );
    case "unica":
      return (
        <div role="radiogroup" aria-labelledby={`${idCampo}-rotulo`} className="flex flex-col gap-1.5">
          {(pergunta.opcoes ?? []).map((opcao) => (
            <label key={opcao} className="flex items-center gap-2 text-sm text-tinta">
              <input type="radio" name={idCampo} checked={valor === opcao} onChange={() => aoMudar(opcao)} className="h-4 w-4 accent-[color:var(--latao)]" />
              {opcao}
            </label>
          ))}
        </div>
      );
    case "multipla": {
      const selecionadas = Array.isArray(valor) ? (valor as string[]) : [];
      return (
        <div className="flex flex-col gap-1.5">
          {(pergunta.opcoes ?? []).map((opcao) => (
            <label key={opcao} className="flex items-center gap-2 text-sm text-tinta">
              <input
                type="checkbox"
                checked={selecionadas.includes(opcao)}
                onChange={(e) => aoMudar(e.target.checked ? [...selecionadas, opcao] : selecionadas.filter((o) => o !== opcao))}
                className="h-4 w-4 rounded-sm accent-[color:var(--latao)]"
              />
              {opcao}
            </label>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}

/** Estado editável nasce do prop via lazy initializer — sem efeito de sincronização. */
function FormularioConteudo({ jornadaId, dados }: { jornadaId: string; dados: FormularioComResposta }) {
  const [respostas, setRespostas] = useState<Record<string, unknown>>(() => dados.resposta?.respostas ?? {});
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);

  const blocos = new Map<string, FormularioDefinicaoPergunta[]>();
  for (const pergunta of dados.formulario.definicao) {
    if (!perguntaVisivel(pergunta, respostas)) continue;
    if (!blocos.has(pergunta.bloco)) blocos.set(pergunta.bloco, []);
    blocos.get(pergunta.bloco)!.push(pergunta);
  }

  async function salvar() {
    setSalvando(true);
    setErroSalvar(null);
    try {
      const res = await salvarFormulario(jornadaId, { formulario_id: dados.formulario.id, respostas });
      setSalvoEm(res.resposta.respondido_em);
    } catch (e) {
      setErroSalvar(e instanceof ApiError ? e.message : "Não foi possível salvar as respostas.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-tinta-fraca">
          POP 02 · versão {dados.formulario.versao}
          {dados.resposta && ` · respondido em ${formatarDataHora(dados.resposta.respondido_em)}`}
        </p>
        {dados.resposta?.origem === "typeform" && (
          <span className="rounded-sm border border-linha bg-papel-fundo px-2 py-0.5 text-[11px] text-tinta-suave">Importado do Typeform</span>
        )}
      </div>

      {Array.from(blocos.entries()).map(([bloco, perguntas]) => (
        <fieldset key={bloco} className="flex flex-col gap-4 border-t border-linha pt-4 first:border-t-0 first:pt-0">
          <legend className="font-serif text-base font-semibold text-tinta">{bloco}</legend>
          {perguntas.map((pergunta) => (
            <div key={pergunta.id} className="flex flex-col gap-1.5">
              <label id={`pergunta-${pergunta.id}-rotulo`} htmlFor={`pergunta-${pergunta.id}`} className="text-sm font-medium text-tinta">
                {pergunta.rotulo}
                {pergunta.obrigatoria && <span aria-hidden="true" className="text-[color:var(--vermelho)]"> *</span>}
              </label>
              <CampoPergunta pergunta={pergunta} valor={respostas[pergunta.id]} aoMudar={(v) => setRespostas((r) => ({ ...r, [pergunta.id]: v }))} />
            </div>
          ))}
        </fieldset>
      ))}

      {erroSalvar && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erroSalvar}</p>}
      {salvoEm && !erroSalvar && <p role="status" className="text-sm text-[color:var(--verde)]">Respostas salvas.</p>}

      <div className="nao-imprimir">
        <Botao variante="primario" carregando={salvando} onClick={salvar}>
          Salvar respostas
        </Botao>
      </div>
    </div>
  );
}

export function FormularioAba({ jornadaId }: { jornadaId: string }) {
  const buscar = useCallback(() => buscarFormulario(jornadaId), [jornadaId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [jornadaId]);

  if (carregando) return <EstadoCarregando rotulo="Carregando formulário estratégico…" />;
  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} />;
  if (!dados) return <EstadoVazio titulo="Formulário estratégico indisponível" descricao="Nenhuma definição ativa de formulário foi encontrada." />;

  return <FormularioConteudo key={jornadaId} jornadaId={jornadaId} dados={dados} />;
}
