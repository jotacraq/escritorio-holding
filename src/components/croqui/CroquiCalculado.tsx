"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { CroquiCalculo, ResultadoCroqui } from "@/types/croqui-calculo";
import { calcularCroqui } from "@/server/motor-croqui";
import { useRecurso } from "@/hooks/useRecurso";
import { Botao } from "@/components/ui/Botao";
import { Gaveta } from "@/components/ui/Gaveta";
import { Selo, type TomSelo } from "@/components/ui/Selo";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { LinkBotao } from "@/components/painel/LinkBotao";
import { formatarDataHora } from "@/lib/formatar";
import { rotulo } from "@/lib/vocabulario";
import { buscarCroquiCalculo, fixarVersaoCroqui } from "./apiCroquiCalculo";
import { useToast } from "@/hooks/useToast";
import { BaixarRelatorio } from "./BaixarRelatorio";
import { ErroAoFixar } from "./ErroAoFixar";
import { TabelasCroqui } from "./TabelasCroqui";
import { useFixarCroqui } from "./useFixarCroqui";

/**
 * A tela do Croqui Estrutural: as 19 tabelas do método, calculadas.
 *
 * O `GET` traz a versão fixada (se houver), a entrada montada AGORA da ficha e
 * os parâmetros vigentes. O resultado "de hoje" é calculado NO NAVEGADOR pelo
 * mesmo motor do servidor — sem rede, sem segunda fonte de verdade. Fixar uma
 * versão continua sendo `POST`, e o servidor recalcula: número que passa pelo
 * navegador não vira croqui gravado.
 */

export interface CroquiCalculadoProps {
  jornadaId: string;
  /** Carimba a versão fixada com o croqui de origem, quando a tela veio de um. */
  croquiId?: string | null;
  /** Barra de voltar — quem abriu a tela decide para onde. */
  voltar?: { href: string; rotulo: string };
  /** Rotas irmãs. Ausente = o botão não aparece (nunca link quebrado). */
  hrefSimular?: string;
  hrefApresentar?: string;
}

/**
 * "A ficha mudou desde que a versão foi fixada", com saída antecipada: para
 * na primeira célula diferente, em vez de serializar duas vezes ~250 células
 * para descobrir que a primeira já não batia.
 */
function tabelasIguais(a: ResultadoCroqui["tabelas"], b: ResultadoCroqui["tabelas"]): boolean {
  const chaves = Object.keys(a) as Array<keyof typeof a>;
  if (chaves.length !== Object.keys(b).length) return false;

  for (const chave of chaves) {
    const ta = a[chave];
    const tb = b[chave];
    if (!ta || !tb || ta.linhas.length !== tb.linhas.length) return false;

    for (let i = 0; i < ta.linhas.length; i += 1) {
      const la = ta.linhas[i];
      const lb = tb.linhas[i];
      if (la.chave !== lb.chave) return false;
      for (const coluna of Object.keys(la.celulas)) {
        const ca = la.celulas[coluna];
        const cb = lb.celulas[coluna];
        if (!cb || ca.valor !== cb.valor || ca.procedencia !== cb.procedencia) return false;
      }
    }
  }
  return true;
}

