"use client";

import { useCallback, useState } from "react";
import type { AberturaMaterialPublico, BlocoMaterialPublico, EstadoPdfMaterialPublico } from "@/types/publico-ui";
import { abrirLinkMaterial, baixarPdfMaterialPublico, conferirTipo, ErroLinkPublico } from "@/components/publico/cliente";
import { useRecurso } from "@/hooks/useRecurso";
import { CarregandoPublico, ErroTemporarioPublico } from "@/components/publico/CarregandoPublico";
import { TelaLinkInvalido } from "@/components/publico/TelaLinkInvalido";
import { BotaoPublico, CartaoPublico, RotuloPublico } from "@/components/publico/atomos";
import { formatarData } from "@/lib/formatar";

function BlocoConteudo({ bloco }: { bloco: BlocoMaterialPublico }) {
  switch (bloco.tipo) {
    case "titulo":
      return <h2 className="mt-2 text-subtitulo font-bold text-tinta">{bloco.texto}</h2>;
    case "paragrafo":
      return <p className="leading-relaxed text-tinta">{bloco.texto}</p>;
    case "lista":
      return (
        <ul className="flex flex-col gap-2 pl-1 leading-relaxed text-tinta">
          {bloco.itens.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden="true" className="mt-[0.7em] h-2 w-2 shrink-0 rounded-full bg-[color:var(--latao-cta)]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "citacao":
      return <blockquote className="border-l-4 border-[color:var(--latao-cta)] py-1 pl-4 italic text-tinta-suave">{bloco.texto}</blockquote>;
    default:
      return null;
  }
}

const IconeBaixar = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 fill-none stroke-current stroke-2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 3v10m0 0 4-4m-4 4-4-4M4 16h12" />
  </svg>
);
const IconeImprimir = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 fill-current">
    <path d="M5 2h10v5H5V2Zm-2 6h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2v2H5v-2H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm4 8v2h6v-2H7Z" />
  </svg>
);

/**
 * "Baixar PDF" só pergunta ao servidor NO CLIQUE (cada chamada gera URL assinada
 * e linha de auditoria). Quando a rota diz que não há arquivo (409) ou que o
 * envio está fora do ar (503), o botão sai da tela e o texto diz a verdade —
 * imprimir a página continua sendo o caminho (material aprovado antes da
 * Fase 4 nunca terá PDF).
 */
function AcoesMaterial({ token, pdfDisponivel, aoLinkInvalido }: { token: string; pdfDisponivel: boolean | undefined; aoLinkInvalido: () => void }) {
  const [baixando, setBaixando] = useState(false);
  // `pdf_disponivel === false` (0060) já nasce sem o botão — a sonda no clique
  // fica só para `undefined` (banco anterior à 0060, que não sabe dizer).
  const [estado, setEstado] = useState<EstadoPdfMaterialPublico | null>(pdfDisponivel === false ? "pdf_indisponivel" : null);

  async function baixar() {
    setBaixando(true);
    setEstado(null);
    try {
      const { estado: resultado } = await baixarPdfMaterialPublico(token);
      if (resultado === "link_invalido") {
        aoLinkInvalido();
        return;
      }
      setEstado(resultado);
    } finally {
      setBaixando(false);
    }
  }

  const semPdf = estado === "pdf_indisponivel" || estado === "envio_indisponivel";

  const mensagem: Record<Exclude<EstadoPdfMaterialPublico, "link_invalido">, string | null> = {
    disponivel: "O PDF foi baixado. Se não apareceu, confira a pasta de downloads do seu aparelho.",
    pdf_indisponivel: "Este material ainda não tem PDF — use “Imprimir esta página” para guardar uma cópia.",
    envio_indisponivel: "O download está fora do ar neste momento — imprima esta página para guardar uma cópia.",
    limite_excedido: "Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.",
    erro_desconhecido: "Não deu para baixar agora. Tente de novo ou imprima esta página.",
  };

  return (
    <div className="nao-imprimir flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        {!semPdf && (
          <BotaoPublico variante="primario" carregando={baixando} onClick={baixar} icone={IconeBaixar} className="sm:flex-1">
            {baixando ? "Preparando…" : "Baixar PDF"}
          </BotaoPublico>
        )}
        <BotaoPublico variante={semPdf ? "primario" : "secundario"} onClick={() => window.print()} icone={IconeImprimir} className="sm:flex-1">
          Imprimir esta página
        </BotaoPublico>
      </div>
      {estado && estado !== "link_invalido" && mensagem[estado] && (
        <p role={estado === "disponivel" ? "status" : "alert"} className={`text-sm ${estado === "disponivel" ? "text-tinta-suave" : "font-medium text-tinta"}`}>
          {mensagem[estado]}
        </p>
      )}
    </div>
  );
}

function Conteudo({ token, abertura, aoLinkInvalido }: { token: string; abertura: AberturaMaterialPublico; aoLinkInvalido: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <RotuloPublico>Material da sua sessão</RotuloPublico>
        <p className="text-tinta-suave">
          Para {abertura.primeiro_nome} · preparado pela Dra. Elaine Montenegro em {formatarData(abertura.payload.aprovado_em)}.
        </p>
      </div>

      <AcoesMaterial token={token} pdfDisponivel={abertura.payload.pdf_disponivel} aoLinkInvalido={aoLinkInvalido} />

      <CartaoPublico como="article" className="flex flex-col gap-4">
        <h1 className="text-tinta">{abertura.payload.titulo}</h1>
        {abertura.payload.blocos.map((bloco, i) => (
          <BlocoConteudo key={i} bloco={bloco} />
        ))}
      </CartaoPublico>
    </div>
  );
}

export function MaterialPublico({ token }: { token: string }) {
  const buscar = useCallback(() => abrirLinkMaterial(token).then((res) => conferirTipo(res, "material")), [token]);
  const { dados: abertura, carregando, erro, recarregar } = useRecurso(buscar, [token]);
  const [linkCaiu, setLinkCaiu] = useState(false);

  if (carregando) return <CarregandoPublico />;
  if (linkCaiu || (erro instanceof ErroLinkPublico && erro.codigo === "link_invalido")) return <TelaLinkInvalido />;
  if (erro) return <ErroTemporarioPublico aoTentarNovamente={recarregar} />;
  if (!abertura) return null;

  return <Conteudo token={token} abertura={abertura} aoLinkInvalido={() => setLinkCaiu(true)} />;
}
