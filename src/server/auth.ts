import { criarClienteServidor } from "@/lib/supabase/server";
import { erroNaoAutenticado, erroSemPermissao, registrarErro } from "./erros";
import type { PapelEquipe, PerfilEquipe } from "@/types/banco";

/**
 * O usuário logado É a linha de `perfis_equipe` (achatado — sem wrapper). `null`
 * quando não há sessão Supabase válida OU quando há sessão mas nenhum convite
 * ativo casado a ela (`app.papel() is null` no banco). Os dois casos colapsam em
 * `null` de propósito: a RLS também não distingue os dois — nega tudo igual.
 */
export type UsuarioAtual = PerfilEquipe;

/**
 * Sessão atual + perfil de equipe (se houver convite vinculado).
 * Usa `auth.getUser()` (valida o JWT contra o Supabase Auth), nunca `getSession()`
 * sozinho, que apenas lê o cookie sem confirmar que ele ainda é válido no servidor.
 */
export async function usuarioAtual(): Promise<UsuarioAtual | null> {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return null;
  }

  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis_equipe")
    .select("*")
    .eq("auth_user_id", user.id)
    .eq("ativo", true)
    .maybeSingle();

  if (erroPerfil) {
    // Isto não é "sem convite" (RLS nega em silêncio, devolve null sem error) —
    // é falha real de infraestrutura (conexão, schema). Precisa aparecer no log.
    registrarErro("server/auth.usuarioAtual", erroPerfil, { auth_user_id: user.id });
    throw erroPerfil;
  }

  return (perfil as PerfilEquipe | null) ?? null;
}

/**
 * Exige que o usuário tenha convite ativo e, se `papeis` for informado, que o
 * papel dele esteja na lista. Chame sem argumentos para exigir só "é da equipe".
 *
 * Esta é a trava de ROTA. A RLS é a trava de BANCO. As duas são obrigatórias —
 * nenhuma rota deste projeto confia só numa das duas.
 */
export async function exigirPapel(...papeis: PapelEquipe[]): Promise<UsuarioAtual> {
  const usuario = await usuarioAtual();

  if (!usuario) {
    throw erroNaoAutenticado("Não autenticado ou sem convite ativo na equipe.");
  }

  if (papeis.length > 0 && !papeis.includes(usuario.papel)) {
    throw erroSemPermissao(`Papel '${usuario.papel}' não tem permissão para esta ação.`);
  }

  return usuario;
}

/** Atalho para "qualquer papel interno" — equivalente a `app.eh_interno()`. */
export function exigirInterno(): Promise<UsuarioAtual> {
  return exigirPapel();
}

/** Quem enxerga VALOR de patrimônio, IR e contrato social — só admin e advogada. */
export function exigirVePatrimonio(): Promise<UsuarioAtual> {
  return exigirPapel("admin", "advogada");
}

/** Mesma checagem de `exigirVePatrimonio`, mas como predicado — útil quando a
 * rota já tem `usuario` em mãos (ex.: recorte de patrimônio na Ficha 360). */
export function papelVePatrimonio(papel: PapelEquipe): boolean {
  return papel === "admin" || papel === "advogada";
}
