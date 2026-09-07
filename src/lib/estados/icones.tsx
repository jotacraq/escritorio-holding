import type { ReactNode } from "react";

/**
 * Glifos dos estados (Fase 8, §12 do DS).
 *
 * A lei que estes ícones existem para cumprir: **status é cor + ícone +
 * rótulo, nunca só cor.** Em grayscale (ou para quem não distingue matiz), o
 * que resta é a FORMA — por isso nenhum par de estados do mesmo domínio pode
 * dividir o mesmo glifo, e nenhum glifo entra sozinho: ele é sempre
 * `aria-hidden`, ao lado do rótulo em texto.
 *
 * Todos em `viewBox="0 0 20 20"`, `fill="currentColor"` (a cor vem do
 * `--estado-*` do selo, ≥ 7:1) e desenhados para ler a 14px.
 */
export type NomeIcone =
  | "check"
  | "check-duplo"
  | "x"
  | "alerta"
  | "relogio"
  | "calendario"
  | "sino"
  | "lapis"
  | "calculadora"
  | "alfinete"
  | "apresentacao"
  | "download"
  | "fala"
  | "boleto"
  | "lupa"
  | "voltar"
  | "repetir"
  | "arquivo"
  | "seta"
  | "traco"
  | "vazio"
  | "aviao"
  | "interrogacao";

