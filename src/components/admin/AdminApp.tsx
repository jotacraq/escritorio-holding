"use client";

import Link from "next/link";
import { Abas } from "@/components/ui/Abas";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro } from "@/components/ui/Estado";
import { SeloStub } from "@/components/ui/Selo";
import { useAcessoAdmin } from "./useAcessoAdmin";
import { PendenciasAba } from "./abas/PendenciasAba";
import { IntegracoesAba } from "./abas/IntegracoesAba";
import { EquipeAba } from "./abas/EquipeAba";
import { ProdutosAba } from "./abas/ProdutosAba";
import { TemplatesAba } from "./abas/TemplatesAba";
import { PromptsAba } from "./abas/PromptsAba";
import { ParametrosAba } from "./abas/ParametrosAba";
import { MateriaisModelosAba } from "./abas/MateriaisModelosAba";
import { EdicoesAba } from "./abas/EdicoesAba";
import { ConfiguracoesAba } from "./abas/ConfiguracoesAba";
import { CustoIaAba } from "./abas/CustoIaAba";

/**
 * Admin — a mesa de controle do sistema. Restrita ao papel `admin` (só a aba
 * "Custo de IA" também abre para `advogada`, mesmo recorte de quem vê
 * patrimônio — decisão já tomada no backend, `exigirVePatrimonio`).
 *
 * Dupla camada de acesso: o SERVIDOR nega em cada rota (`exigirPapel`/
 * `exigirVePatrimonio`); esta tela ESCONDE o que o papel não pode antes
 * mesmo de tentar — `useAcessoAdmin` sonda o papel real e só monta as abas
 * que o servidor aceitaria.
 *
 * Três grupos, na ordem em que a Dra. Elaine pensa: o que precisa de mim
 * agora (Operação) · as regras do método (Método) · quem e o quê (Cadastro).
 * `deepLinkHash`: outras telas apontam para `/admin#integracoes`,
 * `/admin#pendencias`, `/admin#parametros`.
 */
export function AdminApp() {
  const { estado, verificar } = useAcessoAdmin();

  if (estado.situacao === "carregando") {
    return <EsqueletoLista linhas={4} rotulo="Verificando acesso…" />;
  }

  if (estado.situacao === "nao_autenticado") {
    return (
      <Cartao titulo="Sessão expirada" descricao="Entre de novo para continuar.">
        <Link href="/login" className="inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--latao)] underline-offset-2 hover:underline">
          Ir para o login
        </Link>
      </Cartao>
    );
  }

  if (estado.situacao === "negado") {
    return (
      <Cartao titulo="Área restrita" descricao="O Admin é restrito ao papel admin (e, só para Custo de IA, à advogada). Seu perfil não tem acesso a esta área." />
    );
  }

  if (estado.situacao === "erro") {
    return <EstadoErro erro={estado.erro} tentarNovamente={verificar} titulo="Não foi possível verificar o acesso" />;
  }

  if (estado.situacao === "somente_custo_ia") {
    return (
      <div className="flex flex-col gap-5">
        <SeloStub texto="As demais áreas do Admin são restritas ao papel admin. Seu perfil vê apenas o Custo de IA — mesmo recorte de quem vê patrimônio." />
        <CustoIaAba />
      </div>
    );
  }

  return (
    <Abas
      semMoldura
      deepLinkHash
      abaInicial="pendencias"
      abas={[
        { id: "pendencias", grupo: "Operação", rotulo: "Pendências", conteudo: <PendenciasAba /> },
        { id: "integracoes", grupo: "Operação", rotulo: "Integrações", conteudo: <IntegracoesAba /> },
        { id: "custo-ia", grupo: "Operação", rotulo: "Custo de IA", conteudo: <CustoIaAba /> },
        { id: "parametros", grupo: "Método", rotulo: "Parâmetros do método", conteudo: <ParametrosAba /> },
        { id: "materiais-modelos", grupo: "Método", rotulo: "Modelos de material", conteudo: <MateriaisModelosAba /> },
        { id: "templates", grupo: "Método", rotulo: "Templates de mensagem", conteudo: <TemplatesAba /> },
        { id: "prompts", grupo: "Método", rotulo: "Versões de prompt", conteudo: <PromptsAba /> },
        { id: "equipe", grupo: "Cadastro", rotulo: "Equipe", conteudo: <EquipeAba /> },
        { id: "produtos", grupo: "Cadastro", rotulo: "Produtos", conteudo: <ProdutosAba /> },
        { id: "edicoes", grupo: "Cadastro", rotulo: "Edições do seminário", conteudo: <EdicoesAba /> },
        { id: "configuracoes", grupo: "Cadastro", rotulo: "Configurações", conteudo: <ConfiguracoesAba /> },
      ]}
    />
  );
}
