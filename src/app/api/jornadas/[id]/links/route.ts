export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno, exigirPapel } from "@/server/auth";
import { ErroApi, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { exigirPepper, gerarToken, hashToken } from "@/server/publico/pepper";
import { gerarSugestoesAgendamento } from "@/server/agenda/sugestoes";
import { emitirLinkConfirmacaoSistema } from "@/server/regua/links";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarLimitadorJanela } from "@/server/integracoes/rate-limit";
import { registrarLinkNaTimeline } from "@/server/publico/timeline-links";
import { APP_URL } from "@/lib/config-publica";
import type { UsuarioAtual } from "@/server/auth";
import type {
  LinkPublicoResumo,
  RespostaEmitirLinkPublico,
  RespostaListarLinksPublicos,
  TipoLinkQualquer,
} from "@/types/publico";

/**
 * Rate limit da EMISSÃO (achado BAIXO do pentest da Fase 6, CWE-770 / OWASP
 * API4: "rota de emissão da equipe sem rate limit nem cooldown — cada chamada
 * é destrutiva e `agendamento` gasta IA"). Três motivos para existir:
 *
 * 1. Emitir REVOGA o link ativo do mesmo tipo (`emitir_link_publico`,
 *    0028:829-836). Um loop de cliques mata, um a um, links que o cliente já
 *    recebeu no WhatsApp — sem aviso e sem desfazer.
 * 2. `tipo='agendamento'` chama `gerarSugestoesAgendamento`, que grava em
 *    `execucoes_ia`: cada clique custa dinheiro.
 * 3. Cada emissão é uma linha nova em `links_publicos` — crescimento sem teto
 *    a partir de um único usuário autenticado.
 *
 * A chave é o PERFIL, não o IP: o escritório inteiro sai por um IP só, e
 * limitar por IP puniria a sala pelo excesso de uma pessoa (o inverso do que o
 * achado pede). 20 emissões por 10 minutos é folgado para o uso real (a barra
 * "Enviar" emite 1 por item) e fecha o abuso automatizado.
 *
 * Limitação conhecida e aceita, igual à dos webhooks: contador EM MEMÓRIA, por
 * instância Node. A Hostinger roda uma instância; se um dia rodar mais, o teto
 * efetivo vira 20 × instâncias — ainda um teto.
 */
const LIMITE_EMISSOES = 20;
const JANELA_EMISSOES_MS = 10 * 60_000;
const limitarEmissao = criarLimitadorJanela(LIMITE_EMISSOES, JANELA_EMISSOES_MS);

/** 429 com `tente_em_s` no CORPO (contrato pedido) e em `Retry-After` (contrato HTTP). */
function resposta429(tenteEmS: number) {
  return NextResponse.json(
    {
      erro: "limite_excedido",
      mensagem: `Muitos links emitidos em sequência. Tente de novo em ${tenteEmS} s.`,
      tente_em_s: tenteEmS,
    },
    { status: 429, headers: { "Retry-After": String(tenteEmS) } },
  );
}

const ParametroSchema = z.object({ id: z.string().uuid() });
const CorpoSchema = z.object({
  // Fase 6 §5.3: `confirmacao` entra na rota que já existe — a equipe passa a
  // poder emitir o link de confirmação de presença, que antes só nascia no
  // envio da D-7. Zero rota nova, zero grant, zero migration.
  tipo: z.enum(["formulario", "agendamento", "confirmacao", "documentos", "material"]),
});

/** Segmento de URL por finalidade (§4.1: `/p/f`, `/p/a`, `/p/c`, `/p/d`, `/p/m`). */
const SEGMENTO_POR_TIPO: Record<TipoLinkQualquer, string> = {
  formulario: "f",
  agendamento: "a",
  confirmacao: "c",
  documentos: "d",
  material: "m",
};

interface LinhaLinkPublico {
  id: string;
  tipo: TipoLinkQualquer;
  estado: LinkPublicoResumo["estado"];
  token_prefixo: string;
  expira_em: string;
  usos: number;
  criado_em: string;
  revogado_em: string | null;
}

