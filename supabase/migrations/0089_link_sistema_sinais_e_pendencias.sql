-- 0089 — Emissor de link pelo SISTEMA, sinais do agente e duas pendências novas
-- Fase 9, 07/09/2026. Plano: docs/ARQUITETURA-FASE-9.md §C (D14–D16) e §D.
--
-- =============================== PRÉ-CHECK OBRIGATÓRIO =====================
-- A parte (c) RECRIA `vw_pendencias_sistema`. Antes de aplicar, RODE e GUARDE:
--
--     select pg_get_viewdef('vw_pendencias_sistema'::regclass, true);
--
-- e confira que o corpo bate com o da 0085:487-608 (7 tipos: produto_nao_mapeado,
-- webhook_falho, mensagem_falhou, link_expirando, material_aguardando_aprovacao,
-- sessao_sem_sala, cron_parado, expurgo_storage_pendente). **O repositório pode
-- estar atrás do banco** (armadilha catalogada: "o repo não é o que está
-- publicado"). Se divergir, PARE e reconstrua esta parte a partir do corpo
-- VIGENTE — o passo 0 de `scripts/verificacao-0088-0090.sql` faz essa conferência
-- e falha alto se o corpo não tiver os 8 tipos esperados.
-- ===========================================================================
--
-- REVERSÃO:
--   drop function if exists public.emitir_link_sistema(uuid, tipo_link_publico, text, text, uuid);
--   drop function if exists public.sinais_agente_whatsapp(uuid);
--   drop index if exists idx_execucoes_ia_prompt_dia;
--   -- e recriar vw_pendencias_sistema com o corpo salvo no PRÉ-CHECK, seguido de
--   --   revoke all on vw_pendencias_sistema from public, anon;
--   --   grant select on vw_pendencias_sistema to authenticated;
--   --   revoke insert, update, delete, truncate, references, trigger
--   --     on vw_pendencias_sistema from authenticated;   (repetir a 0087)
-- ===========================================================================


-- ===========================================================================
-- (a) `emitir_link_sistema` — NOME NOVO, nunca sobrecarga.
--
--     CONFLITO C4: não existe emissor de sistema para `formulario` nem para
--     `documentos`. `emitir_link_publico` (0028:810) exige `auth.uid()` com
--     papel, e o agente roda sem sessão. As três RPCs `*_sistema` que existem
--     (material 0031, confirmacao 0051/0074, agendamento 0053) cobrem outros
--     tipos e NÃO são tocadas aqui.
--
--     Nome novo, e não um parâmetro a mais em `emitir_link_publico`: `create or
--     replace` com assinatura diferente NÃO substitui a função — cria uma
--     segunda, e a chamada passa a falhar em runtime por ambiguidade. Essa
--     armadilha já foi paga nesta casa.
--
--     Só `formulario` e `documentos`: qualquer outro tipo levanta exceção, para
--     que ninguém use esta porta como atalho para os tipos que já têm dono.
-- ===========================================================================
create or replace function public.emitir_link_sistema(
  p_jornada_id    uuid,
  p_tipo          tipo_link_publico,
  p_token_hash    text,
  p_token_prefixo text,
  p_criado_por    uuid default null
) returns links_publicos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias int;
  v_link links_publicos;
begin
  if p_tipo not in ('formulario', 'documentos') then
    raise exception 'tipo_nao_suportado: emitir_link_sistema cobre apenas formulario e documentos (% tem RPC própria)', p_tipo
      using errcode = '22023';
  end if;

  -- Mesmo corpo de validação de autor da 0074: NULL = sistema (e null aqui
  -- quer dizer "sistema", não "não sei"); não-nulo tem de ser perfil da equipe
  -- ativo com papel que poderia emitir à mão.
  if p_criado_por is not null and not exists (
       select 1 from perfis_equipe
        where id = p_criado_por and ativo
          and papel in ('admin', 'advogada', 'relacionamento')
     ) then
    raise exception 'autor_invalido: perfil % não é da equipe ativa com permissão de emitir link', p_criado_por
      using errcode = '42501';
  end if;

  if not exists (select 1 from jornadas where id = p_jornada_id and desfecho = 'aberta') then
    raise exception 'jornada_invalida: jornada nao encontrada ou fechada' using errcode = 'P0002';
  end if;

  select (valor ->> p_tipo::text)::int into v_dias from configuracoes where chave = 'link.validade_dias';
  v_dias := coalesce(v_dias, 14);

  -- MESMA transação do INSERT abaixo (idêntico a 0028:829): emitir um novo mata
  -- o anterior do mesmo tipo. É por causa desta revogação que o agente tem teto
  -- de 1 emissão por tipo a cada `agente_whatsapp.intervalo_link_horas` — sem
  -- ele, o cliente que pede o link duas vezes derruba o próprio link.
  update links_publicos
     set estado = 'revogado', revogado_em = now(), revogado_por = p_criado_por
   where jornada_id = p_jornada_id and tipo = p_tipo and estado = 'ativo';

  insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, expira_em, criado_por)
  values (p_jornada_id, p_tipo, p_token_hash, p_token_prefixo, now() + (v_dias * interval '1 day'), p_criado_por)
  returning * into v_link;

  return v_link;
