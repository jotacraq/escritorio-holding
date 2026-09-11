-- 0097_copiloto_pendencia_encerramento_bot.sql
-- Fase 10 · Fatia 4 — correção de Solidificação, DUAS RODADAS de achados do
-- Fable sobre o MESMO problema:
--
-- RODADA 1 (achado 4): "retention: forever + encerrarBot falhando = a
-- catástrofe do B76" (docs/ARQUITETURA-FASE-10.md §4.2.1/§4.2.2). Detectar
-- retenção infinita e FALHAR ao encerrar o bot, tratado só como linha de
-- log, é exatamente o cenário que B76 existe para impedir: o bot segue na
-- sala real, gravando a sessão inteira com retenção indefinida, e o 409
-- devolvido pela rota afirmava algo FALSO ("o bot foi encerrado").
--
-- RODADA 2 (achados A e B, sobre ESTA MIGRATION): "você corrigiu o ramo raro
-- e deixou o comum" — a coluna só era escrita em `bot/route.ts` (ramo de
-- retenção infinita), mas `encerrar.ts::tirarBotDaSalaSeHouver` (o caminho
-- COMUM: encerramento manual e por duração máxima) continuava chamando
-- `encerrarBot()` cru, sem retentativa, só com `registrarErro` em falha —
-- stdout, invisível. E "ninguém limpa a pendência": nada escrevia NULL de
-- volta, e a rota de encerrar recusava sessão já `'encerrado'` sem chance de
-- retentar — pendência resolvida à mão ficava ETERNA no Painel do dia.
-- CORRIGIDO: `tirarBotDaSalaSeHouver` agora usa `encerrarBotComRetentativa`
-- nos TRÊS caminhos, grava a MESMA pendência em falha e a LIMPA em sucesso;
-- `POST .../copiloto/encerrar` ganhou uma retentativa para sessão já
-- encerrada com pendência (`tentarNovamenteEncerrarBotPendente`).
--
-- RODADA 3 (achado final): "o ciclo da pendência fechou para 1 dos 3
-- nascedouros". A pendência nasce em TRÊS lugares — `tirarBotDaSalaSeHouver`
-- (caminho comum, corrigido na Rodada 2) E os DOIS upserts de erro em
-- `bot/route.ts` (retenção infinita, falha ao persistir vínculo). Os dois
-- upserts de `bot/route.ts` gravavam a pendência SEM `gravacao_externa_id`
-- (só o bot_id no TEXTO da mensagem) e com `estado='erro'` — e
-- `tentarNovamenteEncerrarBotPendente` exige `gravacao_externa_id` para
-- tentar de novo, e o gate do retry só cobria `estado==='encerrado'`, e
-- `marcarEncerrada` só aceitava `'aguardando'/'ativo'` como origem. As TRÊS
-- travas juntas deixavam essas duas sessões BRICADAS: mesmo com o humano
-- removendo o bot da sala à mão, não havia caminho de volta.
-- CORRIGIDO: os dois upserts de `bot/route.ts` agora gravam
-- `gravacao_externa_id`; o gate do retry cobre `'encerrado' || 'erro'`;
-- `marcarEncerrada` aceita `'erro'` como origem (com o fluxo COMPLETO de
-- consolidação, porque essas sessões nunca passaram por ele).
--
-- 100% ADITIVA. Nenhuma tabela, coluna ou policy existente é alterada,
-- exceto `vw_pendencias_sistema`, recriada via `create or replace` (mesma
-- mecânica de toda migration anterior que a tocou — 0031/.../0089) para
-- incluir a cláusula nova. RLS/GRANT de `sessoes_copiloto` já cobrem a
-- coluna nova (policy é por LINHA, não por coluna — 0091).
--
-- O QUE ENTRA
--   (a) sessoes_copiloto.pendencia_encerramento_bot (text) +
--       sessoes_copiloto.pendencia_encerramento_bot_em (timestamptz) — as
--       DUAS nascem NULL. Preenchidas juntas quando o servidor tenta
--       encerrar o bot (por qualquer caminho: retenção infinita detectada,
--       clique manual, duração máxima) e a tentativa (com 1 retentativa)
--       FALHA — `_em` é o instante da FALHA, não o de criação da sessão
--       (`criado_em` seria uma aproximação errada: a sessão pode ter sido
--       criada horas antes da tentativa de encerrar falhar). É o que torna
--       a falha de encerramento uma PENDÊNCIA VISÍVEL em
--       `vw_pendencias_sistema`, não só uma linha em `erros_servidor` que
--       ninguém olha por padrão. Limpas (voltam a NULL) juntas quando um
--       encerramento subsequente tem sucesso — ver
--       `server/copiloto/encerrar.ts::tirarBotDaSalaSeHouver` e
--       `tentarNovamenteEncerrarBotPendente`.
--   (b) vw_pendencias_sistema — nova cláusula `bot_nao_encerrado`: qualquer
--       sessão com `pendencia_encerramento_bot is not null` aparece na
--       lista, com a instrução operacional literal (mesmo texto que a rota
--       devolve ao cliente, §4.2.1 do plano: "encerre a reunião ou remova o
--       participante 'Assistente...' da sala"), ordenada por
--       `pendencia_encerramento_bot_em` (o instante real da pendência).
--
-- ROTEIRO DE VERIFICAÇÃO: `scripts/verificacao-fatia4-copiloto-bot.sql` §4 —
-- ESCRITO e OBRIGATÓRIO de rodar ANTES de aplicar esta migration (a view é
-- recriada por `create or replace`: divergência entre o texto do repo e o
-- `pg_get_viewdef` real do banco APAGA EM SILÊNCIO qualquer cláusula que só
-- exista no banco — armadilha catalogada na Fase 9, citada no plano §6.2).
--
-- ROLLBACK:
--   -- restaurar vw_pendencias_sistema para o texto de 0089 (sem a cláusula
--   -- bot_nao_encerrado) — colar o create-or-replace de 0089:211-368 aqui;
--   alter table sessoes_copiloto drop column if exists pendencia_encerramento_bot_em;
--   alter table sessoes_copiloto drop column if exists pendencia_encerramento_bot;
-- ===========================================================================


-- ===========================================================================
-- (a) A coluna de pendência.
-- ===========================================================================
alter table sessoes_copiloto
  add column if not exists pendencia_encerramento_bot text;
alter table sessoes_copiloto
  add column if not exists pendencia_encerramento_bot_em timestamptz;

comment on column sessoes_copiloto.pendencia_encerramento_bot is
  'Fase 10, Fatia 4 (achado 4 do Fable). NULL = sem pendência. Preenchido '
  'quando o servidor tentou encerrar o bot (retenção infinita, clique '
  'manual, duração máxima) e falhou mesmo após retentativa — a sessão pode '
  'ter um bot gravando na sala real, invisível para o sistema. Limpo '
  '(volta a NULL) quando um encerramento subsequente tem sucesso — ver '
  'server/copiloto/encerrar.ts::tirarBotDaSalaSeHouver/tentarNovamenteEncerrarBotPendente.';
comment on column sessoes_copiloto.pendencia_encerramento_bot_em is
  'Fase 10, Fatia 4 (achado C do Fable — cosmético corrigido: a view usava '
  'sc.criado_em, que é a CRIAÇÃO DA SESSÃO, não o instante da falha de '
  'encerramento). NULL junto com pendencia_encerramento_bot. É o que '
  'vw_pendencias_sistema usa para ordenar/mostrar quando a pendência surgiu.';


-- ===========================================================================
-- (b) vw_pendencias_sistema — recriada com a nova cláusula. Texto idêntico
-- ao de 0089:211-368 + a cláusula `bot_nao_encerrado` inserida antes do
-- `order by` final.
-- ===========================================================================
create or replace view vw_pendencias_sistema with (security_invoker = true) as
select
  w.id::text as id,
  (case when w.erro = 'produto_nao_mapeado' then 'produto_nao_mapeado' else 'webhook_falho' end)::text as tipo,
  (case when w.erro = 'produto_nao_mapeado'
        then 'Venda de produto não mapeado'
        else 'Webhook não processado' end)::text as titulo,
  case when w.erro = 'produto_nao_mapeado'
       then 'A Hotmart mandou uma venda do produto '
            || coalesce(nullif(w.bruto -> 'data' -> 'product' ->> 'id', ''), '(sem id no payload)')
            || ', que não está ligado a nenhum produto do sistema. O dinheiro entrou e a jornada não anda até alguém mapear esse ID.'
       else coalesce(w.erro, 'Sem detalhe de erro registrado — ver tentativas.') end as descricao,
  null::uuid as jornada_id,
  null::text as pessoa_nome,
  w.recebido_em as ocorrido_em
from webhooks_eventos w
where w.processado_em is null
union all
select
  m.id::text,
  'mensagem_falhou'::text,
  'Mensagem da régua falhou'::text,
  coalesce(m.erro, 'Sem detalhe de erro registrado.'),
  m.jornada_id,
  p.nome,
  coalesce(m.enviada_em, m.criado_em)
from mensagens_agendadas m
join jornadas j on j.id = m.jornada_id
join pessoas p on p.id = j.pessoa_id
where m.status = 'falhou'
union all
select
  l.id::text,
  'link_expirando'::text,
  'Link público expirando em breve'::text,
  'Expira em ' || to_char(l.expira_em at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'),
  l.jornada_id,
  p.nome,
  l.expira_em
from links_publicos l
join jornadas j on j.id = l.jornada_id
join pessoas p on p.id = j.pessoa_id
where l.estado = 'ativo'
  and l.expira_em <= now() + interval '48 hours'
union all
select
  mg.id::text,
  'material_aguardando_aprovacao'::text,
  'Material pós-sessão aguardando aprovação'::text,
  case
    when mg.fonte_dor = 'nenhuma' then 'Material padrão (sem dor identificada) — revisar antes de aprovar.'
    else 'Personalizado pela dor declarada — revisar antes de aprovar.'
  end,
  mg.jornada_id,
  p.nome,
  mg.criado_em
from materiais_gerados mg
join jornadas j on j.id = mg.jornada_id
join pessoas p on p.id = j.pessoa_id
where mg.atual and mg.aprovado_em is null
union all
select
  a.id::text,
  'sessao_sem_sala'::text,
  'Sessão sem link da sala'::text,
  'Sessão em ' || greatest(0, floor(extract(epoch from (a.inicio_em - now())) / 3600))::int
    || ' h sem link da sala — cole o link ou ligue a integração (N8N_WEBHOOK_SALA_URL, Admin → Integrações).',
  j.id,
  p.nome,
  a.inicio_em
from agendamentos a
join sessoes_viabilidade s on s.id = a.sessao_id
join jornadas j on j.id = s.jornada_id
join pessoas p on p.id = j.pessoa_id
where a.status in ('agendado', 'confirmado')
  and s.link_sala is null
  and a.inicio_em > now() - interval '1 hour'
  and a.inicio_em <= now() + interval '24 hours'
union all
select
  'cron'::text,
  'cron_parado'::text,
  'A régua não está rodando'::text,
  'A régua ainda não roda sozinha: falta o cron da Hostinger chamar /api/cron/regua a cada 5 minutos com o CRON_SECRET de produção. Última passagem registrada: '
    || case
         when c.valor = 'null'::jsonb then 'nunca'
         else 'há ' || greatest(0, floor(extract(epoch from (now() - (c.valor #>> '{}')::timestamptz)) / 60))::int || ' min'
       end || '.',
  null::uuid,
  null::text,
  case when c.valor = 'null'::jsonb then null else (c.valor #>> '{}')::timestamptz end
from configuracoes c
where c.chave = 'regua.ultimo_cron_em'
  and (c.valor = 'null'::jsonb or (c.valor #>> '{}')::timestamptz < now() - interval '15 minutes')
union all
select
  ts.id::text,
  'expurgo_storage_pendente'::text,
  'Expurgo de arquivos pendente'::text,
  'O tratamento deste titular foi encerrado, mas '
    || jsonb_array_length(ts.resultado -> 'storage_pendente')
    || ' arquivo(s) continuam no armazenamento. Abra Cadastro -> Direitos do titular e conclua o expurgo.',
  null::uuid,
  p.nome,
  ts.executado_em
from titulares_solicitacoes ts
join pessoas p on p.id = ts.pessoa_id
where ts.tipo = 'anonimizacao'
  and ts.resultado ->> 'storage_removido_em' is null
  and jsonb_typeof(ts.resultado -> 'storage_pendente') = 'array'
  and jsonb_array_length(ts.resultado -> 'storage_pendente') > 0
union all
-- (Fase 9, D2). Número que escreveu no WhatsApp e não casou com ninguém.
select
  mr.id::text,
  'numero_desconhecido'::text,
  'Número desconhecido escreveu no WhatsApp'::text,
  'O número ' || coalesce(mr.telefone, '(sem telefone no payload)')
    || ' mandou: "' || left(regexp_replace(mr.corpo, '\s+', ' ', 'g'), 160) || '". '
    || 'Não casou com nenhuma pessoa do cadastro, então o agente não respondeu. '
    || 'Abra Comunicação → Recebidas para vincular a uma pessoa ou responder à mão.',
  null::uuid,
  null::text,
  mr.recebida_em
from mensagens_recebidas mr
where mr.pessoa_id is null
  and mr.recebida_em >= now() - interval '72 hours'
union all
-- (Fase 9, D4). Telefone gravado fora do E.164.
select
  p2.id::text,
  'telefone_fora_do_padrao'::text,
  'Telefone fora do padrão internacional'::text,
  'O telefone de ' || p2.nome || ' está gravado como "' || p2.telefone
    || '". O padrão do sistema é E.164 (ex.: +5511988887777). Enquanto estiver assim, mensagem '
    || 'recebida desse número não casa com o cadastro e o agente de WhatsApp não responde.',
  null::uuid,
  p2.nome,
  p2.criado_em
from pessoas p2
where p2.telefone is not null
  and p2.telefone is distinct from app.telefone_e164(p2.telefone)
union all
-- NOVO (Fase 10, Fatia 4, achado 4 do Fable — B76). Bot que o servidor
-- tentou encerrar (retenção infinita, clique manual ou duração máxima) e
-- NÃO CONSEGUIU, mesmo após retentativa. É a catástrofe que B76 existe para
-- impedir tratada como pendência VISÍVEL, não só stdout: o bot pode
-- continuar gravando a sessão inteira na sala real, com retenção indefinida
-- se o motivo original foi `retention: forever`.
select
  sc.sessao_id::text,
  'bot_nao_encerrado'::text,
  'Bot pode continuar na sala — encerramento falhou'::text,
  sc.pendencia_encerramento_bot
    || ' Verifique a sala e, se necessário, remova manualmente o participante "Assistente — Escritório Elaine Montenegro".',
  j.id,
  p3.nome,
  -- 🔴 CORREÇÃO (achado C do Fable, cosmético): `sc.criado_em` era a
  -- criação da SESSÃO, não o instante da falha de encerramento — trocado
  -- por `pendencia_encerramento_bot_em`, com fallback para `criado_em` só
  -- para o caso raro de a coluna existir mas ainda não ter sido preenchida
  -- por um caminho antigo (nunca deveria acontecer nesta migration, mas
  -- `coalesce` custa nada e evita `ocorrido_em` nulo na view).
  coalesce(sc.pendencia_encerramento_bot_em, sc.criado_em)
from sessoes_copiloto sc
join sessoes_viabilidade sv on sv.id = sc.sessao_id
join jornadas j on j.id = sv.jornada_id
join pessoas p3 on p3.id = j.pessoa_id
where sc.pendencia_encerramento_bot is not null
order by ocorrido_em asc nulls last;

revoke all on vw_pendencias_sistema from public, anon;
grant select on vw_pendencias_sistema to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on vw_pendencias_sistema from authenticated;

comment on view vw_pendencias_sistema is
  'Painel do dia, bloco 4: travado. Tipos: webhook_falho, mensagem_falhou, link_expirando, '
  'material_aguardando_aprovacao (0031), sessao_sem_sala e cron_parado (0052), '
  'expurgo_storage_pendente (0081), produto_nao_mapeado (0085), '
  'numero_desconhecido e telefone_fora_do_padrao (0089), '
  'bot_nao_encerrado (0097, Fase 10 Fatia 4).';
