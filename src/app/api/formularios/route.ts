export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno, exigirPapel } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { TIPOS_PERGUNTA } from "@/lib/formulario/definicao";
import { LIMITE_OPCOES, chaveFormularioValida, validarDefinicaoFormulario } from "@/server/formularios/definicao";
import { criarLimitadorJanela } from "@/server/integracoes/rate-limit";
import { migracaoPendente, respostaMigracaoPendente } from "@/server/migracao-pendente";
import type { Formulario, FormularioResumo } from "@/types/banco";

/**
 * Colunas de LISTAGEM — sem `definicao` (mesmo corte de `GET /api/roteiros` e
 * `GET /api/admin/prompts`: 5 definições inteiras num payload de listagem é
 * peso que a tela nunca usa). As cinco últimas nasceram na 0078; enquanto ela
 * não for aplicada, a consulta cai no conjunto legado (fallback abaixo).
 */
const COLUNAS_LISTA = "id, chave, versao, ativo, criado_em, titulo, notas, criado_por, ativado_por, ativado_em";
const COLUNAS_LISTA_LEGADO = "id, chave, versao, ativo, criado_em";

/**
 * Lista as versões de formulário (todas — histórico nunca é apagado).
 * Qualquer papel interno lê: é a definição do POP 02, não dado de cliente.
 */
export async function GET() {
  try {
    await exigirInterno();

    const supabase = await criarClienteServidor();
    const consultar = (colunas: string) =>
      supabase
        .from("formularios")
        .select(colunas)
        .order("chave", { ascending: true })
        .order("versao", { ascending: false });

    let { data, error } = await consultar(COLUNAS_LISTA);
    if (error && migracaoPendente(error)) {
      // 0078 ainda não aplicada: devolve o que existe, sem inventar coluna.
      ({ data, error } = await consultar(COLUNAS_LISTA_LEGADO));
    }
    if (error) {
      registrarErro("api/formularios GET", error);
      throw error;
    }

    return NextResponse.json({ itens: (data as unknown as FormularioResumo[] | null) ?? [] });
  } catch (erro) {
    return respostaErro("api/formularios GET", erro);
  }
}

/**
 * FORMA da pergunta na borda HTTP — `.strict()` em todos os níveis (achado L3
 * do pentest r3). Antes era `z.record(z.string(), z.unknown())`: chave
 * desconhecida atravessava o TS e o SQL (que só olham as chaves que conhecem),
 * ia parar em `formularios.definicao` e saía dali para TODO cliente anônimo em
 * `app.payload_link_formulario`. Um campo `script` ou `webhook` no corpo do
 * POST viraria conteúdo servido no link público.
 *
 * O `opcoes` também ganha teto (`LIMITE_OPCOES`), espelhado em
 * `validarDefinicaoFormulario` e em `app.definicao_formulario_valida` (0081):
 * a definição inteira viaja no payload do link, e quem paga esse peso é o
 * celular de quem responde.
 *
 * Este schema é a FORMA; `validarDefinicaoFormulario` logo abaixo é a REGRA
 * (ids de sistema, condicional que aponta para trás, valor que existe nas
 * opções). Os dois, e o CHECK do banco atrás deles.
 */
const OpcaoSchema = z
  .object({
    valor: z.string().trim().min(1).max(120),
    rotulo: z.string().trim().min(1).max(200),
  })
  .strict();

const CondicionalSchema = z
  .object({
    depende_de: z.string().trim().min(1).max(40),
    igual: z.string().max(120).optional(),
    contem: z.string().max(120).optional(),
  })
  .strict();

const PerguntaSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    bloco: z.string().trim().min(1).max(80),
    tipo: z.enum(TIPOS_PERGUNTA),
    rotulo: z.string().trim().min(1).max(300),
    obrigatoria: z.boolean().optional(),
    // Aceita só o formato NOVO: a tela sobe `prepararParaPublicar`, que sempre
    // normaliza. O formato legado (`["a","b"]`) continua LIDO das versões já
    // gravadas — mas nenhuma versão nova nasce nele.
    opcoes: z.array(OpcaoSchema).min(2).max(LIMITE_OPCOES).optional(),
    condicional: CondicionalSchema.optional(),
  })
  .strict();

const CorpoSchema = z.object({
  chave: z.string().trim().min(1).max(50),
  titulo: z.string().trim().min(1).max(300).nullish(),
  definicao: z.array(PerguntaSchema).min(1),
  notas: z.string().trim().max(2000).nullish(),
  ativar: z.boolean().default(false),
});

