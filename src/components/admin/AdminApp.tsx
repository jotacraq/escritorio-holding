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
import { ConhecimentoApp } from "@/components/conhecimento/ConhecimentoApp";
import { ListaImportacoes } from "@/components/importacao/ListaImportacoes";

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
 * `/admin#pendencias`, `/admin#parametros`, `/admin#repertorio`,
 * `/admin#importacoes`.
 *
 * Fase 6 — o menu caiu de 9 entradas para 5, e o Admin absorveu duas telas:
 * "Conhecimento" virou **Repertório da IA** (com a frase que explica o que
 * é, na tela) e "Importações" virou aba de Cadastro. Isso cria um conflito
 * real: o Admin é admin-only, mas o repertório é justamente o que a Dra.
 * Elaine (advogada) lê antes de cada sessão. Resolvido no ramo
 * `somente_custo_ia` abaixo, que passa a montar DUAS abas nomeadas — e só
 * essas duas. Nenhuma aba de admin chega ao DOM de quem não é admin, e o
 * gate real continua no servidor (`exigirVePatrimonio` nas rotas de
 * conhecimento, `exigirPapel("admin")` nas demais).
 */
/**
 * A frase exata que o João pediu que ficasse REGISTRADA na tela: ele achou o
 * "Conhecimento" interessante depois de entender, mas não entendeu pelo nome.
 * Uma constante, porque aparece nas duas montagens (admin e advogada) — e
 * duas cópias divergiriam.
 */
const FRASE_REPERTORIO = "É o que a IA usa para analisar: o histórico de eventos e reuniões anteriores.";

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
      <div className="flex flex-col gap-bloco">
        <SeloStub texto="As demais áreas do Admin são restritas ao papel admin. Seu perfil vê o Custo de IA e o Repertório da IA — mesmo recorte de quem vê patrimônio." />
        <Abas
          semMoldura
          deepLinkHash
          abaInicial="repertorio"
          abas={[
            { id: "repertorio", rotulo: "Repertório da IA", descricao: FRASE_REPERTORIO, conteudo: <ConhecimentoApp /> },
            { id: "custo-ia", rotulo: "Custo de IA", descricao: "Quanto a análise por IA custou, por período e por tipo de análise.", conteudo: <CustoIaAba /> },
          ]}
        />
      </div>
    );
  }

  return (
    <Abas
      semMoldura
      deepLinkHash
      abaInicial="pendencias"
      abas={[
        { id: "pendencias", grupo: "Operação", rotulo: "Pendências", descricao: "O que travou e depende de alguém. Cada linha leva à ação que resolve.", conteudo: <PendenciasAba /> },
        { id: "integracoes", grupo: "Operação", rotulo: "Integrações", descricao: "O que o sistema faz sozinho: e-mail, ligação, sala e cobrança — e o que ainda falta ligar.", conteudo: <IntegracoesAba /> },
        { id: "custo-ia", grupo: "Operação", rotulo: "Custo de IA", descricao: "Quanto a análise por IA custou, por período e por tipo de análise.", conteudo: <CustoIaAba /> },
        { id: "importacoes", grupo: "Operação", rotulo: "Importações", descricao: "As planilhas de alunos e compras que já entraram no sistema.", conteudo: <ListaImportacoes /> },
        { id: "parametros", grupo: "Método", rotulo: "Parâmetros do método", descricao: "Os valores que o croqui usa para calcular: impostos por estado, custos de cartório e horas por ato.", conteudo: <ParametrosAba /> },
        { id: "materiais-modelos", grupo: "Método", rotulo: "Modelos de material", descricao: "Os modelos do material que o cliente recebe depois da sessão.", conteudo: <MateriaisModelosAba /> },
        { id: "templates", grupo: "Método", rotulo: "Templates de mensagem", descricao: "O texto de cada e-mail e mensagem que sai para o cliente.", conteudo: <TemplatesAba /> },
        { id: "prompts", grupo: "Método", rotulo: "Versões de prompt", descricao: "As instruções que a IA recebe para escrever o briefing e a narrativa do croqui.", conteudo: <PromptsAba /> },
        { id: "repertorio", grupo: "Método", rotulo: "Repertório da IA", descricao: FRASE_REPERTORIO, conteudo: <ConhecimentoApp /> },
        { id: "equipe", grupo: "Cadastro", rotulo: "Equipe", descricao: "Quem entra no sistema e com que papel — o papel decide o que a pessoa vê.", conteudo: <EquipeAba /> },
        { id: "produtos", grupo: "Cadastro", rotulo: "Produtos", descricao: "O que o escritório vende e por qual link de pagamento.", conteudo: <ProdutosAba /> },
        { id: "edicoes", grupo: "Cadastro", rotulo: "Edições do seminário", descricao: "As turmas do seminário — é por elas que os números do funil são contados.", conteudo: <EdicoesAba /> },
        { id: "configuracoes", grupo: "Cadastro", rotulo: "Configurações", descricao: "Ajustes gerais do sistema: prazos, canais e o que roda sozinho.", conteudo: <ConfiguracoesAba /> },
      ]}
    />
  );
}
