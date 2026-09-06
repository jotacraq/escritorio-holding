"use client";

import type { EstadoCroquiDaJornada } from "@/hooks/useCroquiDaJornada";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { LinkBotao } from "@/components/ui/LinkBotao";
import { EstadoCarregando } from "@/components/ui/Estado";
import { BlocoRecolhivel } from "./BlocoRecolhivel";
import { rotaCroquiApresentar, rotaCroquiSimular, rotaCroquiVer } from "./rotas-croqui";

/**
 * O croqui, resumido, dentro da Ficha — e o botão que abre a tela dele.
 *
 * Fase 6: a aba "Croqui" media **~8.600 px** de altura DENTRO da Ficha (as 19
 * tabelas do motor renderizadas inteiras, medido na trava da Fase 5). Ela era
 * sozinha a maior parte do documento e o principal motivo de a Ficha não caber
 * na meta de altura. As três telas do croqui já existem em `/croquis/[id]` —
 * a Ficha não precisa ser a quarta.
 *
 * O que fica aqui: existe croqui? e os três destinos (abrir, apresentar,
 * simular). O que sai: o DOM das 19 tabelas em toda abertura de Ficha.
 * Nenhuma funcionalidade perdida, uma navegação a mais de um clique.
 */
export function CartaoCroqui({
  estadoCroqui,
  recolhivel = false,
}: {
  estadoCroqui: EstadoCroquiDaJornada;
  /**
   * Fase 7: na Ficha o cartão vive dentro de um `<details>` que nasce fechado.
   * O estado do croqui (nome da versão, ou "ainda não começou") vai para o
   * cabeçalho do recolhido — quem precisa dos três destinos abre.
   */
  recolhivel?: boolean;
}) {
  const { croqui, croquiAtual, carregandoCroqui, croquiInexistente, criando, erroCriar, iniciarCroqui } = estadoCroqui;

  if (croqui === undefined && carregandoCroqui) return <EstadoCarregando rotulo="Carregando o croqui…" />;

  const envolver = (conteudo: React.ReactNode, resumo: string) =>
    recolhivel ? (
      <BlocoRecolhivel titulo="Croqui estrutural" resumo={resumo}>
        {conteudo}
      </BlocoRecolhivel>
    ) : (
      conteudo
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
      <p className="text-sm text-tinta-suave">Os números do croqui e o material para o cliente ficam na tela do croqui.</p>
    </Cartao>,
    croquiAtual.titulo ?? "croqui aberto",
  );
}
