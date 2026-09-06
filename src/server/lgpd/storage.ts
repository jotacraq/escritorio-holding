import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import type { SolicitacaoTitular } from "@/types/lgpd";

/** Mesmo bucket privado do upload do cliente (0012 / `/p/d`). */
export const BUCKET_DOCUMENTOS = "documentos-sensiveis";

export interface ResultadoExpurgo {
  removidos: number;
  falhos: string[];
}

/**
 * Tempos 3 e 4 do expurgo (docs/ARQUITETURA-FASE-7.md §B4.1): remover os
 * objetos do Storage e carimbar o fecho no registro da solicitação.
 *
 * IDEMPOTÊNCIA DE VERDADE (achado M2 do pentest r3). O `remove()` do
 * storage-js devolve só os objetos que EXISTIAM: um caminho já removido numa
 * tentativa anterior — ou apagado à mão no painel — não volta na lista. A
 * versão anterior tratava essa ausência como falha, então o caminho ia para
 * `falhos`, `confirmar_expurgo_storage` nunca era chamado para ele e a
 * retomada ficava presa para sempre: `storage_pendente` cheio, pendência
 * eterna na tela e `documentos.caminho` apontando para objeto inexistente.
 * Agora, para cada caminho que não voltou do `remove`, perguntamos ao Storage
 * se ele ainda existe (`exists()`); `false` conta como removido, porque o
 * objetivo — o arquivo fora do bucket — está cumprido.
 *
 * Sem casamento por basename: dois clientes podem ter `rg.pdf`, e casar pelo
 * nome do arquivo marcaria como removido o caminho errado.
 *
 * NUNCA lança: a anonimização do banco já aconteceu e não pode ser desfeita por
 * uma falha de armazenamento. O que dá errado volta em `falhos`, aparece como
 * faixa na tela e como pendência no Admin — nada falha em silêncio.
 */
export async function expurgarArquivos(
  admin: SupabaseClient,
  solicitacaoId: string,
  caminhos: string[],
  pessoaId: string,
): Promise<ResultadoExpurgo> {
  if (caminhos.length === 0) return { removidos: 0, falhos: [] };

  const bucket = admin.storage.from(BUCKET_DOCUMENTOS);
  let removidos: string[] = [];
  const falhos: string[] = [];

  try {
    const { data, error } = await bucket.remove(caminhos);
    if (error) {
      registrarErro("server/lgpd/storage#remove", error, { pessoa_id: pessoaId, solicitacao_id: solicitacaoId });
      falhos.push(...caminhos);
    } else {
      // O Storage devolve o que REALMENTE saiu nesta chamada.
      const saiu = new Set((data ?? []).map((o) => String((o as { name?: unknown }).name ?? "")));
      const confirmados = caminhos.filter((c) => saiu.has(c));
      const duvidosos = caminhos.filter((c) => !saiu.has(c));

      // O que não voltou pode já ter saído antes. Só é falha se ainda estiver lá.
      const veredito = await Promise.all(
        duvidosos.map(async (caminho) => {
          try {
            const { data: existe, error: erroExiste } = await bucket.exists(caminho);
            if (erroExiste) {
              registrarErro("server/lgpd/storage#exists", erroExiste, {
                pessoa_id: pessoaId,
                solicitacao_id: solicitacaoId,
              });
              return { caminho, saiu: false };
            }
            return { caminho, saiu: existe === false };
          } catch (erro) {
            registrarErro("server/lgpd/storage#exists-excecao", erro, {
              pessoa_id: pessoaId,
              solicitacao_id: solicitacaoId,
            });
            return { caminho, saiu: false };
          }
        }),
      );

      removidos = [...confirmados, ...veredito.filter((v) => v.saiu).map((v) => v.caminho)];
      falhos.push(...veredito.filter((v) => !v.saiu).map((v) => v.caminho));
    }
  } catch (erro) {
    registrarErro("server/lgpd/storage#remove-excecao", erro, { pessoa_id: pessoaId, solicitacao_id: solicitacaoId });
    return { removidos: 0, falhos: caminhos };
  }

  if (removidos.length > 0) {
    // Cliente ADMIN, não o da sessão (achado L1): desde a 0081 a RPC é só de
    // `service_role`. A rota já provou `exigirPapel("admin")` — a porta é uma
    // só, e o PostgREST deixa de ser a segunda.
    const { error } = await admin
      .rpc("confirmar_expurgo_storage", { p_solicitacao_id: solicitacaoId, p_caminhos: removidos })
      .single<SolicitacaoTitular>();
    if (error) {
      registrarErro("server/lgpd/storage#confirmar", error, { pessoa_id: pessoaId, solicitacao_id: solicitacaoId });
      // O objeto saiu, mas o banco não soube: fica pendente e a retomada
      // (POST .../anonimizacao/expurgo) fecha — e agora fecha de verdade,
      // porque o `exists()` acima reconhece o objeto que já não está lá.
      return { removidos: removidos.length, falhos: [...falhos, ...removidos] };
    }
  }

  return { removidos: removidos.length, falhos };
}
