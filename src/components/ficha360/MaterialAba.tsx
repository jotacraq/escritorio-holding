"use client";

import { useCallback, useState } from "react";
import { aprovarMaterial, gerarMaterial, listarMateriais, ErroFicha360Api } from "@/components/ficha360/api";
import type { BlocoMaterial, FonteDorMaterial } from "@/types/material";
import { useRecurso } from "@/hooks/useRecurso";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Botao } from "@/components/ui/Botao";
import { Selo, SeloDemonstracao, SeloIA } from "@/components/ui/Selo";
import { formatarDataHora } from "@/lib/formatar";

const ROTULOS_FONTE: Record<FonteDorMaterial, string> = {
  ligacao: "Registro da ligação (POP 03/03-B)",
  formulario: "Formulário (POP 02)",
  relatorio: "Relatório da Sessão de Viabilidade",
  nenhuma: "Nenhuma — material padrão",
};

function BlocoConteudo({ bloco, indice }: { bloco: BlocoMaterial; indice: number }) {
  switch (bloco.tipo) {
    case "titulo":
      return <h3 className="font-serif text-base font-bold text-tinta">{bloco.texto}</h3>;
    case "paragrafo":
      return <p className="text-sm leading-relaxed text-tinta">{bloco.texto}</p>;
    case "lista":
      return (
        <ul className="list-disc pl-5 text-sm text-tinta">
          {bloco.itens.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "citacao":
      return (
        <blockquote key={indice} className="border-l-4 border-latao bg-papel-fundo px-3 py-2 text-sm italic text-tinta-suave">
          “{bloco.texto}”
        </blockquote>
      );
  }
}

export function MaterialAba({ jornadaId }: { jornadaId: string }) {
  const buscar = useCallback(() => listarMateriais(jornadaId), [jornadaId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [jornadaId]);
  const [gerando, setGerando] = useState(false);
  const [aprovando, setAprovando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar o material" />;
  if (carregando) return <EstadoCarregando rotulo="Carregando material…" />;

  const atual = dados?.atual ?? null;
  const itens = dados?.itens ?? [];

  async function gerar(forcar: boolean) {
    setGerando(true);
    setErroAcao(null);
    try {
      await gerarMaterial(jornadaId, forcar);
      recarregar();
    } catch (e) {
      setErroAcao(e instanceof ErroFicha360Api ? e.message : "Não foi possível gerar o material.");
    } finally {
      setGerando(false);
    }
  }

  async function aprovar() {
    if (!atual) return;
    setAprovando(true);
    setErroAcao(null);
    try {
      await aprovarMaterial(jornadaId, atual.id);
      recarregar();
    } catch (e) {
      setErroAcao(e instanceof ErroFicha360Api ? e.message : "Não foi possível aprovar o material.");
    } finally {
      setAprovando(false);
    }
  }

  const conteudo = atual && (
    <div className="flex flex-col gap-3">
      {atual.conteudo.blocos.map((bloco, i) => (
        <BlocoConteudo key={i} bloco={bloco} indice={i} />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {atual?.origem_dado !== "exemplo" && <SeloIA />}
      <p role="note" className="rounded-sm border border-linha bg-papel-fundo px-3 py-2 text-xs text-tinta-suave">
        Material pós-sessão. A régua de mensagens <strong>não envia</strong> sem aprovação humana — enquanto não houver <code>aprovado_em</code>, este material fica pendente e não sai para o cliente.
      </p>

      {erroAcao && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erroAcao}</p>}

      <div className="flex flex-col gap-1.5">
        <div className="nao-imprimir flex flex-wrap gap-2">
          <Botao variante="secundario" carregando={gerando} onClick={() => gerar(false)}>
            {atual ? "Gerar nova versão" : "Gerar material"}
          </Botao>
          {atual && (
            <Botao variante="fantasma" className="text-xs" carregando={gerando} onClick={() => gerar(true)}>
              Forçar regeração
            </Botao>
          )}
        </div>
        {gerando && (
          <p role="status" className="text-xs text-tinta-suave">
            Gerando com IA — isso pode levar até 1 minuto. A tela não travou, aguarde.
          </p>
        )}
      </div>

      {!atual ? (
        <EstadoVazio titulo="Nenhum material gerado para esta jornada" descricao="Gerar cruza ligação, formulário e relatório para achar a dor principal do cliente — sem fonte, sai rotulado como material padrão." />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Selo tom="neutro">Versão {atual.versao}</Selo>
            <Selo tom={atual.aprovado_em ? "verde" : "azul"}>{atual.aprovado_em ? "Aprovado" : "Pendente de aprovação"}</Selo>
            <span className="text-xs text-tinta-fraca">Fonte da dor: {ROTULOS_FONTE[atual.fonte_dor]}</span>
          </div>
          {atual.dor_principal && <p className="text-sm text-tinta-suave">Dor identificada: “{atual.dor_principal}”</p>}

          {atual.origem_dado === "exemplo" ? <SeloDemonstracao>{conteudo}</SeloDemonstracao> : <div className="rounded-sm border border-linha bg-papel-elevado p-4">{conteudo}</div>}

          <div className="nao-imprimir flex items-center gap-3">
            {!atual.aprovado_em && (
              <Botao variante="primario" carregando={aprovando} onClick={aprovar}>
                Aprovar material
              </Botao>
            )}
            {atual.aprovado_em && <p className="text-xs text-tinta-fraca">Aprovado em {formatarDataHora(atual.aprovado_em)}</p>}
          </div>
        </div>
      )}

      {itens.length > 1 && (
        <div className="flex flex-col gap-1.5 border-t border-linha pt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-tinta-fraca">Histórico de versões</p>
          <ul className="flex flex-col gap-1">
            {itens.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 text-xs text-tinta-suave">
                <span className="font-medium text-tinta">v{item.versao}</span>
                <span>{ROTULOS_FONTE[item.fonte_dor]}</span>
                <span>{item.aprovado_em ? "aprovado" : "não aprovado"}</span>
                <span>{formatarDataHora(item.criado_em)}</span>
                {item.atual && <Selo tom="azul">atual</Selo>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
