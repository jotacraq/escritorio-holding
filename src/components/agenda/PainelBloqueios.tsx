"use client";

import { useCallback, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { formatarDataHora } from "@/lib/formatar";
import { LinkBotao } from "@/components/painel/LinkBotao";
import type { AgendaBloqueio } from "@/types/agenda";
import { ApiError, cancelarBloqueio, listarBloqueios } from "./api";
import { FormularioBloqueio } from "./FormularioBloqueio";
import { SeletorAdvogada, useMembrosComAgenda } from "./SeletorAdvogada";

function LinhaBloqueio({ bloqueio, aoAtualizar }: { bloqueio: AgendaBloqueio; aoAtualizar: () => void }) {
  const { notificar } = useToast();
  const [ocupado, setOcupado] = useState(false);

  async function cancelar() {
    setOcupado(true);
    try {
      await cancelarBloqueio(bloqueio.id);
      notificar({ tom: "sucesso", titulo: "Bloqueio cancelado", descricao: "O período volta a aparecer como horário livre." });
      aoAtualizar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível cancelar este bloqueio", descricao: e instanceof ApiError ? e.message : "Confira a internet e tente de novo." });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-5 py-3 transition-colors duration-[var(--transicao-rapida)] hover:bg-papel sm:px-6">
      <div className="min-w-0">
        <p className="text-sm font-bold text-tinta">
          {formatarDataHora(bloqueio.inicio_em)} — {formatarDataHora(bloqueio.fim_em)}
        </p>
        <p className="text-xs text-tinta-suave">{bloqueio.motivo}</p>
      </div>
      {!bloqueio.cancelado_em ? (
        <Botao variante="perigo" tamanho="compacto" carregando={ocupado} onClick={cancelar}>
          Cancelar bloqueio
        </Botao>
      ) : (
        <span className="text-xs text-tinta-fraca">Cancelado em {formatarDataHora(bloqueio.cancelado_em)}</span>
      )}
    </li>
  );
}

/** Folga, feriado, compromisso fora da agenda — baixa por cancelamento
 * (`cancelado_em`), nunca apagando (mesma convenção do schema inteiro). */
export function PainelBloqueios() {
  const membros = useMembrosComAgenda();
  const [advogadaId, setAdvogadaId] = useState("");
  const efetiva = advogadaId || membros?.[0]?.id || "";

  const buscar = useCallback(() => listarBloqueios({ advogada_id: efetiva || undefined }), [efetiva]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [efetiva]);

  if (membros === null) return <EsqueletoLista linhas={2} rotulo="Carregando equipe…" />;
  if (membros.length === 0) {
    return (
      <EstadoVazio
        ilustracao="pasta"
        titulo="Nenhum membro de equipe cadastrado"
        descricao="Cadastre a advogada em Administração → Equipe antes de configurar bloqueios."
        acao={<LinkBotao href="/admin" variante="cta" tamanho="normal">Abrir Administração</LinkBotao>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SeletorAdvogada membros={membros} valor={efetiva} aoMudar={setAdvogadaId} id="bloq-advogada" />

      {efetiva && (
        <>
          <FormularioBloqueio advogadaId={efetiva} aoCriar={recarregar} />

          <Cartao rotulo="Bloqueios" titulo="Períodos bloqueados" descricao="Cancelar um bloqueio devolve o período aos horários livres." preenchimento="sem">
            {carregando && !dados && (
              <div className="p-5 sm:p-6">
                <EsqueletoLista linhas={2} rotulo="Carregando bloqueios…" />
              </div>
            )}
            {Boolean(erro) && (
              <div className="p-5 sm:p-6">
                <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para carregar os bloqueios" />
              </div>
            )}
            {!erro && dados && dados.bloqueios.length === 0 && (
              <div className="p-5 sm:p-6">
                <EstadoVazio compacto titulo="Nenhum bloqueio ativo" descricao="Toda a disponibilidade das janelas está de pé, sem exceção." />
              </div>
            )}
            {!erro && dados && dados.bloqueios.length > 0 && (
              <ul className="divide-y divide-linha">
                {dados.bloqueios.map((b) => (
                  <LinhaBloqueio key={b.id} bloqueio={b} aoAtualizar={recarregar} />
                ))}
              </ul>
            )}
          </Cartao>
        </>
      )}
    </div>
  );
}
