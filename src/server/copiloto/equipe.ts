import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Quem é do ESCRITÓRIO, para a resolução de papel de fala — Marcio,
 * 18/09/2026.
 *
 * Existe porque `resolverPapelNoJoin` elegia a advogada por `isHost` (quem
 * abriu a sala no Meet). Medido ao vivo na sessão do Carlos Alberto
 * (`b3eca233`): o "Marco - Staff" abriu a reunião, levou o papel "advogada" e
 * saiu aos 3 minutos; a Dra. Elaine entrou depois e caiu em
 * `acompanhante_2`, o cliente em `acompanhante_1`. Com `papeis_de_fala`
 * ligado, a IA passou 1h30 sem saber quem conduzia a sessão.
 *
 * A regra do dono: **a advogada é reconhecida pela identidade, nunca por quem
 * clicou primeiro.** Quem casa com um perfil `papel='advogada'` conduz; o
 * resto da equipe ativa apoia (`assistente`). Fora da equipe, a resolução
 * segue para decisor do briefing / acompanhante, como antes.
 *
 * 🔴 POR QUE NÃO USAR `perfis_equipe.papel`: `papel` é ACESSO, não função na
 * sessão. A Dra. Elaine é `admin` — e trocá-la para `advogada` tiraria dela a
 * visão irrestrita de pendências (`blocosPorPapel.ts::pendenciaVisivelPara`
 * libera tudo só para `admin`; medido: perderia `webhook_falho` e
 * `bot_nao_encerrado`). Consertar a diarização não pode custar acesso a ela.
 *
 * Quem conduz é lido de `configuracoes.copiloto_sessao.advogadas_emails` —
 * lista de e-mails, o identificador estável (o nome muda de grafia entre Meet,
 * cadastro e tratamento; e-mail não). Todo o resto da equipe ativa é
 * `assistente`.
 */

export interface EquipeDoEscritorio {
  /** `perfis_equipe.nome` de quem conduz a sessão (`papel='advogada'`). */
  advogadas: string[];
  /** Demais perfis ativos — apoio do escritório na sala. */
  assistentes: string[];
}

export const EQUIPE_VAZIA: EquipeDoEscritorio = { advogadas: [], assistentes: [] };

/**
 * 🔴 O NOME NA SALA NÃO É O NOME DO CADASTRO. Medido na sessão do Carlos
 * Alberto: o Meet mostrou **"Elaine Montenegro"**, e `perfis_equipe` guarda
 * **"Dra. Elaine Montenegro"**. `normalizarNome` compara por IGUALDADE (só
 * tira acento, caixa e espaço repetido) — sem tirar o tratamento, o
 * casamento falharia em silêncio e a correção não valeria de nada na prática.
 *
 * Tira só TRATAMENTO PROFISSIONAL no início do nome (dr/dra/doutor/doutora,
 * com ou sem ponto). Não mexe no resto: sobrenome, nome composto e partículas
 * seguem intactos, porque encurtar mais aumentaria a chance de casar duas
 * pessoas diferentes — e casar errado é pior que não casar (mesma postura do
 * porteiro da Fase 9: ambíguo não casa).
 */
export function semTratamento(nome: string): string {
  return nome.replace(/^\s*(dr|dra|doutor|doutora)\.?\s+/i, "").trim();
}

interface LinhaPerfil {
  nome: string | null;
  email: string | null;
  papel: string | null;
}

/** `copiloto_sessao.advogadas_emails` — array de e-mails de quem CONDUZ a
 * sessão. Editável em Admin → Configurações, sem migration e sem mexer no
 * papel de acesso de ninguém. Ausente/ilegível → conjunto vazio (o chamador
 * degrada para `isHost` — ver a guarda `equipeUsavel` em
 * `participantes.ts::resolverPapelNoJoin`). */
async function lerEmailsDeAdvogadas(admin: SupabaseClient): Promise<Set<string>> {
  try {
    const { data, error } = await admin
      .from("configuracoes")
      .select("valor")
      .eq("chave", CHAVE_ADVOGADAS_EMAILS)
      .maybeSingle<{ valor: unknown }>();
    if (error || !Array.isArray(data?.valor)) return new Set();
    return new Set(
      data.valor.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0),
    );
  } catch {
    return new Set();
  }
}

export const CHAVE_ADVOGADAS_EMAILS = "copiloto_sessao.advogadas_emails";

/**
 * Lê a equipe ATIVA. Segue a mesma postura de
 * `buscarDecisoresEsperadosDaSessao` (entrada-bot.ts): **nunca lança**. Em
 * qualquer ausência ou erro devolve `EQUIPE_VAZIA`, e o chamador cai no
 * comportamento anterior — um perfil ilegível jamais pode impedir o registro
 * do join do participante.
 *
 * Custo: roda só no evento `join` de quem ainda não tem papel na sessão
 * (algumas vezes por sessão), nunca no polling de 3 s. `perfis_equipe` é uma
 * tabela de dezenas de linhas, com filtro por `ativo`.
 */
export async function carregarEquipeDoEscritorio(admin: SupabaseClient): Promise<EquipeDoEscritorio> {
  try {
    const [perfis, emailsConfigurados] = await Promise.all([
      admin.from("perfis_equipe").select("nome, email, papel").eq("ativo", true).returns<LinhaPerfil[]>(),
      lerEmailsDeAdvogadas(admin),
    ]);
    if (perfis.error || !Array.isArray(perfis.data)) return EQUIPE_VAZIA;

    const advogadas: string[] = [];
    const assistentes: string[] = [];
    for (const linha of perfis.data) {
      const nome = linha.nome?.trim();
      if (!nome) continue; // sem nome não há como casar com o falante da sala
      const email = linha.email?.trim().toLowerCase();
      // Conduz se o e-mail está na lista OU se o papel é explicitamente
      // `advogada` (o enum já existe; quem quiser usá-lo continua valendo).
      const conduz = (email !== undefined && emailsConfigurados.has(email)) || linha.papel === "advogada";
      if (conduz) advogadas.push(nome);
      else assistentes.push(nome);
    }
    return { advogadas, assistentes };
  } catch {
    return EQUIPE_VAZIA;
  }
}