function paraResumo(linha: LinhaLinkPublico): LinkPublicoResumo {
  return {
    id: linha.id,
    tipo: linha.tipo,
    estado: linha.estado,
    token_prefixo: linha.token_prefixo,
    expira_em: linha.expira_em,
    usos: linha.usos,
    criado_em: linha.criado_em,
    revogado_em: linha.revogado_em,
  };
}

/** GET /api/jornadas/[id]/links — toda a equipe interna enxerga (mesmo recorte de `lp_sel`). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("links_publicos")
      .select("id, tipo, estado, token_prefixo, expira_em, usos, criado_em, revogado_em")
      .eq("jornada_id", jornadaId)
      .order("criado_em", { ascending: false });

    if (error) throw error;

    const resposta: RespostaListarLinksPublicos = { itens: (data as LinhaLinkPublico[]).map(paraResumo) };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("GET /api/jornadas/[id]/links", erro);
  }
}

/**
 * POST /api/jornadas/[id]/links — emite um link público novo (mata o anterior do
 * mesmo tipo, atomicamente, dentro de `emitir_link_publico`). Devolve a URL completa
 * com o token em claro UMA ÚNICA VEZ — nenhuma outra rota volta a mostrá-la (§4.1).
 *
 * Link de tipo 'agendamento' também precisa de `agendamentos_sugestoes` populada —
 * sem isso `escolher_horario_publico` (0028) nunca acha horário nenhum e a página
 * pública sempre mostra vazio. `gerarSugestoesAgendamento` (src/server/agenda/sugestoes.ts,
 * B-1B) calcula as linhas; gravá-las é responsabilidade desta rota, na MESMA
 * requisição que emite o link (nunca antes de existir o `link_id`).
 */
/**
 * Ramo `confirmacao` (Fase 6 §5.3). Três coisas o desenho não abre mão:
 *
 * 1. **`agendamento_id` sai do SERVIDOR, nunca do corpo.** Aceitá-lo do cliente
 *    seria IDOR: emitir link de confirmação para a sessão de outra família. A
 *    leitura é feita com o cliente do USUÁRIO (RLS), escopada pela jornada da
 *    URL — quem não enxerga a jornada não acha o agendamento.
 * 2. **Sem `service_role`, 503 rotulado — nunca link pela metade.** A RPC
 *    `emitir_link_confirmacao_sistema` (0051:521-522) é `service_role` only.
 *    Mesmo padrão do ramo `agendamento` (linhas 126-139).
 * 3. **Sem agendamento ativo, 409 com código estável, nunca 500.** O `check`
 *    `ck_link_confirmacao_agendamento` (0051:285-286) recusaria de qualquer
 *    forma; aqui a recusa vem com frase de gente, antes de tocar no banco.
 *
 * A trava de papel é a da rota (`exigirPapel`, mais acima): a RPC roda como
 * `service_role` e NÃO confere papel — esta rota é a única barreira, e por isso
 * o ramo fica depois de `exigirPapel`, nunca antes.
 */
