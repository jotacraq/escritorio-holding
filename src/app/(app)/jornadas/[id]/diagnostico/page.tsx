"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useFicha360 } from "@/hooks/useFicha360";
import type { DiagnosticoSv as Diagnostico } from "@/types/cenario";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { EsqueletoFicha } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import { DiagnosticoSv } from "@/components/ficha360/DiagnosticoSv";
import { buscarDiagnostico } from "@/components/ficha360/api-diagnostico";
import { Apresentacao } from "@/components/croqui/Apresentacao";
import { slidesDoDiagnostico } from "./slides";

/**
 * Página própria do Diagnóstico da SV (Fase 4 §4.7). A mesma peça vive como
 * aba da Ficha 360; aqui ela ganha o "Apresentar" na hora — modo apresentação
 * SÓ com blocos marcados como visíveis ao cliente (os ocultos não entram no
 * DOM: o que a família vê é o que a advogada liberou, B31). `?apresentar=1`
 * abre direto em apresentação (é como a aba da Ficha chega aqui).
 */
export default function PaginaDiagnostico({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ficha, carregando, erro, recarregar } = useFicha360(id);
  const [apresentando, setApresentando] = useState<Diagnostico | null>(null);
  const [pedidoApresentar, setPedidoApresentar] = useState(false);

  useEffect(() => {
    // Leitura única da URL após montar (mesmo padrão de `useTema.ts`) —
    // `useSearchParams` exigiria Suspense só para isto.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPedidoApresentar(new URLSearchParams(window.location.search).get("apresentar") === "1");
  }, []);

  const sair = useCallback(() => {
    setApresentando(null);
    setPedidoApresentar(false);
    if (window.location.search.includes("apresentar=1")) history.replaceState(null, "", window.location.pathname);
  }, []);

  if (carregando && !ficha) return <EsqueletoFicha rotulo="Carregando o diagnóstico…" />;
  if (erro && !ficha) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar esta jornada" />;
  if (!ficha) return null;

  if (ficha.patrimonio === null) {
    return (
      <EstadoVazio
        titulo="Diagnóstico da SV indisponível para o seu perfil"
        descricao="Ele reúne patrimônio e cenário — só admin e advogada acessam."
        acao={
          <Link href={`/jornadas/${id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--latao)] underline underline-offset-2">
            Voltar à Ficha 360
          </Link>
        }
      />
    );
  }

  if (apresentando) {
    return <Apresentacao slides={slidesDoDiagnostico(apresentando)} titulo={`Diagnóstico · ${ficha.pessoa.nome}`} aoSair={sair} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoPagina
        rotulo="Cliente"
        titulo="Diagnóstico da SV"
        descricao={`${ficha.pessoa.nome} — a peça que a advogada apresenta depois da Sessão de Viabilidade, antes do Croqui.`}
        acima={
          <Link href={`/jornadas/${id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-tinta-suave hover:text-tinta">
            ← Ficha 360
          </Link>
        }
        meta={<Selo tom="neutro">Só o que você marcar fica visível ao cliente</Selo>}
      />
      <DiagnosticoSv jornadaId={id} aoApresentar={setApresentando} />
      {pedidoApresentar && <AbrirAoCarregar jornadaId={id} aoAbrir={setApresentando} />}
    </div>
  );
}

/**
 * `?apresentar=1`: quando o diagnóstico atual chega, abre a apresentação sem
 * um segundo clique. Componente separado para a busca acontecer uma vez só,
 * sem duplicar o estado de `DiagnosticoSv`.
 */
function AbrirAoCarregar({ jornadaId, aoAbrir }: { jornadaId: string; aoAbrir: (d: Diagnostico) => void }) {
  useEffect(() => {
    let vivo = true;
    buscarDiagnostico(jornadaId)
      .then((r) => {
        if (vivo && r.atual) aoAbrir(r.atual);
      })
      .catch(() => {
        /* a tela já mostra o estado real do diagnóstico */
      });
    return () => {
      vivo = false;
    };
  }, [jornadaId, aoAbrir]);
  return null;
}
