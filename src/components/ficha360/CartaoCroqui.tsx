"use client";

import type { EstadoCroquiDaJornada } from "@/hooks/useCroquiDaJornada";
import type { EventoTimeline } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { LinkBotao } from "@/components/ui/LinkBotao";
import { EstadoCarregando } from "@/components/ui/Estado";
import { SeloEstado } from "@/components/ui/SeloEstado";
import { formatarData } from "@/lib/formatar";
import { proximaFaseDoCroqui, type CroquiFase, type CroquiFatos } from "@/lib/pasta/sinais";
import { BlocoRecolhivel } from "./BlocoRecolhivel";
import { AndamentosCroqui } from "./AndamentosCroqui";
import { rotaCroquiApresentar, rotaCroquiSimular, rotaCroquiVer } from "./rotas-croqui";

/**
 * O croqui, resumido, dentro da Ficha — e o botão que abre a tela dele.
 *
 * Fase 6: a aba "Croqui" media **~8.600 px** de altura DENTRO da Ficha (as 19
 * tabelas do motor renderizadas inteiras). Ela era sozinha a maior parte do
 * documento. As três telas do croqui já existem em `/croquis/[id]` — a Ficha
 * não precisa ser a quarta.
 *
 * Fase 8 (D12/D14): o cartão dizia só "existe ou não existe". Agora diz **em
 * que fase está** (`SeloEstado`, do catálogo — sem cor escolhida aqui), **o
 * que falta para a próxima fase** com o botão que leva lá, os dois FATOS
 * (exportado / narrado) como chip ao lado, e os **Andamentos do croqui**
 * datados. A pergunta do João — "quero saber o status do croqui, o sistema
 * indica o que está acontecendo" — é respondida sem sair da Ficha.
 */
