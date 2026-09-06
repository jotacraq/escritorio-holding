"use client";

import { useState } from "react";
import { revogarLink, ErroFicha360Api } from "@/components/ficha360/api";
import type { LinkPublicoResumo } from "@/types/publico";
import { EstadoVazio } from "@/components/ui/Estado";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { formatarDataHora } from "@/lib/formatar";
import { ROTULO_ENVIO } from "@/lib/pasta/envios";

/**
 * O histórico de links de uma jornada — quem foi emitido, quando, quantos usos
 * e o botão de revogar.
 *
 * Fase 6 (F7): esta tela **perdeu os botões de emissão** e o próprio fetch.
 * Quem emite é a barra "Enviar" (`BarraEnviar`), que também é quem busca a
 * listagem e a passa por prop. Motivo: havia dois caminhos para gerar o mesmo
 * link — e emitir revoga o anterior, então dois caminhos significam duas
 * formas de quebrar em silêncio um link que já está no WhatsApp do cliente.
 * **Um caminho de emissão na UI, não dois.**
 *
 * Saiu junto o segundo fetch de `listarMateriais` (B7): a aprovação do
 * material vem de `ficha.materialAtual.aprovado_em`, que já está no payload da
 * Ficha, e quem lê isso agora é `derivarEnvios`. Uma requisição a menos por
 * abertura da Ficha.
 */

function tomEstado(estado: LinkPublicoResumo["estado"]): "verde" | "vermelho" | "azul" | "neutro" {
  if (estado === "ativo") return "verde";
  if (estado === "usado") return "azul";
  return "neutro";
}

const ROTULOS_ESTADO: Record<LinkPublicoResumo["estado"], string> = {
  ativo: "Ativo",
  usado: "Usado",
  expirado: "Expirado",
  revogado: "Revogado",
};

/** Nome do link na tela — o mesmo dicionário que a barra "Enviar" usa. */
function rotuloDoTipo(tipo: string): string {
  return (ROTULO_ENVIO as Record<string, string>)[tipo] ?? tipo;
}

export function LinksAba({ links, aoAtualizar }: { links: readonly LinkPublicoResumo[]; aoAtualizar: () => void }) {
  const [revogando, setRevogando] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [linkParaRevogar, setLinkParaRevogar] = useState<LinkPublicoResumo | null>(null);

  async function revogar(id: string) {
    setRevogando(id);
    setErroAcao(null);
    try {
      await revogarLink(id);
      aoAtualizar();
    } catch (e) {
      setErroAcao(e instanceof ErroFicha360Api ? e.message : "Não foi possível revogar o link.");
    } finally {
      setRevogando(null);
    }
  }

  function confirmarRevogacao() {
    if (!linkParaRevogar) return;
    const id = linkParaRevogar.id;
    setLinkParaRevogar(null);
    revogar(id);
  }

  return (
    <div className="nao-imprimir flex flex-col gap-item">
      <p className="text-xs text-tinta-fraca">
        O endereço completo aparece <strong>uma única vez</strong>, na hora em que é gerado. Aqui fica só o começo dele.
      </p>

      {erroAcao && (
        <p role="alert" className="text-sm text-[color:var(--vermelho)]">
          {erroAcao}
        </p>
      )}

      {links.length === 0 ? (
        <EstadoVazio compacto titulo="Nenhum link enviado ainda" descricao="Use a barra Enviar, na ficha, para gerar o primeiro." />
      ) : (
        <ul className="flex flex-col gap-item">
          {links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 rounded-controle border border-linha bg-papel-fundo px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-tinta">
                  {rotuloDoTipo(link.tipo)} <span className="font-mono text-xs text-tinta-fraca">({link.token_prefixo}…)</span>
                </p>
                <p className="text-xs text-tinta-fraca">
                  Gerado em {formatarDataHora(link.criado_em)} · expira em {formatarDataHora(link.expira_em)} · {link.usos} uso(s)
                  {link.revogado_em && ` · revogado em ${formatarDataHora(link.revogado_em)}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Selo tom={tomEstado(link.estado)}>{ROTULOS_ESTADO[link.estado]}</Selo>
                {link.estado === "ativo" && (
                  <Botao variante="perigo" tamanho="compacto" carregando={revogando === link.id} onClick={() => setLinkParaRevogar(link)}>
                    Revogar
                  </Botao>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmarAcao
        aberto={linkParaRevogar !== null}
        titulo="Revogar este link?"
        efeito={
          linkParaRevogar
            ? `O cliente não consegue mais abrir o link ${rotuloDoTipo(linkParaRevogar.tipo).toLowerCase()} (${linkParaRevogar.token_prefixo}…). Para ele acessar de novo, é preciso gerar um link novo.`
            : ""
        }
        rotuloConfirmar="Revogar"
        confirmando={revogando !== null}
        perigo
        aoConfirmar={confirmarRevogacao}
        aoCancelar={() => setLinkParaRevogar(null)}
      />
    </div>
  );
}
