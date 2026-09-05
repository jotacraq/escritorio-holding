"use client";

import { useCallback, useMemo, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { useUsuarioAtual } from "@/hooks/useUsuarioAtual";
import { ApiError } from "@/lib/api";
import { resumoDoRadar } from "@/lib/radar/derivar";
import { formatarData } from "@/lib/formatar";
import type { EstadoItemRadar, ItemRadar } from "@/types/jornada-automacoes";
import { Botao } from "@/components/ui/Botao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { Selo, type TomSelo } from "@/components/ui/Selo";
import { buscarRadar, pedirDocumentos } from "./api-fase5";

/**
 * Radar de documentos (§1.5, §8.3) — a resposta à pergunta do João: "tem
 * documento X para enviar, documento Y". A lista é DERIVADA do patrimônio, da
 * família e do modelo do croqui (`src/lib/radar/derivar.ts`); o banco só
 * guarda o ato humano (pedido, conferência).
 *
 * Dois lados: **coleta** (o que falta o cliente mandar, com "Pedir agora") e
 * **entrega** (a pasta final, checklist de leitura). Lei de texto: número
 * primeiro no cabeçalho ("3 de 10 prontos"), item = rótulo + estado, um verbo
 * só na seção inteira.
 *
 * `pedidos_disponiveis: false` (0065 não aplicada) **esconde o botão** em vez
 * de oferecer uma ação que só falharia. A lista continua — ela é derivada e
 * não depende do banco novo.
 */

const ROTULO_ESTADO: Record<EstadoItemRadar, string> = {
  a_pedir: "A pedir",
  pedido: "Pedido",
  recebido: "Recebido",
  conferido: "Conferido",
};

const TOM_ESTADO: Record<EstadoItemRadar, TomSelo> = {
  a_pedir: "ambar",
  pedido: "azul",
  recebido: "verde",
  conferido: "verde",
};

const GLIFO_ESTADO: Record<EstadoItemRadar, React.ReactNode> = {
  a_pedir: <path d="M4 10h11.5M10.5 4.5L16 10l-5.5 5.5" />,
  pedido: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6.2v4l2.6 1.5" />
    </>
  ),
  recebido: <path d="M4.5 10.5l3.6 3.5 7.4-8" />,
  conferido: <path d="M3 10.5l3.2 3.2 6.6-7M10 14l1.2 1.2 6-6.6" />,
};

function IconeEstado({ estado }: { estado: EstadoItemRadar }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {GLIFO_ESTADO[estado]}
    </svg>
  );
}

