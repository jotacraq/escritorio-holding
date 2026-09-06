"use client";

import { useCallback, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import { LinkBotao } from "@/components/ui/LinkBotao";
import type { Disponibilidade } from "@/types/agenda";
import { ApiError, atualizarDisponibilidade, listarDisponibilidades } from "./api";
import { ROTULO_DIA_SEMANA, formatarDataCalendario, formatarHoraSql } from "./rotulos";
import { FormularioDisponibilidade } from "./FormularioDisponibilidade";
import { SeletorAdvogada, useMembrosComAgenda } from "./SeletorAdvogada";
import { PreviaSlots } from "./PreviaSlots";

function LinhaDisponibilidade({ disponibilidade, aoAtualizar }: { disponibilidade: Disponibilidade; aoAtualizar: () => void }) {
  const { notificar } = useToast();
  const [ocupado, setOcupado] = useState(false);
  const rotulo = `${ROTULO_DIA_SEMANA[disponibilidade.dia_semana]} · ${formatarHoraSql(disponibilidade.hora_inicio)}–${formatarHoraSql(disponibilidade.hora_fim)}`;

  async function alternarAtiva() {
    setOcupado(true);
    const ativar = !disponibilidade.ativa;
    try {
      await atualizarDisponibilidade(disponibilidade.id, { ativa: ativar });
      notificar({ tom: "sucesso", titulo: ativar ? "Janela reativada" : "Janela desativada", descricao: rotulo });
      aoAtualizar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível atualizar esta janela", descricao: e instanceof ApiError ? e.message : "Confira a internet e tente de novo." });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-5 py-3 transition-colors duration-[var(--transicao-rapida)] hover:bg-papel sm:px-6">
      <div className="min-w-0">
        <p className="text-sm font-bold text-tinta">{rotulo}</p>
        <p className="text-xs text-tinta-suave">
          Sessões de {disponibilidade.duracao_minutos} min · vale de {formatarDataCalendario(disponibilidade.vale_de)}
          {disponibilidade.vale_ate ? ` até ${formatarDataCalendario(disponibilidade.vale_ate)}` : ", sem data de término"}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Selo tom={disponibilidade.ativa ? "verde" : "neutro"}>{disponibilidade.ativa ? "Ativa" : "Inativa"}</Selo>
        <Botao variante="secundario" tamanho="compacto" carregando={ocupado} onClick={alternarAtiva}>
          {disponibilidade.ativa ? "Desativar" : "Reativar"}
        </Botao>
      </div>
    </li>
  );
}

export function PainelDisponibilidade() {
  const membros = useMembrosComAgenda();
  const [advogadaId, setAdvogadaId] = useState("");

  const efetiva = advogadaId || membros?.[0]?.id || "";

  const buscar = useCallback(() => listarDisponibilidades({ advogada_id: efetiva || undefined }), [efetiva]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [efetiva]);

  // A prévia de slots é um componente à parte, com seu próprio fetch — criar
  // ou (des)ativar uma janela não muda as PROPS dela (mesma advogada, mesmo
  // período), então sem isto ela ficaria mostrando um cálculo desatualizado
  // até a página recarregar. `key` força remontar (= refazer o cálculo) só
  // quando algo aqui embaixo de fato muda.
  const [versaoSlots, setVersaoSlots] = useState(0);
  function aoMudarJanelas() {
    recarregar();
    setVersaoSlots((v) => v + 1);
  }

  if (membros === null) return <EsqueletoLista linhas={2} rotulo="Carregando equipe…" />;
  if (membros.length === 0) {
    return (
      <EstadoVazio
        ilustracao="pasta"
        titulo="Nenhum membro de equipe cadastrado"
        descricao="Cadastre a advogada em Administração → Equipe antes de configurar a agenda."
        acao={<LinkBotao href="/admin" variante="cta" tamanho="normal">Abrir Administração</LinkBotao>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-bloco">
      <SeletorAdvogada membros={membros} valor={efetiva} aoMudar={setAdvogadaId} id="disp-advogada" />

      {efetiva && (
        <>
          {/* Fase 6: o formulário de nova janela ocupava 390 px NO TOPO, todo
              dia, para uma ação que se faz uma vez por mês. Quem abre esta aba
              quer VER os dias em que a equipe atende; adicionar vem depois.
              `<details>` nativo: um clique, teclado e leitor de tela de graça. */}
          <details className="group rounded-cartao border border-linha bg-papel-elevado px-cartao py-item shadow-cartao">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-item marker:content-none">
              <span className="text-subtitulo font-bold text-tinta">Adicionar um dia de atendimento</span>
              <span aria-hidden="true" className="text-xs text-tinta-fraca group-open:hidden">
                abrir
              </span>
              <span aria-hidden="true" className="hidden text-xs text-tinta-fraca group-open:inline">
                fechar
              </span>
            </summary>
            <div className="pt-item">
              <FormularioDisponibilidade advogadaId={efetiva} aoCriar={aoMudarJanelas} />
            </div>
          </details>

          <Cartao rotulo="Janelas" titulo="Janelas de atendimento" descricao="Desativar tira os horários das opções do cliente sem apagar o histórico." preenchimento="sem">
            {carregando && !dados && (
              <div className="p-5 sm:p-6">
                <EsqueletoLista linhas={3} rotulo="Carregando janelas…" />
              </div>
            )}
            {Boolean(erro) && (
              <div className="p-5 sm:p-6">
                <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para carregar as janelas" />
              </div>
            )}
            {!erro && dados && dados.disponibilidades.length === 0 && (
              <div className="p-5 sm:p-6">
                <EstadoVazio compacto titulo="Nenhuma janela de disponibilidade" descricao="Adicione ao menos uma janela acima para que o link de agendamento tenha horário para oferecer." />
              </div>
            )}
            {!erro && dados && dados.disponibilidades.length > 0 && (
              <ul className="divide-y divide-linha">
                {dados.disponibilidades.map((d) => (
                  <LinhaDisponibilidade key={d.id} disponibilidade={d} aoAtualizar={aoMudarJanelas} />
                ))}
              </ul>
            )}
          </Cartao>

          <PreviaSlots key={versaoSlots} advogadaId={efetiva} />
        </>
      )}
    </div>
  );
}