/**
 * Clique duplo publica duas versões idênticas. Não é defesa contra abuso
 * externo (é admin autenticado): é defesa contra a mão pesada — por isso a
 * chave é o PERFIL, não o IP (a equipe inteira sai pelo mesmo IP do escritório).
 */
const limitarPublicacao = criarLimitadorJanela(10, 60_000);

interface ErroPostgrest {
  message: string;
  code?: string;
}

/**
 * `sqlerrm` da RPC → HTTP, com o texto que a tela mostra. O `raise` sempre
 * nomeia o id da pergunta, então o `detalhe` aponta a linha culpada.
 */
function mapearErroRpc(pg: ErroPostgrest) {
  const mensagem = pg.message ?? "";
  const depoisDoCodigo = mensagem.includes(": ") ? mensagem.slice(mensagem.indexOf(": ") + 2) : mensagem;

  if (mensagem.startsWith("sem_permissao")) {
    return NextResponse.json({ erro: "sem_permissao", mensagem: "Sem permissão para publicar o formulário." }, { status: 403 });
  }
  if (mensagem.startsWith("pergunta_de_sistema_removida")) {
    return NextResponse.json(
      { erro: "pergunta_de_sistema_removida", mensagem: depoisDoCodigo, detalhe: mensagem.split(": ")[1] ?? null },
      { status: 422 },
    );
  }
  if (pg.code === "23505") {
    return NextResponse.json(
      { erro: "conflito_de_versao", mensagem: "Outra publicação aconteceu ao mesmo tempo. Recarregue e tente de novo." },
      { status: 409 },
    );
  }
  if (pg.code === "22023" || pg.code === "22004") {
    return NextResponse.json({ erro: "definicao_invalida", mensagem: depoisDoCodigo, detalhe: mensagem }, { status: 400 });
  }
  return null;
}

/**
 * POST /api/formularios — publica a VERSÃO N+1 do POP 02.
 *
 * Chama `publicar_formulario_versao` (0078), que faz desativar-anterior +
 * inserir-nova numa transação só. O caminho antigo (dois `await` do
 * supabase-js) deixava a chave PERMANENTEMENTE sem versão ativa quando o
 * segundo falhava — e aí `app.payload_link_formulario` devolve `definicao: []`
 * e o formulário do cliente morre em silêncio.
 *
 * Nunca UPDATE em `definicao` de versão existente: a resposta de 2026-06
 * precisa continuar apontando para a pergunta contra a qual foi dada.
 */
export async function POST(request: NextRequest) {
  try {
    const usuario = await exigirPapel("admin");

    const limite = limitarPublicacao(usuario.id);
    if (limite.excedido) {
      return NextResponse.json(
        {
          erro: "limite_excedido",
          mensagem: `Muitas publicações em sequência. Tente de novo em ${limite.tenteEmS} s.`,
          tente_em_s: limite.tenteEmS,
        },
        { status: 429, headers: { "Retry-After": String(limite.tenteEmS) } },
      );
    }

    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    if (!chaveFormularioValida(corpo.chave)) {
      throw erroValidacao({ chave: corpo.chave }, "A chave do formulário aceita minúsculas, dígitos e _.");
    }

    // Trava de entrada: a mesma regra que a RPC aplica, avaliada aqui para
    // devolver TODOS os erros de uma vez (a RPC pararia no primeiro) e para a
    // tela apontar a pergunta culpada.
    const problemas = validarDefinicaoFormulario(corpo.definicao, corpo.chave);
    if (problemas.length > 0) {
      return NextResponse.json(
        {
          erro: problemas[0].codigo,
          mensagem: problemas[0].mensagem,
          detalhes: problemas,
        },
        { status: 400 },
      );
    }

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .rpc("publicar_formulario_versao", {
        p_chave: corpo.chave,
        p_definicao: corpo.definicao,
        p_titulo: corpo.titulo ?? null,
        p_notas: corpo.notas ?? null,
        p_ativar: corpo.ativar,
        p_criado_por: usuario.id,
      })
      .single<Formulario>();

    if (error) {
      if (migracaoPendente(error)) {
        return respostaMigracaoPendente("0078", "publicar_formulario_versao não existe neste banco");
      }
      const resposta = mapearErroRpc(error as ErroPostgrest);
      if (resposta) return resposta;
      registrarErro("api/formularios POST", error, { chave: corpo.chave, perfil_id: usuario.id });
      throw error;
    }

    return NextResponse.json({ formulario: data }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/formularios POST", erro);
  }
}
