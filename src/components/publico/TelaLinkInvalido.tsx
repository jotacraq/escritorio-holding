/**
 * A UMA tela para todo caso ruim de link (inexistente, expirado, revogado, esgotado, de jornada
 * fechada) — docs/ARQUITETURA-FASE-2.md §2.2, regra 3: distinguir os casos transforma a rota em
 * oráculo de existência. Por isso este componente não recebe motivo nenhum como prop: só existe
 * uma mensagem possível.
 *
 * Contato do escritório: nunca um número/e-mail inventado (pareceria dado real). Vem de
 * `NEXT_PUBLIC_CONTATO_WHATSAPP` / `NEXT_PUBLIC_CONTATO_EMAIL` quando configurados; sem eles,
 * a orientação fica em "fale com quem te mandou este link" — verdadeiro em qualquer cenário.
 */

const CONTATO_WHATSAPP = process.env.NEXT_PUBLIC_CONTATO_WHATSAPP?.trim() || null;
const CONTATO_EMAIL = process.env.NEXT_PUBLIC_CONTATO_EMAIL?.trim() || null;

export function TelaLinkInvalido() {
  const temContato = Boolean(CONTATO_WHATSAPP || CONTATO_EMAIL);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-12 w-12 fill-none stroke-[color:var(--latao)] stroke-[1.5]">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3.5h.01M12 3.5l9 15.5H3l9-15.5Z" />
      </svg>

      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-xl font-semibold text-tinta sm:text-2xl">Este link não está mais disponível</h1>
        <p className="max-w-sm text-tinta-suave">
          Ele pode ter vencido, já ter sido usado ou não existir mais. Isso é normal — não significa que algo deu errado
          do seu lado.
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3 rounded-sm border border-linha bg-papel px-5 py-4 text-left">
        <p className="text-sm font-medium text-tinta">O que fazer agora</p>
        {temContato ? (
          <ul className="flex flex-col gap-2 text-sm text-tinta-suave">
            {CONTATO_WHATSAPP && (
              <li>
                Fale com a equipe pelo WhatsApp:{" "}
                <a href={`https://wa.me/${CONTATO_WHATSAPP.replace(/\D/g, "")}`} className="font-medium text-[color:var(--latao)] underline underline-offset-2">
                  {CONTATO_WHATSAPP}
                </a>
              </li>
            )}
            {CONTATO_EMAIL && (
              <li>
                Ou por e-mail:{" "}
                <a href={`mailto:${CONTATO_EMAIL}`} className="font-medium text-[color:var(--latao)] underline underline-offset-2">
                  {CONTATO_EMAIL}
                </a>
              </li>
            )}
            <li>Peça um link novo — é rápido de gerar.</li>
          </ul>
        ) : (
          <p className="text-sm text-tinta-suave">
            Fale com quem te enviou este link (a equipe da Dra. Elaine Montenegro) e peça um link novo.
          </p>
        )}
      </div>
    </div>
  );
}
