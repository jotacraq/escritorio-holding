import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config-publica";

/**
 * Renova a sessão Supabase a cada requisição e redireciona quem não está
 * autenticado para /login (só para navegação de página — rotas de API devolvem
 * 401/403 pelo próprio `src/server/auth.ts`, nunca um redirect HTML).
 *
 * NOTA (Next 16): `middleware.ts` foi renomeado para `proxy.ts` nesta versão do
 * framework (deprecado, não removido — "all functionality remains the same").
 * Mantido como `middleware.ts` porque é o caminho de arquivo definido no plano de
 * execução; migrar para `proxy.ts` via `npx @next/codemod@canary middleware-to-proxy .`
 * é um follow-up de baixo risco, não uma correção urgente.
 */

/**
 * Prefixos que são o próprio produto de superfície pública (Link Público, Fase 2
 * §2): jornada do cliente sem login, sem cookie, sem sessão. `pessoas.auth_user_id`
 * continua NULL — ninguém aqui é "usuário autenticado", e mandar para /login
 * apagaria a feature inteira (gap G17 do plano). Passar batido é intencional:
 * a autorização de cada link é feita pela RPC (hash do token), não por este
 * middleware — mesmo modelo de `ehRotaApi` mais abaixo.
 */
function ehRotaPublica(pathname: string): boolean {
  return (
    pathname === "/p" ||
    pathname.startsWith("/p/") ||
    pathname === "/api/publico" ||
    pathname.startsWith("/api/publico/")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Bypass explícito e único: nada de sessão, nada de cookie Supabase, nada de
  // redirect. Confira o matcher abaixo — mesmo que uma futura mudança amplie a
  // regex, esta checagem continua restrita a estes dois prefixos exatos.
  if (ehRotaPublica(pathname)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  // Config pública vem de constante (ver src/lib/config-publica.ts): o proxy do
  // Next não lê .env em execução, e depender disso aqui derrubava o site inteiro.
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() valida o JWT contra o Supabase Auth (e renova via os cookies acima
  // se o access token estiver perto de expirar). Nunca usar getSession() aqui —
  // ele confia no cookie local sem confirmar que a sessão ainda é válida.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ehRotaApi = pathname.startsWith("/api/");
  const ehPaginaLogin = pathname === "/login";

  if (!ehRotaApi) {
    if (!user && !ehPaginaLogin) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("proximo", pathname);
      return NextResponse.redirect(url);
    }

    if (user && ehPaginaLogin) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Roda em tudo, exceto assets estáticos e o próprio Next internals.
    "/((?!_next/static|_next/image|versao.txt|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
