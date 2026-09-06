import { NextResponse } from "next/server";

/**
 * `sqlerrm` das RPCs de direito do titular (0080) → HTTP.
 *
 * `autor_obrigatorio` fica de fora de propósito: é bug de chamada (a rota
 * sempre manda `p_executado_por`), não erro do usuário — cai no 500 com id
 * rastreável, que é onde ele tem de aparecer.
 */
export interface ErroPostgrestLike {
  message?: string;
  code?: string;
}

const IMPEDIMENTOS_422: Record<string, string> = {
  origem_dado_exemplo:
    "Esta pessoa é dado de demonstração, não um titular real. Anonimizá-la quebraria a apresentação do sistema.",
  titular_com_login: "Esta pessoa tem conta de acesso ao sistema. A conta precisa ser tratada antes.",
  holding_em_execucao:
    "Há holding contratada em execução para este titular. Enquanto o contrato roda, o escritório precisa dos dados para executá-lo.",
};

export function mapearErroTitular(erro: ErroPostgrestLike) {
  const mensagem = erro.message ?? "";

  if (mensagem.startsWith("sem_permissao")) {
    return NextResponse.json(
      { erro: "sem_permissao", mensagem: "Sem permissão para esta ação sobre dados de titular." },
      { status: 403 },
    );
  }
  if (mensagem.startsWith("pessoa_nao_encontrada")) {
    return NextResponse.json({ erro: "nao_encontrado", mensagem: "Pessoa não encontrada." }, { status: 404 });
  }
  if (mensagem.startsWith("solicitacao_nao_encontrada")) {
    return NextResponse.json({ erro: "nao_encontrado", mensagem: "Solicitação não encontrada." }, { status: 404 });
  }

  for (const [codigo, texto] of Object.entries(IMPEDIMENTOS_422)) {
    if (mensagem.startsWith(codigo)) {
      return NextResponse.json({ erro: codigo, mensagem: texto }, { status: 422 });
    }
  }

  if (erro.code === "23505") {
    return NextResponse.json(
      { erro: "conflito", mensagem: "Outra solicitação para este titular aconteceu ao mesmo tempo. Recarregue a tela." },
      { status: 409 },
    );
  }
  return null;
}
