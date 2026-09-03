"use client";

import { useCallback, useState } from "react";
import { acharCroquiIdNaTimeline, buscarCroquiPorId, criarCroqui, ApiError, type Croqui, type EventoTimeline } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { criarEsqueletoSlides } from "@/lib/croqui";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { Botao } from "@/components/ui/Botao";
import { EditorCroqui } from "@/components/croqui/EditorCroqui";

export function CroquiAba({ jornadaId, timeline }: { jornadaId: string; timeline: EventoTimeline[] }) {
  const croquiId = acharCroquiIdNaTimeline(timeline);
  const buscar = useCallback(() => (croquiId ? buscarCroquiPorId(croquiId).then((r) => r.croqui) : Promise.resolve(null)), [croquiId]);
  const { dados: croqui, carregando, erro, recarregar } = useRecurso(buscar, [croquiId]);
  const [criando, setCriando] = useState(false);
  const [erroCriar, setErroCriar] = useState<string | null>(null);
  const [croquiRecemCriado, setCroquiRecemCriado] = useState<Croqui | null>(null);

  if (carregando) return <EstadoCarregando rotulo="Carregando croqui…" />;
  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} />;

  const croquiAtual = croquiRecemCriado ?? croqui ?? null;

  if (!croquiAtual) {
    async function criar() {
      setCriando(true);
      setErroCriar(null);
      try {
        const res = await criarCroqui(jornadaId, { titulo: "Croqui Estrutural", conteudo: { slides: criarEsqueletoSlides() } });
        // A timeline só ganha o evento no próximo carregamento da Ficha 360;
        // mostramos o croqui recém-criado direto da resposta do POST.
        setCroquiRecemCriado(res.croqui);
      } catch (e) {
        setErroCriar(e instanceof ApiError ? e.message : "Não foi possível criar o croqui.");
      } finally {
        setCriando(false);
      }
    }
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-tinta-suave">Nenhum croqui iniciado para esta jornada. Criar monta o esqueleto dos 13 slides do método.</p>
        {erroCriar && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erroCriar}</p>}
        <Botao variante="primario" carregando={criando} onClick={criar}>Iniciar croqui</Botao>
      </div>
    );
  }

  return <EditorCroqui jornadaId={jornadaId} croqui={croquiAtual} aoAtualizar={recarregar} />;
}
