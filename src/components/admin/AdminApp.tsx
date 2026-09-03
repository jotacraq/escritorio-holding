"use client";

import Link from "next/link";
import { Abas } from "@/components/ui/Abas";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { useAcessoAdmin } from "./useAcessoAdmin";
import { PendenciasAba } from "./abas/PendenciasAba";
import { EquipeAba } from "./abas/EquipeAba";
import { ProdutosAba } from "./abas/ProdutosAba";
import { TemplatesAba } from "./abas/TemplatesAba";
import { PromptsAba } from "./abas/PromptsAba";
import { EdicoesAba } from "./abas/EdicoesAba";
import { ConfiguracoesAba } from "./abas/ConfiguracoesAba";
import { CustoIaAba } from "./abas/CustoIaAba";

/**
 * Admin — a mesa de controle do sistema. Restrita ao papel `admin` (só a aba
 * "Custo de IA" também abre para `advogada`, mesmo recorte de quem vê
 * patrimônio — decisão já tomada no backend, `exigirVePatrimonio`).
 *
 * Dupla camada de acesso (regra da tarefa): o SERVIDOR nega em cada uma das
 * 21 rotas (`exigirPapel`/`exigirVePatrimonio`); esta tela ESCONDE o que o
 * papel não pode antes mesmo de tentar — `useAcessoAdmin` sonda o papel real
 * e só monta as abas que o servidor aceitaria.
 */
export function AdminApp() {
  const { estado, verificar } = useAcessoAdmin();

  if (estado.situacao === "carregando") {
    return <EstadoCarregando rotulo="Verificando acesso…" />;
  }

  if (estado.situacao === "nao_autenticado") {
    return (
      <div className="rounded-sm border border-linha bg-papel-elevado p-5 text-sm text-tinta-suave">
        <p className="font-medium text-tinta">Sessão expirada</p>
        <p className="mt-1">Faça login de novo para continuar.</p>
        <Link href="/login" className="mt-3 inline-block text-sm font-medium text-latao-forte underline-offset-2 hover:underline">
          Ir para o login
        </Link>
      </div>
    );
  }

  if (estado.situacao === "negado") {
    return (
      <div className="rounded-sm border border-linha bg-papel-elevado p-5 text-sm text-tinta-suave">
        <p className="font-medium text-tinta">Área restrita</p>
        <p className="mt-1">O Admin é restrito ao papel admin (e, só para Custo de IA, à advogada). Seu perfil não tem acesso a esta área.</p>
      </div>
    );
  }

  if (estado.situacao === "erro") {
    return <EstadoErro erro={estado.erro} tentarNovamente={verificar} titulo="Não foi possível verificar o acesso" />;
  }

  if (estado.situacao === "somente_custo_ia") {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-sm border border-ambar-borda bg-ambar-fraco px-3.5 py-2.5 text-sm text-[color:var(--ambar)]">
          As demais áreas do Admin são restritas ao papel admin. Seu perfil vê apenas o Custo de IA — mesmo recorte de quem
          vê patrimônio.
        </div>
        <CustoIaAba />
      </div>
    );
  }

  return (
    <Abas
      abaInicial="pendencias"
      abas={[
        { id: "pendencias", rotulo: "Pendências", conteudo: <PendenciasAba /> },
        { id: "equipe", rotulo: "Equipe", conteudo: <EquipeAba /> },
        { id: "produtos", rotulo: "Produtos", conteudo: <ProdutosAba /> },
        { id: "templates", rotulo: "Templates de mensagem", conteudo: <TemplatesAba /> },
        { id: "prompts", rotulo: "Versões de prompt", conteudo: <PromptsAba /> },
        { id: "edicoes", rotulo: "Edições de seminário", conteudo: <EdicoesAba /> },
        { id: "configuracoes", rotulo: "Configurações", conteudo: <ConfiguracoesAba /> },
        { id: "custo-ia", rotulo: "Custo de IA", conteudo: <CustoIaAba /> },
      ]}
    />
  );
}