export function RadarDocumentos({ jornadaId, aoAtualizar }: { jornadaId: string; aoAtualizar?: () => void }) {
  const { notificar } = useToast();
  const { usuario } = useUsuarioAtual();
  const buscar = useCallback(() => buscarRadar(jornadaId), [jornadaId]);
  const { dados, carregando, recarregar } = useRecurso(buscar, [jornadaId]);
  const [confirmando, setConfirmando] = useState(false);
  const [pedindo, setPedindo] = useState(false);

  const itens = useMemo<ItemRadar[]>(() => (dados?.estado === "ok" ? dados.dados.itens : []), [dados]);
  const coleta = useMemo(() => itens.filter((i) => i.lado === "coleta"), [itens]);
  const entrega = useMemo(() => itens.filter((i) => i.lado === "entrega"), [itens]);
  const aPedir = useMemo(() => coleta.filter((i) => i.estado === "a_pedir"), [coleta]);

  if (carregando || !dados) return null;

  if (dados.estado !== "ok") {
    // Sem `ve_patrimonio` a rota recusa — e o radar fala de bem e de família:
    // quem não vê patrimônio não pode nem saber que a lista existe.
    if (usuario?.papel !== "admin") return null;
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-cartao border border-linha bg-papel-elevado px-4 py-3">
        <h2 className="text-sm font-bold text-tinta">Documentos</h2>
        <span className="text-sm text-tinta-suave" title={dados.motivo}>
          Leitura indisponível
        </span>
      </section>
    );
  }

  const podePedir = dados.dados.pedidos_disponiveis && aPedir.length > 0;

  async function confirmarPedido() {
    setPedindo(true);
    try {
      const resposta = await pedirDocumentos(jornadaId, aPedir.map((i) => i.chave));
      const titulo = `${resposta.pedidos} ${resposta.pedidos === 1 ? "documento pedido" : "documentos pedidos"}`;
      notificar(
        resposta.enfileiradas > 0
          ? { tom: "sucesso", titulo, descricao: "O cliente recebeu o link de envio." }
          : { tom: "aviso", titulo, descricao: resposta.motivo ?? "Nenhuma mensagem nova na fila." },
      );
      setConfirmando(false);
      recarregar();
      aoAtualizar?.();
    } catch (e) {
      notificar({
        tom: "erro",
        titulo: "Não foi possível pedir os documentos",
        descricao: e instanceof ApiError ? e.message : "Confira a internet e tente de novo.",
      });
    } finally {
      setPedindo(false);
    }
  }

  return (
    <section aria-labelledby="radar-titulo" className="flex flex-col gap-cartao rounded-cartao border border-linha bg-papel-elevado px-4 py-3.5">
      <BlocoLado
        id="radar-titulo"
        titulo="Documentos"
        itens={coleta}
        lado="coleta"
        acao={
          podePedir ? (
            <Botao variante="primario" tamanho="compacto" onClick={() => setConfirmando(true)}>
              Pedir agora · {aPedir.length}
            </Botao>
          ) : null
        }
        vazio="Nada a pedir"
      />

      {entrega.length > 0 && <BlocoLado titulo="Pasta de entrega" itens={entrega} lado="entrega" acao={null} vazio="Sem itens de entrega" />}

      <ConfirmarAcao
        aberto={confirmando}
        titulo={aPedir.length === 1 ? "Pedir 1 documento ao cliente?" : `Pedir ${aPedir.length} documentos ao cliente?`}
        efeito={`O cliente recebe uma mensagem com um link de envio novo. O link de documentos anterior deixa de valer. ${aPedir.length === 1 ? "O item passa" : `Os ${aPedir.length} itens passam`} a constar como "Pedido" nesta lista.`}
        rotuloConfirmar="Pedir agora"
        rotuloCancelar="Agora não"
        confirmando={pedindo}
        aoConfirmar={confirmarPedido}
        aoCancelar={() => setConfirmando(false)}
      />
    </section>
  );
}

function BlocoLado({
  id,
  titulo,
  itens,
  lado,
  acao,
  vazio,
}: {
  id?: string;
  titulo: string;
  itens: ItemRadar[];
  lado: "coleta" | "entrega";
  acao: React.ReactNode;
  vazio: string;
}) {
  const { prontos, total } = resumoDoRadar(itens, lado);

  return (
    <div className="flex flex-col gap-item">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 id={id} className="text-sm font-bold text-tinta">
            {titulo}
          </h2>
          {total > 0 && (
            <span className="text-xs font-medium text-tinta-suave">
              {prontos} de {total} prontos
            </span>
          )}
        </div>
        {acao}
      </div>

      {itens.length === 0 ? (
        <p className="text-sm text-tinta-suave">{vazio}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-linha">
          {itens.map((item) => (
            <li key={item.chave} className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-tinta" title={item.trava.length > 0 ? `Trava: ${item.trava.join(", ")}` : undefined}>
                {item.rotulo}
                {!item.obrigatorio && <span className="text-tinta-fraca"> · opcional</span>}
              </span>
              {item.recebido_em && (
                <time dateTime={item.recebido_em} className="shrink-0 text-xs tabular-nums text-tinta-fraca">
                  {formatarData(item.recebido_em)}
                </time>
              )}
              <Selo
                tom={TOM_ESTADO[item.estado]}
                icone={<IconeEstado estado={item.estado} />}
                title={item.pedido_em ? `Pedido em ${formatarData(item.pedido_em)}` : undefined}
                className="shrink-0"
              >
                {ROTULO_ESTADO[item.estado]}
              </Selo>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
