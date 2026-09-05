"use client";

import { useEffect, useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase/browser";
import type { PapelEquipe } from "@/lib/api";

export interface UsuarioAtual {
  email: string;
  nome: string | null;
  papel: PapelEquipe | null;
}

export const ROTULO_PAPEL: Record<PapelEquipe, string> = {
  admin: "Administração",
  advogada: "Advogada",
  relacionamento: "Relacionamento",
  assistente: "Assistente",
};

/**
 * Quem está logado, para o shell mostrar nome e papel. Não existe endpoint
 * "quem sou eu" — lê a sessão do Supabase no navegador (e-mail) e a linha
 * própria em `perfis_equipe` (nome, papel), que a RLS `pe_select` já limita
 * à equipe interna. Uma leitura ao montar, sem polling; se falhar, mostra
 * só o e-mail — nunca inventa nome ou papel.
 */
export function useUsuarioAtual(): { usuario: UsuarioAtual | null; carregando: boolean } {
  const [usuario, setUsuario] = useState<UsuarioAtual | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    const supabase = criarClienteNavegador();

    async function carregar() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!vivo) return;
        if (!user?.email) {
          setUsuario(null);
          return;
        }
        const base: UsuarioAtual = { email: user.email, nome: null, papel: null };
        const { data } = await supabase.from("perfis_equipe").select("nome, papel").eq("auth_user_id", user.id).eq("ativo", true).maybeSingle();
        if (!vivo) return;
        setUsuario(data ? { ...base, nome: data.nome ?? null, papel: (data.papel as PapelEquipe) ?? null } : base);
      } catch {
        if (vivo) setUsuario(null);
      } finally {
        if (vivo) setCarregando(false);
      }
    }

    carregar();
    return () => {
      vivo = false;
    };
  }, []);

  return { usuario, carregando };
}