end $$;

revoke all on function public.emitir_link_sistema(uuid, tipo_link_publico, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.emitir_link_sistema(uuid, tipo_link_publico, text, text, uuid)
  to service_role;

comment on function public.emitir_link_sistema(uuid, tipo_link_publico, text, text, uuid) is
  'Emite link /p/f (formulario) ou /p/d (documentos) SEM sessão — o caminho do agente de WhatsApp e '
  'da régua (C4/D14 da Fase 9). Nome novo de propósito: sobrecarga de emitir_link_publico criaria '
  'duas funções e falha em runtime. Revoga o ativo do mesmo tipo na MESMA transação. '
  'p_criado_por NULL = sistema. service_role only.';


-- ===========================================================================
-- (b) `sinais_agente_whatsapp` — UMA consulta, os sinais que o agente lê.
--
--     Por que não `vw_jornada_kanban`: MEDIDO em 07/09 — `service_role` recebe
--     `42501 permission denied for function ve_patrimonio` ao selecionar a
--     view (0086:192 chama `app.ve_patrimonio()`, cujo EXECUTE é só de
--     `authenticated`, 0024:21). O agente roda como `service_role`, sem sessão.
--     As saídas eram (1) dar EXECUTE de `ve_patrimonio` a `service_role`, que
--     alarga uma função de autorização para conveniência de leitura, ou
--     (2) uma função própria que devolve EXATAMENTE os sinais do passo. É (2).
--
--     O que sai daqui é o contrato de `Sinais` (src/lib/pasta/sinais.ts) — os
--     mesmos campos que a Esteira e a Ficha usam, para que o que o agente diz
--     no WhatsApp e o que a equipe vê na tela NÃO possam divergir. Nenhum
--     valor de patrimônio, nenhum nome de familiar, nenhum documento: só
--     booleanos, datas e rótulos de etapa.
--
--     `croqui_fase` NÃO entra: é justamente o campo que exige `ve_patrimonio`,
--     e `derivarProximoPasso` não o lê (lê `croqui_status`).
-- ===========================================================================
create or replace function public.sinais_agente_whatsapp(p_jornada_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'jornada_id',            j.id,
    'pessoa_id',             p.id,
    'primeiro_nome',         split_part(btrim(p.nome), ' ', 1),
    'pessoa_origem_dado',    p.origem_dado,
    'jornada_origem_dado',   j.origem_dado,
    'desfecho',              j.desfecho,
    'etapa',                 j.etapa,
    'nivel_pago',            j.nivel_pago,
    'nivel_pago_vigente',    app.nivel_pago_vigente(j.id),
    'tem_formulario',        exists (select 1 from formularios_respostas f where f.jornada_id = j.id),
    'tem_ligacao',           exists (select 1 from ligacoes_estrategicas l where l.jornada_id = j.id),
    'tem_briefing',          exists (select 1 from briefings b where b.jornada_id = j.id and b.atual),
    'tem_documentos',        exists (select 1 from documentos d where d.jornada_id = j.id),
    'proxima_sessao_em',     (select min(a.inicio_em) from agendamentos a
                                join sessoes_viabilidade s on s.id = a.sessao_id
                               where s.jornada_id = j.id and a.status in ('agendado','confirmado')
                                 and a.inicio_em > now()),
    'presenca_confirmada_em',(select a.presenca_confirmada_em from agendamentos a
                                join sessoes_viabilidade s on s.id = a.sessao_id
                               where s.jornada_id = j.id and a.status in ('agendado','confirmado')
                                 and a.inicio_em > now()
                               order by a.inicio_em limit 1),
    'sessao_realizada_em',   (select sv.realizada_em from sessoes_viabilidade sv where sv.jornada_id = j.id),
    'tem_relatorio',         exists (select 1 from relatorios_sessao r
                                       join sessoes_viabilidade sv on sv.id = r.sessao_id
                                      where sv.jornada_id = j.id),
    'croqui_status',         (select c.status::text from croquis c where c.jornada_id = j.id
                               order by c.versao desc limit 1),
    'material_estado',       coalesce((select case when mg.aprovado_em is not null then 'aprovado' else 'rascunho' end
                                         from materiais_gerados mg where mg.jornada_id = j.id and mg.atual limit 1), 'nenhum'),
    'tarefas_abertas',       coalesce((select jsonb_agg(jsonb_build_object('tipo', t.tipo, 'responsavel_papel', null)
                                                order by t.vence_em nulls last)
                                         from tarefas t where t.jornada_id = j.id and t.concluida_em is null), '[]'::jsonb),
    'link_ativo_formulario', exists (select 1 from links_publicos lp
                                      where lp.jornada_id = j.id and lp.tipo = 'formulario'
                                        and lp.estado = 'ativo' and lp.expira_em > now()),
    'link_ativo_documentos', exists (select 1 from links_publicos lp
                                      where lp.jornada_id = j.id and lp.tipo = 'documentos'
                                        and lp.estado = 'ativo' and lp.expira_em > now())
  )
  from jornadas j
  join pessoas p on p.id = j.pessoa_id
  where j.id = p_jornada_id
$$;

revoke all on function public.sinais_agente_whatsapp(uuid) from public, anon, authenticated;
grant execute on function public.sinais_agente_whatsapp(uuid) to service_role;

comment on function public.sinais_agente_whatsapp(uuid) is
  'Os sinais de derivarProximoPasso() para UMA jornada, em uma consulta, sem sessão (D10 da Fase 9). '
  'Existe porque service_role não consegue ler vw_jornada_kanban (42501 em app.ve_patrimonio, medido '
  'em 07/09). Devolve só booleano, data e rótulo — nenhum valor de patrimônio, nenhum nome de '
  'familiar. service_role only.';


-- ===========================================================================
-- (c) `vw_pendencias_sistema` += `numero_desconhecido` e `telefone_fora_do_padrao`.
--
--     D2: o registro de "número desconhecido escreveu" é a mensagem que JÁ está
--     em `mensagens_recebidas` (com o `bruto` inteiro) + uma linha DERIVADA
--     aqui. Não é uma tabela nova nem uma segunda linha em `webhooks_eventos`:
--     duplicar o mesmo fato em dois livros-razão reprova em otimização.
--
--     D4: telefone fora do E.164 vira PENDÊNCIA, nunca `UPDATE` automático.
--     Backfill que reclassifica gente em silêncio é proibido nesta casa.
--     (Medido em 07/09: 1 linha afetada — e é a única `origem_dado='real'`.)
--
--     Corpo VIGENTE da 0085:487-608 copiado inteiro; as duas ÚNICAS diferenças
--     são os dois `union all` no final. `security_invoker` reafirmado (0047).
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
-- NOVO (Fase 9, D2). Número que escreveu no WhatsApp e não casou com ninguém.
-- O agente NÃO responde a esse número (D1: qualquer texto confirma que existe
-- um sistema atrás do número); quem responde é gente, daqui. Só as últimas
-- 72 h: pendência é FILA, e fila que nunca esvazia treina o time a ignorá-la.
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
-- NOVO (Fase 9, D4). Telefone gravado fora do E.164: o agente nunca vai casar
-- com essa pessoa, e a régua de WhatsApp também não. Corrigir é ato HUMANO —
-- backfill automático reclassifica gente em silêncio.
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
order by ocorrido_em asc nulls last;

revoke all on vw_pendencias_sistema from public, anon;
grant select on vw_pendencias_sistema to authenticated;
-- Repetir a 0087: `grant select` sozinho não tira o ALL que o ACL padrão deixa.
revoke insert, update, delete, truncate, references, trigger
  on vw_pendencias_sistema from authenticated;

comment on view vw_pendencias_sistema is
  'Painel do dia, bloco 4: travado. Tipos: webhook_falho, mensagem_falhou, link_expirando, '
  'material_aguardando_aprovacao (0031), sessao_sem_sala e cron_parado (0052), '
  'expurgo_storage_pendente (0081), produto_nao_mapeado (0085), '
  'numero_desconhecido e telefone_fora_do_padrao (0089).';


-- ===========================================================================
-- (d) Índice do orçamento de IA do agente (C3/D19).
--
--     O agente conta as execuções DELE por `prompt_versao_id` + janela do dia,
--     em toda mensagem que chega com `tratamento_ia`. Sem índice isso é seq
--     scan em `execucoes_ia`, que é a tabela que mais cresce por uso de IA.
-- ===========================================================================
create index if not exists idx_execucoes_ia_prompt_dia
  on execucoes_ia (prompt_versao_id, criado_em desc);
