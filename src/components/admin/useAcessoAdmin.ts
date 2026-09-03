"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { buscarCustoIa, listarEquipe } from "./adminApi";

export type EstadoAcessoAdmin =
  | { situacao: "carregando" }
  | { situacao: "admin" }
  /** Papel com `app.ve_patrimonio()` (advogada) — só a rota de Custo de IA aceita. */
  | { situacao: "somente_custo_ia" }
  | { situacao: "nao_autenticado" }
  | { situacao: "negado" }
  | { situacao: "erro"; erro: unknown };

/**
 * Não existe endpoint "quem sou eu" na fronteira desta tela (`src/server/auth.ts`
 * é do backend). A checagem de papel usa as duas rotas que já existem como sonda:
 * `GET /api/admin/equipe` (só admin) e `GET /api/admin/custo-ia` (admin OU
 * advogada — `exigirVePatrimonio`). O resultado decide o que MONTA na tela —
 * a segunda camada, além da RLS/rota no servidor, que a tarefa exige ("a tela
 * esconde o que o papel não pode E o servidor nega").
 */
export function useAcessoAdmin() {
  const [estado, setEstado] = useState<EstadoAcessoAdmin>({ situacao: "carregando" });
  const [chave, setChave] = useState(0);

  const verificar = useCallback(() => {
    setEstado({ situacao: "carregando" });
    setChave((c) => c + 1);
  }, []);

  useEffect(() => {
    let vivo = true;

    async function checar() {
      try {
        await listarEquipe();
        if (vivo) setEstado({ situacao: "admin" });
        return;
      } catch (erroEquipe) {
        if (!vivo) return;
        if (!(erroEquipe instanceof ApiError)) {
          setEstado({ situacao: "erro", erro: erroEquipe });
          return;
        }
        if (erroEquipe.status === 401) {
          setEstado({ situacao: "nao_autenticado" });
          return;
        }
        if (erroEquipe.status !== 403) {
          setEstado({ situacao: "erro", erro: erroEquipe });
          return;
        }
      }

      // 403 em /equipe: pode ser advogada (vê Custo de IA) ou papel sem acesso nenhum.
      try {
        await buscarCustoIa();
        if (vivo) setEstado({ situacao: "somente_custo_ia" });
      } catch (erroCusto) {
        if (!vivo) return;
        if (erroCusto instanceof ApiError && erroCusto.status === 401) {
          setEstado({ situacao: "nao_autenticado" });
        } else if (erroCusto instanceof ApiError && erroCusto.status === 403) {
          setEstado({ situacao: "negado" });
        } else {
          setEstado({ situacao: "erro", erro: erroCusto });
        }
      }
    }

    checar();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  return { estado, verificar };
}
