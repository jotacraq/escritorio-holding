import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

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
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Sem config do Supabase o app não tem como validar sessão nenhuma.
    // Fail-closed: não deixamos passar tráfego autenticado por engano.
    return NextResponse.json(
      { erro: "config_ausente", mensagem: "Configuração do Supabase ausente no servidor." },
      { status: 503 },
    );
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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

  const { pathname } = request.nextUrl;
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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
