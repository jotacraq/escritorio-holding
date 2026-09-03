export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno, exigirPapel } from "@/server/auth";
import { ErroApi, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { exigirPepper, gerarToken, hashToken } from "@/server/publico/pepper";
import { gerarSugestoesAgendamento } from "@/server/agenda/sugestoes";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { APP_URL } from "@/lib/config-publica";
import type {
  LinkPublicoResumo,
  RespostaEmitirLinkPublico,
  RespostaListarLinksPublicos,
  TipoLinkPublico,
} from "@/types/publico";

const ParametroSchema = z.object({ id: z.string().uuid() });
const CorpoSchema = z.object({
  tipo: z.enum(["formulario", "agendamento", "documentos", "material"]),
});

/** Segmento de URL por finalidade (§4.1: `/p/f`, `/p/a`, `/p/d`, `/p/m`). */
const SEGMENTO_POR_TIPO: Record<TipoLinkPublico, string> = {
  formulario: "f",
  agendamento: "a",
  documentos: "d",
  material: "m",
};

interface LinhaLinkPublico {
  id: string;
  tipo: TipoLinkPublico;
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
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Trava de ROTA (mesma trava que a RPC confere de novo — as duas são obrigatórias,
    // ver docstring de `exigirPapel` em src/server/auth.ts).
    const usuario = await exigirPapel("admin", "advogada", "relacionamento");
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

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