export function CartaoCroqui({
  estadoCroqui,
  recolhivel = false,
  fase = null,
  fatos = null,
  timeline = [],
}: {
  estadoCroqui: EstadoCroquiDaJornada;
  /**
   * Fase 7: na Ficha o cartão vive dentro de um `<details>` que nasce fechado.
   * O estado do croqui vai para o cabeçalho do recolhido — quem precisa dos
   * destinos abre.
   */
  recolhivel?: boolean;
  /**
   * A fase de `faseDoCroqui(sinais)` — uma derivação só, a mesma da lista de
   * Clientes e do trilho. `null` = sem informação, e o selo diz isso.
   */
  fase?: CroquiFase | null;
  /** `exportado`/`narrado`: fatos, não fases. */
  fatos?: CroquiFatos | null;
  /** Timeline já carregada pela Ficha — nenhuma requisição nova. */
  timeline?: EventoTimeline[];
}) {
  const { croqui, croquiAtual, carregandoCroqui, croquiInexistente, criando, erroCriar, iniciarCroqui } = estadoCroqui;

  if (croqui === undefined && carregandoCroqui) return <EstadoCarregando rotulo="Carregando o croqui…" />;

  // Sem `fase` na prop (a tela ainda não passa a derivação completa), o cartão
  // NÃO fica mudo: cai no estado editorial do próprio croqui carregado, que é
  // o que ele já sabia antes da Fase 8. `rascunho`/`pronto`/`apresentado` são
  // chaves válidas do catálogo — o que se perde é a distinção
  // `calculado`/`fixado`, que só a view conhece. Degradar é dizer menos, nunca
  // dizer errado.
  const faseEfetiva: CroquiFase | null = fase ?? (croquiAtual ? (croquiAtual.status as CroquiFase) : "sem_croqui");
  const proxima = proximaFaseDoCroqui(faseEfetiva);
  const hrefCroqui = croquiAtual ? rotaCroquiVer(croquiAtual.id) : null;

  // O resumo do recolhido é o RÓTULO DA FASE, não o título do documento: quem
  // olha a Ficha fechada quer saber em que pé está, não como se chama o
  // arquivo. Sem fase (sem informação), cai no título, que é o que havia antes.
  const envolver = (conteudo: React.ReactNode, resumo: string) =>
    recolhivel ? (
      <BlocoRecolhivel titulo="Croqui estrutural" resumo={resumo}>
        {conteudo}
      </BlocoRecolhivel>
    ) : (
      conteudo
    );

  const selo = <SeloEstado dominio="croqui" estado={faseEfetiva} />;

  const chipsDeFato = (
    <>
      {fatos?.exportadoEm && (
        <SeloEstado dominio="croqui_fato" estado="exportado" detalhe={`Baixado em ${formatarData(fatos.exportadoEm)}`} />
      )}
      {fatos?.narradoEm && <SeloEstado dominio="croqui_fato" estado="narrado" detalhe={`Gerada em ${formatarData(fatos.narradoEm)}`} />}
    </>
  );

  if (!croquiAtual) {
    return envolver(
      <Cartao
        como="section"
        rotulo="Croqui estrutural"
        titulo="Ainda não começou"
        preenchimento="compacto"
        acao={
          <Botao variante="primario" tamanho="compacto" carregando={criando} onClick={iniciarCroqui}>
            Começar o croqui
          </Botao>
        }
      >
        <div className="flex flex-col gap-item">
          <div className="flex flex-wrap items-center gap-1.5">{selo}</div>
          {/* Affordance, não tutorial: a frase diz o que falta e o botão ao
              lado faz. Nada de "clique aqui para…". */}
          <p className="text-sm text-tinta-suave">
            {proxima?.falta ?? "Não há croqui para este processo — o croqui nasce depois da Sessão de Viabilidade."}
          </p>
          {erroCriar && (
            <p role="alert" className="text-sm text-[color:var(--vermelho)]">
              {erroCriar}
            </p>
          )}
          {croquiInexistente && (
            <p className="text-legenda text-tinta-suave" title="A linha do tempo aponta para um croqui que não existe mais no banco.">
              Havia um registro de croqui que não está mais no sistema.
            </p>
          )}
          <AndamentosCroqui eventos={timeline} fase={faseEfetiva} hrefCroqui={null} />
        </div>
      </Cartao>,
      "ainda não começou",
    );
  }

  return envolver(
    <Cartao
      como="section"
      rotulo="Croqui estrutural"
      titulo={croquiAtual.titulo ?? "Croqui"}
      preenchimento="compacto"
      acao={
        <div className="nao-imprimir flex flex-wrap items-center gap-2">
          <LinkBotao href={rotaCroquiSimular(croquiAtual.id)} variante="fantasma">
            Simular
          </LinkBotao>
          <LinkBotao href={rotaCroquiApresentar(croquiAtual.id)} variante="secundario">
            Apresentar
          </LinkBotao>
          <LinkBotao href={rotaCroquiVer(croquiAtual.id)} variante="cta">
            Abrir croqui
          </LinkBotao>
        </div>
      }
    >
      <div className="flex flex-col gap-item">
        <div className="flex flex-wrap items-center gap-1.5">
          {selo}
          {chipsDeFato}
        </div>
        {proxima && <p className="text-sm text-tinta-suave">{proxima.falta}</p>}
        <p className="text-sm text-tinta-suave">Os números do croqui e o material para o cliente ficam na tela do croqui.</p>
        <AndamentosCroqui eventos={timeline} fase={faseEfetiva} hrefCroqui={hrefCroqui} />
      </div>
    </Cartao>,
    faseEfetiva ? RESUMO_POR_FASE[faseEfetiva] : (croquiAtual.titulo ?? "croqui aberto"),
  );
}

/** O resumo do `<details>` fechado: a fase em duas palavras, minúsculas. */
const RESUMO_POR_FASE: Record<CroquiFase, string> = {
  sem_croqui: "ainda não começou",
  rascunho: "em rascunho",
  calculado: "calculado",
  fixado: "versão fixada",
  pronto: "pronto para apresentar",
  apresentado: "apresentado",
};