export function CroquiCalculado({
  jornadaId,
  croquiId = null,
  voltar,
  hrefSimular,
  hrefApresentar,
}: CroquiCalculadoProps) {
  const buscar = useCallback(() => buscarCroquiCalculo(jornadaId), [jornadaId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [jornadaId]);
  const [versoesAbertas, setVersoesAbertas] = useState(false);
  const [fixandoVersao, setFixandoVersao] = useState<string | null>(null);
  const { notificar } = useToast();

  // "Fixar esta versão" numa versão anterior: o servidor troca o `atual` pela
  // RPC (0069) e a tela recarrega — a lista nunca fica sem ação (trava final).
  const fixarVersao = useCallback(
    async (calculoId: string, versao: number) => {
      setFixandoVersao(calculoId);
      try {
        const { ja_era_atual } = await fixarVersaoCroqui(jornadaId, calculoId);
        notificar({ tom: "sucesso", titulo: ja_era_atual ? `v${versao} já era a atual` : `v${versao} fixada como atual` });
        recarregar();
      } catch (e) {
        notificar({ tom: "erro", titulo: "Não deu para fixar esta versão", descricao: e instanceof Error ? e.message : "Tente de novo." });
      } finally {
        setFixandoVersao(null);
      }
    },
    [jornadaId, notificar, recarregar],
  );

  // O resultado de HOJE: recálculo puro, em memória, com a entrada da ficha.
  const vivo = useMemo<ResultadoCroqui | null>(
    () => (dados ? calcularCroqui(dados.entrada, dados.parametros) : null),
    [dados],
  );

  const desatualizado = useMemo(
    () => Boolean(dados?.atual && vivo && !tabelasIguais(dados.atual.resultado.tabelas, vivo.tabelas)),
    [dados, vivo],
  );

  const { fixar, fixando, erro: erroAoFixar } = useFixarCroqui({
    jornadaId,
    croquiId,
    aoFixar: recarregar,
  });

  if (carregando) return <EstadoCarregando rotulo="Calculando o croqui…" />;
  if (erro) {
    return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para calcular o croqui" />;
  }
  // Sem bem na ficha o motor ainda devolve as 19 tabelas — todas de travessão.
  // Dezesseis tabelas vazias não dizem à advogada o que fazer; uma linha diz.
  if (!dados || !vivo || dados.entrada.bens.length === 0) {
    return (
      <EstadoVazio
        titulo="Sem patrimônio na ficha"
        descricao="O croqui calcula a partir dos bens do cliente."
        acao={<LinkBotao href={`/jornadas/${jornadaId}#patrimonio`}>Cadastrar bens</LinkBotao>}
      />
    );
  }

  const { atual, historico } = dados;

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
          <EstadoDaVersao atual={atual} desatualizado={desatualizado} />
        </div>

        <div className="flex flex-wrap items-center gap-item">
          {hrefSimular && <LinkBotao href={hrefSimular}>Simular</LinkBotao>}
          {hrefApresentar && <LinkBotao href={hrefApresentar}>Apresentar</LinkBotao>}
          {/* O relatório sai da versão FIXADA (o que o `.docx` do M6 lê), não
              do recálculo vivo desta tela — por isso o botão se decide por
              `?info=1` e não pelo que está renderizado. */}
          {croquiId && <BaixarRelatorio croquiId={croquiId} />}
          {historico.length > 0 && (
            <Botao variante="fantasma" onClick={() => setVersoesAbertas(true)}>
              {historico.length} {historico.length === 1 ? "versão" : "versões"}
            </Botao>
          )}
          {/* Sem versão gravada o verbo é outro: o que a advogada quer é o
              croqui deste cliente existir. Depois que existe, o que ela faz é
              fixar a próxima versão. Mesma ação (`POST croqui-calculo`), o
              nome é que acompanha o estado. */}
          <Botao variante="primario" onClick={fixar} carregando={fixando}>
            {atual ? "Fixar versão" : "Calcular croqui"}
          </Botao>
        </div>
      </div>

      {erroAoFixar != null && <ErroAoFixar erro={erroAoFixar} />}

      <TabelasCroqui resultado={vivo} />

      <Gaveta
        aberta={versoesAbertas}
        aoFechar={() => setVersoesAbertas(false)}
        rotulo={rotulo("croqui")}
        titulo="Versões fixadas"
      >
        <ul className="flex flex-col gap-item">
          {historico.map((versao) => (
            <li
              key={versao.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-linha py-2 last:border-b-0"
            >
              <span className="text-sm font-medium text-tinta">
                v{versao.versao}
                {versao.atual && (
                  <span className="ml-2 align-middle">
                    <Selo tom="verde">Atual</Selo>
                  </span>
                )}
              </span>
              <time dateTime={versao.criado_em} className="text-xs text-tinta-fraca">
                {formatarDataHora(versao.criado_em)}
              </time>
              {!versao.atual && (
                <Botao
                  variante="secundario"
                  tamanho="compacto"
                  carregando={fixandoVersao === versao.id}
                  onClick={() => void fixarVersao(versao.id, versao.versao)}
                >
                  Fixar esta versão
                </Botao>
              )}
              {versao.nota && <p className="w-full text-xs text-tinta-suave">{versao.nota}</p>}
            </li>
          ))}
        </ul>
      </Gaveta>
    </div>
  );
}

function EstadoDaVersao({ atual, desatualizado }: { atual: CroquiCalculo | null; desatualizado: boolean }) {
  const selo: { tom: TomSelo; texto: string } = !atual
    ? { tom: "ambar", texto: "Não fixado" }
    : desatualizado
      ? { tom: "ambar", texto: "Ficha mudou" }
      : { tom: "verde", texto: `Fixado v${atual.versao}` };

  return (
    <span className="flex items-center gap-2">
      <Selo tom={selo.tom}>{selo.texto}</Selo>
      {atual && (
        <time dateTime={atual.criado_em} className="text-xs text-tinta-fraca">
          {desatualizado && `v${atual.versao} · `}
          {formatarDataHora(atual.criado_em)}
        </time>
      )}
    </span>
  );
}