const CAMINHOS: Record<NomeIcone, ReactNode> = {
  check: <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.79a1 1 0 0 1 1.4 0Z" />,
  "check-duplo": (
    <>
      <path d="M9.7 5.3a1 1 0 0 1 0 1.4l-5.5 5.5a1 1 0 0 1-1.4 0l-2-2a1 1 0 1 1 1.4-1.4L3.5 10.1l4.8-4.8a1 1 0 0 1 1.4 0Z" />
      <path d="M18.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-1.5-1.5a1 1 0 1 1 1.4-1.4l.8.79 6.8-6.79a1 1 0 0 1 1.4 0Z" />
    </>
  ),
  x: <path d="M5.3 5.3a1 1 0 0 1 1.4 0L10 8.59l3.3-3.3a1 1 0 1 1 1.4 1.42L11.41 10l3.3 3.3a1 1 0 0 1-1.42 1.4L10 11.41l-3.3 3.3a1 1 0 0 1-1.4-1.42L8.59 10l-3.3-3.3a1 1 0 0 1 0-1.4Z" />,
  alerta: <path d="M10 1.8 19 17.4H1L10 1.8Zm0 5.5a1 1 0 0 0-1 1v3.4a1 1 0 1 0 2 0V8.3a1 1 0 0 0-1-1Zm0 7.1a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />,
  relogio: <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm1 4a1 1 0 1 0-2 0v4a1 1 0 0 0 .45.83l2.5 1.67a1 1 0 0 0 1.1-1.66L11 9.46V6Z" />,
  calendario: <path d="M6 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1Zm12 7H2v7a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5V9Z" />,
  sino: <path d="M10 1.5a5.5 5.5 0 0 0-5.5 5.5v3.2L3.2 13a.9.9 0 0 0 .8 1.35h12a.9.9 0 0 0 .8-1.35l-1.3-2.8V7A5.5 5.5 0 0 0 10 1.5Zm-2.2 14.3a2.3 2.3 0 0 0 4.4 0H7.8Z" />,
  lapis: <path d="M14.3 2.3a1.8 1.8 0 0 1 2.55 2.55l-.9.9-2.55-2.55.9-.9Zm-1.9 1.9 2.55 2.55-8.2 8.2-3.2.65.65-3.2 8.2-8.2ZM2.5 17.5h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1 0-1.5Z" />,
  calculadora: <path d="M5 1.5h10A2.5 2.5 0 0 1 17.5 4v12a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 16V4A2.5 2.5 0 0 1 5 1.5ZM5.5 4.5v3h9v-3h-9Zm0 5.5v1.5h2V10h-2Zm3.5 0v1.5h2V10H9Zm3.5 0v1.5h2V10h-2Zm-7 3.5V15h2v-1.5h-2Zm3.5 0V15h2v-1.5H9Zm3.5 0V15h2v-1.5h-2Z" />,
  alfinete: <path d="M12.4 1.9a1 1 0 0 1 1.4 0l4.3 4.3a1 1 0 0 1-.7 1.7l-2.2.06-3.4 3.4.5 2.3a1 1 0 0 1-1.68.93L8 12.24l-4.3 4.3a1 1 0 0 1-1.42-1.42l4.3-4.3-2.36-2.6a1 1 0 0 1 .93-1.66l2.3.5 3.4-3.4.05-2.2a1 1 0 0 1 .3-.66Z" />,
  apresentacao: <path d="M2.5 2.5h15a.9.9 0 0 1 0 1.8H17v7.4a1.8 1.8 0 0 1-1.8 1.8h-4.3v1.6l2.2 2.2a.9.9 0 0 1-1.28 1.28L10 16.78l-1.82 1.8a.9.9 0 0 1-1.28-1.28l2.2-2.2V13.5H4.8A1.8 1.8 0 0 1 3 11.7V4.3h-.5a.9.9 0 0 1 0-1.8Zm4.3 4.2v3.6h1.8V6.7H6.8Zm3.3-1.5v5.1h1.8V5.2h-1.8Zm3.3 2.6v2.5h1.8V7.8h-1.8Z" />,
  download: <path d="M10 2a1 1 0 0 1 1 1v7.09l2.3-2.3a1 1 0 0 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 1.4-1.42L9 10.1V3a1 1 0 0 1 1-1ZM3 14a1 1 0 0 1 1 1v1.5h12V15a1 1 0 1 1 2 0v2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 2 17v-2a1 1 0 0 1 1-1Z" />,
  fala: <path d="M4 2.5h12A2.5 2.5 0 0 1 18.5 5v6.5A2.5 2.5 0 0 1 16 14H9.4l-3.9 3.3A.85.85 0 0 1 4.1 16.6V14A2.5 2.5 0 0 1 1.5 11.5V5A2.5 2.5 0 0 1 4 2.5Zm1.5 4a.9.9 0 0 0 0 1.8h9a.9.9 0 0 0 0-1.8h-9Zm0 3.4a.9.9 0 0 0 0 1.8h5.5a.9.9 0 0 0 0-1.8H5.5Z" />,
  boleto: <path d="M2.5 4h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1.6 2v8h1.2V6H4.1Zm2.4 0v8h.8V6h-.8Zm2 0v8h1.6V6H8.5Zm2.8 0v8h.8V6h-.8Zm2 0v8h1.2V6h-1.2Zm2.4 0v8h.8V6h-.8Z" />,
  lupa: <path d="M8.5 2a6.5 6.5 0 1 0 4.03 11.6l3.94 3.93a1 1 0 0 0 1.42-1.41l-3.94-3.94A6.5 6.5 0 0 0 8.5 2Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z" />,
  voltar: <path d="M8.7 3.3a1 1 0 0 1 0 1.4L6.91 6.5H12a5.5 5.5 0 1 1 0 11H7a1 1 0 1 1 0-2h5a3.5 3.5 0 1 0 0-7H6.91L8.7 10.3a1 1 0 1 1-1.4 1.4l-3.5-3.5a1 1 0 0 1 0-1.4l3.5-3.5a1 1 0 0 1 1.4 0Z" />,
  repetir: <path d="M10 3a7 7 0 0 1 6.32 4 1 1 0 0 1-1.8.86A5 5 0 0 0 5.3 8.5h2.2a.9.9 0 0 1 .64 1.54l-3.5 3.5a.9.9 0 0 1-1.28 0l-3.5-3.5A.9.9 0 0 1 .5 8.5h2.55A7 7 0 0 1 10 3Zm6.45 3.46 3.5 3.5a.9.9 0 0 1-.64 1.54H16.9A7 7 0 0 1 3.68 13a1 1 0 1 1 1.8-.86 5 5 0 0 0 9.22-.64h-2.2a.9.9 0 0 1-.64-1.54l3.5-3.5a.9.9 0 0 1 1.28 0Z" />,
  arquivo: <path d="M2.5 3h15a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm.5 6h14v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16V9Zm4.4 2a.9.9 0 0 0 0 1.8h5.2a.9.9 0 0 0 0-1.8H7.4Z" />,
  seta: <path d="M3 10a1 1 0 0 1 1-1h9.09l-3.3-3.3a1 1 0 0 1 1.42-1.4l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.42-1.4l3.3-3.3H4a1 1 0 0 1-1-1Z" />,
  traco: <path d="M3.5 9h13a1 1 0 0 1 0 2h-13a1 1 0 0 1 0-2Z" />,
  vazio: <path d="M10 2.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" />,
  aviao: <path d="M18.4 2.1a.9.9 0 0 1 .43 1.06l-4.6 14.2a.9.9 0 0 1-1.6.2l-3.1-4.6-4.6-3.1a.9.9 0 0 1 .2-1.6l14.2-4.6a.9.9 0 0 1 1.07.44Zm-3.1 2.2L6.6 7.15l2.66 1.8 6.04-4.65ZM10.6 9.9l1.8 2.66 2.85-8.7-4.65 6.04Z" />,
  interrogacao: <path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 11.4a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Zm0-8.1c-1.7 0-3 1.1-3.15 2.7a1 1 0 0 0 2 .2C8.9 7.6 9.35 7.2 10 7.2c.66 0 1.15.42 1.15 1 0 .43-.16.66-.8 1.13-.83.6-1.35 1.2-1.35 2.32a1 1 0 0 0 2 0c0-.36.12-.53.7-.96.83-.6 1.45-1.28 1.45-2.5C13.15 6.5 11.8 5.3 10 5.3Z" />,
};

/**
 * Ícone de estado. Sempre `aria-hidden`: quem lê o estado é o rótulo em texto
 * ao lado — um glifo com `aria-label` viraria a segunda leitura da mesma
 * informação.
 */
export function IconeEstado({ nome, className = "h-4 w-4" }: { nome: NomeIcone; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`${className} shrink-0 fill-current`}>
      {CAMINHOS[nome]}
    </svg>
  );
}

/** Os nomes existentes — usado pelo teste que prova que todo estado tem glifo. */
export const NOMES_DE_ICONE = Object.keys(CAMINHOS) as NomeIcone[];