async function emitirConfirmacao(
  supabase: Awaited<ReturnType<typeof criarClienteServidor>>,
  jornadaId: string,
  usuario: UsuarioAtual,
): Promise<NextResponse> {
  const { data: sessao, error: erroSessao } = await supabase
    .from("sessoes_viabilidade")
    .select("id")
    .eq("jornada_id", jornadaId)
    .maybeSingle<{ id: string }>();
  if (erroSessao) throw erroSessao;
  if (!sessao) {
    throw new ErroApi(
      409,
      "sem_agendamento",
      "Ainda não há sessão marcada para confirmar. Marque a sessão antes de enviar o link de confirmação.",
    );
  }

  // O mesmo filtro de `emitir_link_confirmacao_sistema` (0051:498): só
  // agendamento ativo. `remarcado`/`cancelado` já teve o link revogado pelo
  // gatilho `revoga_link_confirmacao` (0051:193-204) — não se ressuscita.
  const { data: agendamento, error: erroAgendamento } = await supabase
    .from("agendamentos")
    .select("id")
    .eq("sessao_id", sessao.id)
    .in("status", ["agendado", "confirmado"])
    .order("inicio_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (erroAgendamento) throw erroAgendamento;
  if (!agendamento) {
    throw new ErroApi(
      409,
      "sem_agendamento",
      "Ainda não há sessão marcada para confirmar. Marque a sessão antes de enviar o link de confirmação.",
    );
  }

  let admin;
  try {
    admin = criarClienteAdmin();
  } catch (erroServiceRole) {
    registrarErro("POST /api/jornadas/[id]/links#confirmacao_service_role_ausente", erroServiceRole, {
      jornada_id: jornadaId,
    });
    throw new ErroApi(
      503,
      "servico_indisponivel",
      "Link de confirmação exige SUPABASE_SERVICE_ROLE_KEY no servidor — indisponível agora.",
    );
  }

  try {
    // `usuario.id` vai como AUTOR: quem clicou na barra "Enviar" é uma pessoa,
    // não o cron — sem isto o link nasce `criado_por = null` e a trilha diz
    // "sistema" para um ato humano (achado BAIXO do pentest da Fase 6, CWE-778).
    // Enquanto a 0074 não estiver aplicada, `emitirLinkConfirmacaoSistema`
    // cai sozinha na assinatura de 3 argumentos e o link sai sem autor, como hoje.
    const { url, linha } = await emitirLinkConfirmacaoSistema(admin, agendamento.id, usuario.id);
    await registrarLinkNaTimeline(supabase, {
      jornadaId,
      tipo: "confirmacao",
      linkId: linha.id,
      atorPerfilId: usuario.id,
      contexto: "POST /api/jornadas/[id]/links#confirmacao",
    });
    const resposta: RespostaEmitirLinkPublico = { link: { ...paraResumo(linha), url } };
    return NextResponse.json(resposta, { status: 201 });
  } catch (erro) {
    // Corrida com o gatilho de remarcação: entre a leitura acima e a RPC o
    // agendamento pode ter saído de `agendado`. 409, nunca 500.
    if ((erro as { code?: string }).code === "P0002") {
      throw new ErroApi(
        409,
        "sem_agendamento",
        "A sessão mudou enquanto o link era emitido. Recarregue a Ficha e tente de novo.",
      );
    }
    // Nada do que sai daqui carrega token: `emitirLinkConfirmacaoSistema` só o
    // devolve no caminho de sucesso.
    registrarErro("POST /api/jornadas/[id]/links#confirmacao", erro, { jornada_id: jornadaId });
    throw erro;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Trava de ROTA (mesma trava que a RPC confere de novo — as duas são obrigatórias,
    // ver docstring de `exigirPapel` em src/server/auth.ts).
    const usuario = await exigirPapel("admin", "advogada", "relacionamento");

    // Rate limit DEPOIS da autenticação (a chave é o perfil) e ANTES de ler o
    // corpo ou tocar no banco: quem está no teto não gasta consulta nenhuma.
    const limite = limitarEmissao(usuario.id);
    if (limite.excedido) return resposta429(limite.tenteEmS);

    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    if (corpo.tipo === "confirmacao") {
      return await emitirConfirmacao(supabase, jornadaId, usuario);
    }

    // Resolve a advogada ANTES de emitir o link — nunca depois: emitir mata o
    // link ativo anterior (efeito colateral destrutivo), e uma falha descoberta
    // só depois disso custaria o link anterior de graça.
    let advogadaId: string | null = null;
    if (corpo.tipo === "agendamento") {
      const { data: sessao, error: erroSessao } = await supabase
        .from("sessoes_viabilidade")
        .select("advogada_id")
        .eq("jornada_id", jornadaId)
        .maybeSingle<{ advogada_id: string | null }>();
      if (erroSessao) throw erroSessao;
      // Sem sessão ainda, ou sessão sem advogada atribuída: NUNCA inventa uma —
      // achado do agente da agenda: cair para o id de `usuario` (quem está
      // emitindo o link, que pode ser 'relacionamento') geraria sugestão para a
      // agenda errada. `null` aqui é honesto; o aviso mais abaixo explica.
      advogadaId = sessao?.advogada_id ?? null;

      // `agendamentos_sugestoes` e `execucoes_ia` (via `gerarSugestoesAgendamento`)
      // não aceitam escrita de `authenticated` (0029) — só `service_role`. Só
      // checamos a chave quando HÁ advogada: sem ela não geraríamos sugestão
      // nenhuma de qualquer forma, e a ausência de service_role não seria o
      // motivo real da falha.
      if (advogadaId) {
        try {
          criarClienteAdmin();
        } catch (erroServiceRole) {
          registrarErro("POST /api/jornadas/[id]/links#service_role_ausente", erroServiceRole, {
            jornada_id: jornadaId,
          });
          throw new ErroApi(
            503,
            "servico_indisponivel",
            "Link de agendamento exige SUPABASE_SERVICE_ROLE_KEY para gerar os horários ofertados — indisponível agora.",
          );
        }
      }
    }

    // Fail-closed: sem pepper, não dá para gerar um hash seguro — nem tenta.
    const pepper = exigirPepper();
    const token = gerarToken();
    const tokenHash = hashToken(token, pepper);
    const tokenPrefixo = token.slice(0, 6);

    const { data: linkBruto, error } = await supabase
      .rpc("emitir_link_publico", {
        p_jornada_id: jornadaId,
        p_tipo: corpo.tipo,
        p_token_hash: tokenHash,
        p_token_prefixo: tokenPrefixo,
      })
      .single<LinhaLinkPublico>();

    if (error) {
      if (error.code === "P0002") throw erroNaoEncontrado("Jornada não encontrada ou fechada.");
      registrarErro("POST /api/jornadas/[id]/links", error, { jornada_id: jornadaId });
      throw error;
    }

    await registrarLinkNaTimeline(supabase, {
      jornadaId,
      tipo: corpo.tipo,
      linkId: linkBruto.id,
      atorPerfilId: usuario.id,
      contexto: "POST /api/jornadas/[id]/links",
    });

    let horariosOfertados = 0;
    let avisoAgendamento: string | null = null;

    if (corpo.tipo === "agendamento") {
      if (!advogadaId) {
        avisoAgendamento = "Link criado sem horários: a sessão ainda não tem advogada responsável.";
      } else {
        // Já confirmamos acima que `service_role` está disponível — se falhar
        // aqui é um erro de verdade (rede, RPC, etc.), não infraestrutura ausente.
        try {
          const admin = criarClienteAdmin();
          const sugestoes = await gerarSugestoesAgendamento(admin, {
            jornadaId,
            advogadaId,
            criadoPor: usuario.id,
          });

          if (sugestoes.itens.length === 0) {
            avisoAgendamento =
              "Link criado sem horários: não há disponibilidade aberta na agenda para o período.";
          } else {
            const { error: erroSugestoes } = await admin.from("agendamentos_sugestoes").insert(
              sugestoes.itens.map((item) => ({
                link_id: linkBruto.id,
                inicio_em: item.inicio_em,
                fim_em: item.fim_em,
                posicao: item.posicao,
                motivo_sugestao: item.motivo_sugestao,
                execucao_ia_id: item.execucao_ia_id,
              })),
            );
            if (erroSugestoes) throw erroSugestoes;
            horariosOfertados = sugestoes.itens.length;
          }
        } catch (erroSugestao) {
          // O link já existe e é válido — não derrubamos a emissão por causa das
          // sugestões, mas também não escondemos: fica consultável e a resposta avisa.
          registrarErro("POST /api/jornadas/[id]/links#sugestoes", erroSugestao, { jornada_id: jornadaId });
          avisoAgendamento =
            "Link criado, mas não foi possível ofertar horários agora. Verifique a agenda e emita de novo.";
        }
      }
    }

    const url = `${APP_URL}/p/${SEGMENTO_POR_TIPO[corpo.tipo]}/${token}`;
    const resposta: RespostaEmitirLinkPublico = {
      link: { ...paraResumo(linkBruto), url },
      ...(corpo.tipo === "agendamento" ? { horarios_ofertados: horariosOfertados } : {}),
      ...(avisoAgendamento ? { aviso: avisoAgendamento } : {}),
    };
    return NextResponse.json(resposta, { status: 201 });
  } catch (erro) {
    return respostaErro("POST /api/jornadas/[id]/links", erro);
  }
}
