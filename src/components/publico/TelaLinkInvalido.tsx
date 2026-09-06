import { CartaoPublico } from "@/components/publico/atomos";

/**
 * A UMA tela para todo caso ruim de link (inexistente, expirado, revogado, esgotado, de jornada
 * fechada) — docs/ARQUITETURA-FASE-2.md §2.2, regra 3: distinguir os casos transforma a rota em
 * oráculo de existência. Por isso este componente não recebe motivo nenhum como prop: só existe
 * uma mensagem possível.
 *
 * Contato do escritório: no RODAPÉ do layout público (`ContatoEquipe`, nunca
 * número/e-mail inventado — vem de `NEXT_PUBLIC_CONTATO_*`; sem eles, "fale
 * com quem te mandou este link"). Não repita aqui dentro.
 */
export function TelaLinkInvalido() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8 text-center">
      <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full bg-ambar-fraco">
        <svg viewBox="0 0 24 24" className="h-7 w-7 fill-none stroke-[color:var(--ambar)] stroke-2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3.5h.01M12 3.5l9 15.5H3l9-15.5Z" />
        </svg>
      </span>

      <div className="flex flex-col gap-2">
        <h1 className="text-tinta">Este link não está mais disponível</h1>
        <p className="max-w-sm text-tinta-suave">
          Ele pode ter vencido, já ter sido usado ou não existir mais. Isso é normal — não significa que algo deu errado
          do seu lado.
        </p>
      </div>

      {/*
       * Fase 7 r2: o `ContatoEquipe` que ficava AQUI saiu — ele agora é o
       * rodapé de TODAS as páginas públicas (`app/(publico)/layout.tsx`), a
       * dois dedos daqui. Duas vezes a mesma frase na mesma tela não é
       * insistência, é ruído: quem lê para de ler. O contato continua na
       * tela, uma vez, no lugar em que está nas outras quatro páginas.
       */}
      <CartaoPublico className="w-full max-w-sm text-left">
        <p className="text-rotulo font-medium uppercase text-tinta-fraca">O que fazer agora</p>
        <p className="mt-2 text-tinta">Peça um link novo — é rápido de gerar. Quem te enviou este consegue gerar outro na hora.</p>
      </CartaoPublico>
    </div>
  );
}
