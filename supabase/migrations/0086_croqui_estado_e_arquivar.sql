-- 0086_croqui_estado_e_arquivar.sql — Fase 8, Frente B (D11–D17, B51, B53).
-- Aplicar DEPOIS da 0085 (reescreve `app.reage_pagamento_negativo`, que nasceu lá).
-- ===========================================================================
-- AS DUAS COISAS QUE ESTA MIGRATION CONSERTA
--
-- 1) O CROQUI TEM SEIS FASES, E O ENUM SÓ CONTA TRÊS.
--    `status_croqui` é `rascunho | pronto | apresentado` — o estado EDITORIAL
--    do documento. O processo real do escritório passa por mais três marcos que
--    hoje não aparecem em lugar nenhum: **calculado** (existe `croqui_calculos`),
--    **fixado** (`croqui_calculos.atual`) e os dois FATOS `exportado`
--    (evento `croqui_exportacao`) e `narrado` (`croqui_narrativas`).
--    D11 — o enum NÃO muda: `uniq_croqui_pronto` está pendurado nele.
--    D12 — a fase vem de UMA VIEW, não da timeline. Derivar da timeline já
--    mentiu uma vez (o incidente que a 0070 consertou: fixar uma versão de
--    cálculo anunciava "croqui pronto — apresentar"), e manter a derivação em
--    quatro filtros de TypeScript é insistir no mesmo erro. Uma view = uma
--    verdade, e a lista de Clientes lê a fase por JOIN, não por N chamadas.
--
-- 2) "ARQUIVAR PROCESSO" NÃO É UM RÓTULO FALTANDO — É UM EFEITO FALTANDO.
--    Hoje o combo "Situação" da Ficha grava `desfecho='congelada'` e ACABOU:
--    · `processarFilaRegua` não filtra por desfecho (grep por `desfecho` no
--      arquivo dá 0) — a mensagem agendada antes do fechamento sai depois;
--    · a fila de ligação por IA só recusa disparo NOVO (`fila.ts:113`); a
--      ligação já enfileirada pelo gatilho de pagamento continua discando;
--    · os links públicos continuam abertos.
--    Ou seja: fechar a jornada muda a cor na tela enquanto o sistema continua
--    mandando e-mail e ligando para uma família cujo processo o escritório
--    considera parado.
--
--    D15 — arquivar é `desfecho='congelada'` + motivo. É o único desfecho que
--    não afirma resultado comercial e é reversível.
--    D17 — os efeitos são reversíveis POR MARCADOR: cada linha cancelada leva
--    `motivo_cancelamento = 'jornada_arquivada'`, e desarquivar reverte
--    EXATAMENTE essas. Sem o marcador, desfazer seria adivinhação — reabriria
--    mensagem que o time tinha cancelado à mão por outro motivo.
--    B51 — link público só é revogado se quem arquiva PEDIR (a caixa nasce
--    desmarcada). Revogar é irreversível: não pode ser efeito colateral.
--
-- O QUE ESTA MIGRATION NÃO FAZ (e por quê)
--   · Não cria coluna em `jornadas` (D9): campo novo nasce vazio e backfill
--     reclassifica gente em silêncio. Fase e alerta são derivados.
--   · Não re-enfileira ligação por IA no desarquivar (D17): discar dias depois
--     é ligação fora de contexto — e o guarda `app.ligacao_ia_guarda_transicao`
--     (0053:79-95) proíbe sair de um estado terminal, então re-enfileirar
--     exigiria uma linha NOVA, que é decisão de gente, não de UPDATE.
--   · Não desfaz revogação de link: `estado='revogado'` é definitivo por desenho.
--
-- MEDIDO ANTES (07/09/2026, contra o banco fcfsnqqaphtamhrpuyoh):
--   jornadas 6 (aberta 5 · ganha 1 · congelada 0) · croquis 4
--   (rascunho 2 · pronto 1 · apresentado 1) · croqui_calculos 2 (2 `atual`)
--   · croqui_narrativas 0 · mensagens_agendadas 8 (0 pendentes)
--   · ligacoes_ia 3 (0 `na_fila`) · links_publicos 8
--   · eventos de croqui na timeline 13.
--
-- REVERSÃO (descrita, não automática):
--   drop view if exists vw_croqui_estado;   -- e recriar vw_jornada_kanban pelo texto da 0052:111-144
--   drop function if exists public.arquivar_jornada(uuid, text, boolean);
--   drop function if exists public.desarquivar_jornada(uuid);
--   alter table mensagens_agendadas drop column motivo_cancelamento;
--   alter table ligacoes_ia         drop column motivo_cancelamento;
--   -- recriar app.reage_pagamento_negativo pelo texto da 0085:398-466,
--   --         public.reivindicar_mensagens_pendentes pelo texto da 0051:705-745,
--   --         public.reivindicar_ligacoes_ia         pelo texto da 0053:153-168.
-- ===========================================================================


-- ===========================================================================
-- (a) `vw_croqui_estado` — a fase do croqui, UMA vez, para todas as telas.
--
--     Uma linha por CROQUI (uma jornada pode ter mais de um: `uniq_croqui_pronto`
--     só impede dois prontos). `mais_recente` marca o de maior versão — que é o
--     que a Ficha abre (`acharCroquiIdNaTimeline`, timeline em ordem
--     decrescente) e o que a lista já mostrava (`order by versao desc limit 1`).
--     As duas telas passam a ler a MESMA linha.
--
--     Precedência das fases (§B1, de cima para baixo): o estado editorial manda
--     quando já foi longe (`apresentado` > `pronto`); abaixo dele fala o
--     cálculo (`fixado` > `calculado`); e o piso é `rascunho`. `sem_croqui`
--     não é linha desta view — é a AUSÊNCIA de linha, e quem lê traduz.
--
--     `croqui_calculos` prende-se à JORNADA, não ao croqui (`croqui_id` é
--     `on delete set null` e o índice único é `(jornada_id) where atual`):
--     por isso a associação aqui é por `jornada_id`, como no resto do sistema.
--
--     `security_invoker = true`: a RLS de `croquis`/`croqui_calculos`
--     (`app.ve_patrimonio()`) continua valendo. Quem não vê patrimônio não vê
--     fase de croqui — nem nesta view, nem no kanban. `revoke` ANTES do
--     `grant`, nomeando `public` e `anon` (lição da 0064: `grant` sem `revoke`
--     não restringe nada).
-- ===========================================================================
create or replace view vw_croqui_estado with (security_invoker = true) as
select
  c.jornada_id,
  c.id                                as croqui_id,
  c.versao                            as croqui_versao,
  c.titulo,
  c.status::text                      as status_editorial,
  case
    when c.status = 'apresentado'         then 'apresentado'
    when c.status = 'pronto'              then 'pronto'
    when calc.versao_fixada is not null   then 'fixado'
    when calc.calculos > 0                then 'calculado'
    else                                       'rascunho'
  end                                 as fase,
  (calc.calculos > 0)                 as tem_calculo,
  calc.calculos                       as calculos_total,
  calc.versao_fixada,
  calc.calculado_em,
  exp.exportado_em,
  nar.narrado_em,
  apr.apresentado_em,
  (c.versao = (select max(c2.versao) from croquis c2 where c2.jornada_id = c.jornada_id)) as mais_recente
from croquis c
cross join lateral (
  select count(*)::int                              as calculos,
         max(cc.versao) filter (where cc.atual)     as versao_fixada,
         max(cc.criado_em)                          as calculado_em
    from croqui_calculos cc
   where cc.jornada_id = c.jornada_id
) calc
cross join lateral (
  -- FATO, não fase: o .docx já foi baixado. `dados->>'croqui_id'` é o que a
  -- rota do .docx grava (`api/croquis/[id]/docx/route.ts`), e o tipo próprio
  -- `croqui_exportacao` existe desde a 0070 justamente para não se confundir
  -- com o canal `croqui` (que carrega `status`).
  select max(et.ocorrido_em) as exportado_em
    from eventos_timeline et
   where et.jornada_id = c.jornada_id
     and et.tipo = 'croqui_exportacao'
     and et.dados->>'croqui_id' = c.id::text
) exp
cross join lateral (
  -- FATO: as notas do apresentador. O agente nasceu INATIVO (0066/0070), então
  -- hoje isto é sempre NULL — e null aqui significa "não narrado", não "zero".
  select max(cn.criado_em) as narrado_em
    from croqui_narrativas cn
   where cn.croqui_id = c.id
) nar
cross join lateral (
  select max(ca.iniciada_em) as apresentado_em
    from croqui_apresentacoes ca
   where ca.croqui_id = c.id
) apr;

comment on view vw_croqui_estado is
  'Fase 8 (D12). A FASE do croqui derivada uma vez: apresentado > pronto > fixado > calculado > rascunho, mais os fatos exportado/narrado. Ausência de linha = sem_croqui. mais_recente = o croqui que a Ficha e a lista mostram.';

revoke all    on vw_croqui_estado from public, anon;
grant  select on vw_croqui_estado to authenticated, service_role;


-- ===========================================================================
-- (b) `vw_jornada_kanban` ganha `croqui_fase` — corpo VIGENTE da 0052:111-144
--     copiado sem uma vírgula de diferença, com UMA coluna acrescentada no
--     fim (é o que `create or replace view` permite). A lista de Clientes
--     passa a ler a fase no MESMO SELECT: zero query nova, zero N+1.
--     `croqui_status` continua existindo (contrato antigo, `sinais.ts`).
-- ===========================================================================
create or replace view vw_jornada_kanban with (security_invoker = true) as
select j.id, j.etapa, j.desfecho, j.origem, j.trilha, j.edicao_id, e.codigo as edicao_codigo,
       j.faixa_patrimonio_declarada, j.nivel_pago, j.responsavel_id,
       j.origem_dado,
       p.id as pessoa_id, p.nome, p.cidade, p.uf, p.telefone, p.email,
       j.entrou_na_etapa_em,
       extract(day from now() - j.entrou_na_etapa_em)::int as dias_na_etapa,
       exists (select 1 from formularios_respostas f where f.jornada_id = j.id) as tem_formulario,
       exists (select 1 from ligacoes_estrategicas l where l.jornada_id = j.id) as tem_ligacao,
       exists (select 1 from briefings b where b.jornada_id = j.id and b.atual)  as tem_briefing,
       (select min(a.inicio_em) from agendamentos a
          join sessoes_viabilidade s on s.id = a.sessao_id
         where s.jornada_id = j.id and a.status in ('agendado','confirmado')
           and a.inicio_em > now()) as proxima_sessao_em,
       (select a.presenca_confirmada_em from agendamentos a
          join sessoes_viabilidade s on s.id = a.sessao_id
         where s.jornada_id = j.id and a.status in ('agendado','confirmado')
           and a.inicio_em > now()
         order by a.inicio_em limit 1) as presenca_confirmada_em,
       (select sv.realizada_em from sessoes_viabilidade sv where sv.jornada_id = j.id) as sessao_realizada_em,
       exists (select 1 from relatorios_sessao r
                 join sessoes_viabilidade sv on sv.id = r.sessao_id
                where sv.jornada_id = j.id) as tem_relatorio,
       (select c.status::text from croquis c where c.jornada_id = j.id order by c.versao desc limit 1) as croqui_status,
       coalesce((select case when mg.aprovado_em is not null then 'aprovado' else 'rascunho' end
                   from materiais_gerados mg where mg.jornada_id = j.id and mg.atual limit 1), 'nenhum') as material_estado,
       coalesce((select jsonb_agg(jsonb_build_object('tipo', t.tipo, 'responsavel_papel', pe.papel) order by t.vence_em nulls last)
                   from tarefas t left join perfis_equipe pe on pe.id = t.responsavel_id
                  where t.jornada_id = j.id and t.concluida_em is null), '[]'::jsonb) as tarefas_abertas,
       -- Fase 8 (D12). `sem_croqui` só é afirmado para quem PODE ver croqui:
       -- para quem a RLS de patrimônio esconde tudo, a coluna fica NULL e a
       -- tela mostra "sem informação" — nunca "sem croqui", que seria afirmar
       -- um fato que o leitor não tem direito de saber.
       (case when app.ve_patrimonio()
             then coalesce((select v.fase from vw_croqui_estado v
                             where v.jornada_id = j.id and v.mais_recente), 'sem_croqui')
        end) as croqui_fase
  from jornadas j
  join pessoas p on p.id = j.pessoa_id
  left join edicoes_seminario e on e.id = j.edicao_id;

comment on view vw_jornada_kanban is
  'Esteira/kanban. Desde a 0052 carrega os sinais de "próximo passo" (F6). Desde a 0086 carrega croqui_fase (D12) — a MESMA fase que a Ficha 360 mostra.';


-- ===========================================================================
-- (c) O marcador que torna o arquivamento reversível (D17).
--     Campo novo nasce VAZIO: toda linha existente fica NULL, e NULL significa
--     "esta linha não foi cancelada por nenhuma automação conhecida" — nunca
--     um motivo inventado. Sem backfill.
-- ===========================================================================
alter table mensagens_agendadas add column if not exists motivo_cancelamento text;
alter table ligacoes_ia         add column if not exists motivo_cancelamento text;

comment on column mensagens_agendadas.motivo_cancelamento is
  'Por que a automação cancelou este envio: jornada_arquivada (0086, reversível por desarquivar_jornada) | pagamento_reembolsado | pagamento_estornado. NULL = não foi a automação.';
comment on column ligacoes_ia.motivo_cancelamento is
  'Por que a automação cancelou esta ligação. jornada_arquivada NÃO volta para a fila no desarquivar (D17): discar fora de contexto é pior que não discar.';

-- Desarquivar procura por (jornada_id, motivo_cancelamento). `idx_mensagens_jornada`
-- (0013) já cobre o lado das mensagens; a fila de ligação não tinha índice por jornada.
create index if not exists idx_ligacoes_ia_jornada on ligacoes_ia (jornada_id, criado_em desc);


-- ===========================================================================
-- (d) `app.reage_pagamento_negativo` — corpo VIGENTE da 0085:398-466, com UMA
--     mudança: o motivo do cancelamento sai de `erro` e passa a viver em
--     `motivo_cancelamento`. Duas automações escrevendo o mesmo fato em campos
--     diferentes é como um sistema acaba com dois vocabulários; e `erro` é
--     "o envio falhou", que não é o caso — o envio foi CANCELADO de propósito.
--     Mesma assinatura, mesmo trigger: nada de sobrecarga ambígua.
-- ===========================================================================
create or replace function app.reage_pagamento_negativo() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tipo    produto_tipo;
  v_produto text;
  v_dias    int;
  v_titulo  text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('cancelado', 'reembolsado', 'estornado', 'expirado') then return new; end if;
  if new.jornada_id is null then return new; end if;

  select p.tipo into v_tipo from produtos p where p.id = new.produto_id;
  v_produto := coalesce(case v_tipo
                          when 'sessao_viabilidade' then 'Sessão de Viabilidade'
                          when 'croqui_estrutural'  then 'Croqui Estrutural'
                          when 'holding'            then 'Holding'
                        end, 'produto não identificado');

  v_titulo := case new.status
                when 'cancelado'   then 'Pagamento cancelado — ' || v_produto
                when 'reembolsado' then 'Pagamento reembolsado — ' || v_produto
                when 'estornado'   then 'Chargeback — ' || v_produto
                when 'expirado'    then 'Boleto vencido — ' || v_produto
              end;

  perform app.registrar_evento_timeline(
    new.jornada_id, 'pagamento_alerta', v_titulo,
    'A jornada não avança mais por este produto até o pagamento voltar a constar como aprovado.',
    jsonb_build_object(
      'pagamento_id', new.id, 'produto_id', new.produto_id, 'produto_tipo', v_tipo,
      'de', old.status, 'para', new.status, 'evento', new.evento_hotmart,
      'transacao', new.transacao_externa_id));

  select coalesce((valor #>> '{}')::int, 7) into v_dias
    from configuracoes where chave = 'pagamento.dias_boleto_vencido';

  insert into tarefas (jornada_id, tipo, titulo, descricao, vence_em, origem)
  values (new.jornada_id,
          'pagamento_' || new.status::text,
          v_titulo,
          case new.status
            when 'expirado' then 'O boleto venceu e o dinheiro não entrou. Cobrar ou registrar a desistência — a jornada continua aberta (B49).'
            else 'Confirmar com o cliente e decidir o desfecho. Nada foi apagado: a etapa e o histórico continuam como estão (D6/B48).'
          end,
          current_date + coalesce(v_dias, 7),
          'sistema')
  on conflict (jornada_id, tipo) where concluida_em is null and tipo is not null do nothing;

  if new.status in ('reembolsado', 'estornado') then
    update mensagens_agendadas
       set status = 'cancelada',
           motivo_cancelamento = 'pagamento_' || new.status::text
     where jornada_id = new.jornada_id
       and status = 'pendente';

    update ligacoes_ia
       set status = 'cancelada',
           encerrada_em = now(),
           motivo_cancelamento = 'pagamento_' || new.status::text
     where jornada_id = new.jornada_id
       and status = 'na_fila';
  end if;

  return new;
end $$;


-- ===========================================================================
-- (e) `public.arquivar_jornada` — a ação inteira em UMA transação.
--
--     Três `await supabase.from(...)` da rota Next NÃO são atômicos entre si:
--     o processo poderia ficar arquivado com a régua viva se o segundo await
--     falhasse. Aqui ou tudo acontece, ou nada.
--
--     Vive em `public` (e não em `app`) porque é chamada por `.rpc()` — o
--     PostgREST não enxerga o schema `app`. Segurança pelos mesmos três meios
--     de `public.revogar_link_publico` (0028:843-869): `security definer`,
--     `set search_path` fixo, e um gate de PAPEL lido de `perfis_equipe`.
--     `revoke ... from public, anon` nomeado, `grant` só para `authenticated`
--     — nenhum visitante de link público chega perto disto.
--
--     Devolve o que FOI feito, contado: {mensagens_canceladas,
--     ligacoes_canceladas, links_revogados}. A tela mostra esses números no
--     toast; número inventado não passa por aqui.
-- ===========================================================================
create or replace function public.arquivar_jornada(
  p_jornada_id     uuid,
  p_motivo         text,
  p_revogar_links  boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_papel     papel_equipe;
  v_perfil_id uuid;
  v_jornada   jornadas;
  v_motivo    text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_msgs      int := 0;
  v_ligs      int := 0;
  v_links     int := 0;
begin
  select p.papel, p.id into v_papel, v_perfil_id
    from perfis_equipe p where p.auth_user_id = auth.uid() and p.ativo;

  if v_papel is null or v_papel not in ('admin', 'advogada', 'relacionamento') then
    raise exception 'sem_permissao: papel sem autorização para arquivar processo' using errcode = '42501';
  end if;

  -- Motivo é obrigatório e é a mesma regra do `ck_desfecho_motivo`: um
  -- processo arquivado sem motivo é um processo que ninguém sabe por que parou.
  if v_motivo is null then
    raise exception 'motivo_obrigatorio: escreva por que este processo está sendo arquivado' using errcode = '23514';
  end if;
  if length(v_motivo) > 1000 then
    raise exception 'motivo_longo: o motivo tem mais de 1000 caracteres' using errcode = '22001';
  end if;

  select * into v_jornada from jornadas where id = p_jornada_id for update;
  if not found then
    raise exception 'jornada_nao_encontrada: %', p_jornada_id using errcode = 'P0002';
  end if;
  if v_jornada.desfecho = 'congelada' then
    raise exception 'ja_arquivada: este processo já está arquivado' using errcode = '23505';
  end if;
  -- `anonimizada` é ato de LGPD com base legal registrada (0079/0080). Arquivar
  -- por cima apagaria a trilha do direito exercido.
  if v_jornada.desfecho = 'anonimizada' then
    raise exception 'jornada_anonimizada: processo de titular anonimizado não se arquiva' using errcode = '23514';
  end if;

  update jornadas
     set desfecho = 'congelada', motivo_desfecho = v_motivo
   where id = p_jornada_id;

  -- (1) A régua cala. `pendente` é a única coisa que ainda não saiu; o que já
  -- foi enviado é história e não se mexe.
  with alvo as (
    update mensagens_agendadas
       set status = 'cancelada', motivo_cancelamento = 'jornada_arquivada'
     where jornada_id = p_jornada_id and status = 'pendente'
    returning 1)
  select count(*)::int into v_msgs from alvo;

  -- (2) A fila de ligação sai de cena. `na_fila` só: `discando`/`em_ligacao`
  -- é telefone tocando agora — cancelar no meio não desliga a chamada, e o
  -- guarda da 0053 recusaria a transição de qualquer jeito.
  with alvo as (
    update ligacoes_ia
       set status = 'cancelada', encerrada_em = now(), motivo_cancelamento = 'jornada_arquivada'
     where jornada_id = p_jornada_id and status = 'na_fila'
    returning 1)
  select count(*)::int into v_ligs from alvo;

  -- (3) Links públicos: SÓ se pedirem (B51). Revogar é irreversível — o
  -- cliente que abrir o link depois vê uma porta fechada, e não há
  -- "desrevogar". Por isso a caixa nasce desmarcada na tela e o default aqui
  -- é `false`: quem quiser, assume.
  if coalesce(p_revogar_links, false) then
    with alvo as (
      update links_publicos
         set estado = 'revogado', revogado_em = now(), revogado_por = v_perfil_id
       where jornada_id = p_jornada_id and estado = 'ativo'
      returning 1)
    select count(*)::int into v_links from alvo;
  end if;

  -- Andamento próprio, com os números. O trigger `app.timeline_jornada` (0014)
  -- já registra a troca de desfecho; este evento existe porque o que importa
  -- para quem lê os Andamentos não é "desfecho: congelada", é "o que parou".
  perform app.registrar_evento_timeline(
    p_jornada_id, 'arquivamento', 'Processo arquivado', v_motivo,
    jsonb_build_object('motivo', v_motivo,
                       'mensagens_canceladas', v_msgs,
                       'ligacoes_canceladas', v_ligs,
                       'links_revogados', v_links,
                       'revogar_links', coalesce(p_revogar_links, false)));

  return jsonb_build_object('jornada_id', p_jornada_id, 'desfecho', 'congelada', 'motivo', v_motivo,
                            'mensagens_canceladas', v_msgs, 'ligacoes_canceladas', v_ligs,
                            'links_revogados', v_links);
end $$;

revoke execute on function public.arquivar_jornada(uuid, text, boolean) from public, anon;
grant  execute on function public.arquivar_jornada(uuid, text, boolean) to authenticated;

comment on function public.arquivar_jornada(uuid, text, boolean) is
  'Fase 8 (D15/D17/B51). Arquiva o processo (desfecho=congelada) e cala régua e fila de ligação com marcador reversível. Links só com p_revogar_links=true. Devolve o que foi feito, contado.';


-- ===========================================================================
-- (f) `public.desarquivar_jornada` — o Desfazer.
--
--     Reverte EXATAMENTE o que o marcador diz que foi cancelado por
--     arquivamento. Mensagem cuja hora já passou NÃO volta: reenviar hoje o
--     "sua sessão é amanhã" de uma sessão da semana passada é pior do que não
--     enviar. Ligação NÃO volta para a fila (D17).
--
--     Recusa quando a pessoa já tem outro processo aberto — é a mesma regra do
--     índice parcial `uniq_jornada_aberta_por_pessoa` (0004:52-53), conferida
--     ANTES para devolver mensagem legível em vez de um 23505 cru.
-- ===========================================================================
create or replace function public.desarquivar_jornada(p_jornada_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_papel    papel_equipe;
  v_jornada  jornadas;
  v_outra    uuid;
  v_msgs     int := 0;
  v_ligs     int := 0;
  v_final    desfecho_jornada;
begin
  select p.papel into v_papel
    from perfis_equipe p where p.auth_user_id = auth.uid() and p.ativo;

  if v_papel is null or v_papel not in ('admin', 'advogada', 'relacionamento') then
    raise exception 'sem_permissao: papel sem autorização para desarquivar processo' using errcode = '42501';
  end if;

  select * into v_jornada from jornadas where id = p_jornada_id for update;
  if not found then
    raise exception 'jornada_nao_encontrada: %', p_jornada_id using errcode = 'P0002';
  end if;
  if v_jornada.desfecho <> 'congelada' then
    raise exception 'nao_arquivada: este processo não está arquivado (situação atual: %)', v_jornada.desfecho
      using errcode = '23514';
  end if;

  select j.id into v_outra
    from jornadas j
   where j.pessoa_id = v_jornada.pessoa_id and j.desfecho = 'aberta' and j.id <> p_jornada_id
   limit 1;
  if v_outra is not null then
    raise exception 'jornada_aberta_existente: esta pessoa já tem outro processo em andamento (%)', v_outra
      using errcode = '23505';
  end if;

  -- `motivo_desfecho` vira NULL junto: manter "arquivado porque X" num
  -- processo que voltou a andar é deixar dado mentindo na tela.
  update jornadas set desfecho = 'aberta', motivo_desfecho = null where id = p_jornada_id;
  -- A máquina de estados pode ter opinião: jornada em `holding_contratada`
  -- volta como `ganha`, não como `aberta` (app.valida_transicao_jornada, 0004).
  select desfecho into v_final from jornadas where id = p_jornada_id;

  with alvo as (
    update mensagens_agendadas
       set status = 'pendente', motivo_cancelamento = null, proxima_tentativa_em = null
     where jornada_id = p_jornada_id
       and status = 'cancelada'
       and motivo_cancelamento = 'jornada_arquivada'
       and agendada_para > now()
    returning 1)
  select count(*)::int into v_msgs from alvo;

  select count(*)::int into v_ligs
    from ligacoes_ia
   where jornada_id = p_jornada_id and motivo_cancelamento = 'jornada_arquivada';

  perform app.registrar_evento_timeline(
    p_jornada_id, 'arquivamento', 'Processo reaberto', null,
    jsonb_build_object('mensagens_reagendadas', v_msgs,
                       'ligacoes_nao_refeitas', v_ligs,
                       'desfecho', v_final));

  return jsonb_build_object('jornada_id', p_jornada_id, 'desfecho', v_final,
                            'mensagens_reagendadas', v_msgs, 'ligacoes_nao_refeitas', v_ligs);
end $$;

revoke execute on function public.desarquivar_jornada(uuid) from public, anon;
grant  execute on function public.desarquivar_jornada(uuid) to authenticated;

comment on function public.desarquivar_jornada(uuid) is
  'Fase 8 (D17). Desfaz o arquivamento: desfecho volta, mensagens marcadas como jornada_arquivada e ainda no futuro voltam para a fila. Ligação não volta (discar fora de contexto). Recusa se a pessoa já tem outro processo aberto.';


-- ===========================================================================
-- (g) A fila NUNCA fala com processo fechado — no BANCO, não só no worker.
--
--     Arquivar cancela o que está na fila HOJE; estes dois filtros impedem que
--     algo entre na fila DEPOIS (um agendamento remarcado, uma retentativa,
--     um gatilho de pagamento que chegue atrasado). São o mesmo conserto em
--     dois lugares: a régua e a discagem.
--
--     Corpo VIGENTE copiado (0051:705-745 e 0053:153-168), com UMA cláusula a
--     mais cada. Assinatura idêntica: `create or replace` sem sobrecarga nova
--     (a armadilha da sobrecarga ambígua já catalogada nesta casa).
-- ===========================================================================
create or replace function public.reivindicar_mensagens_pendentes(
  p_limite int default 50,
  p_canais canal_mensagem[] default array['email']::canal_mensagem[]
) returns setof mensagens_agendadas
language sql as $$
  update mensagens_agendadas m set status = 'enviando', tentativas = tentativas + 1
   where m.id in (
     select ma.id
       from mensagens_agendadas ma
       join jornadas jo on jo.id = ma.jornada_id
       left join agendamentos ag on ag.id = ma.agendamento_id
       left join sessoes_viabilidade sv
         on sv.id = coalesce(ag.sessao_id, (select s2.id from sessoes_viabilidade s2 where s2.jornada_id = ma.jornada_id))
      where ma.status = 'pendente'
        -- 0086: processo fechado não recebe automação. Era o furo do
        -- reconhecimento — `grep desfecho` em `server/regua/processar.ts` = 0.
        and jo.desfecho = 'aberta'
        and ma.canal = any (coalesce(p_canais, array['email']::canal_mensagem[]))
        and ma.agendada_para <= now()
        and (ma.proxima_tentativa_em is null or ma.proxima_tentativa_em <= now())
        and (
          ma.corpo_renderizado is null
          or ma.corpo_renderizado not like '%{{link_material}}%'
          or exists (
            select 1 from materiais_gerados mg
             where mg.jornada_id = ma.jornada_id and mg.atual and mg.aprovado_em is not null
          )
        )
        and (
          ma.corpo_renderizado is null
          or ma.corpo_renderizado not like '%{{link_sala}}%'
          or sv.link_sala is not null
        )
        and (
          ma.corpo_renderizado is null
          or ma.corpo_renderizado not like '%{{link_confirmacao}}%'
          or (ag.id is not null and ag.status in ('agendado', 'confirmado') and ag.presenca_confirmada_em is null)
        )
      order by ma.agendada_para
      for update of ma skip locked
      limit greatest(p_limite, 0))
  returning *;
$$;
revoke execute on function public.reivindicar_mensagens_pendentes(int, canal_mensagem[]) from public, anon, authenticated;
grant  execute on function public.reivindicar_mensagens_pendentes(int, canal_mensagem[]) to service_role;

create or replace function public.reivindicar_ligacoes_ia(p_limite int default 10)
returns setof ligacoes_ia
language sql security definer set search_path = public, pg_temp as $$
  update ligacoes_ia l
     set status = 'discando', disparada_em = now()
   where l.id in (
     select li.id from ligacoes_ia li
       join jornadas jo on jo.id = li.jornada_id
      where li.status = 'na_fila' and (li.nao_antes_de is null or li.nao_antes_de <= now())
        -- 0086: mesma regra da régua. `fila.ts:113` já recusava o disparo
        -- MANUAL de jornada fechada; o cron não tinha essa trava.
        and jo.desfecho = 'aberta'
      order by li.criado_em
      for update of li skip locked
      limit greatest(coalesce(p_limite, 10), 1)
   )
  returning l.*
$$;
revoke execute on function public.reivindicar_ligacoes_ia(int) from public, anon, authenticated;
grant  execute on function public.reivindicar_ligacoes_ia(int) to service_role;


-- ===========================================================================
-- (h) B51 NÃO ERA UM DEFAULT — ERA UMA MUDANÇA DE TRIGGER.
--
--     ACHADO desta migration, contra o banco: `app.revoga_links_ao_fechar_jornada`
--     (trigger `trg_revoga_links`, AFTER UPDATE em `jornadas`) revoga TODOS os
--     links públicos ativos sempre que o desfecho sai de `aberta` — para
--     qualquer desfecho, inclusive `congelada`. O reconhecimento da fase disse
--     o contrário ("nenhuma rotina encontrada que revogue link ao mudar
--     `desfecho`"): ele procurou no TypeScript, e a rotina está no banco.
--
--     Consequência: sem esta mudança, a caixa "revogar também os links
--     enviados" seria decoração — arquivar revogaria de qualquer jeito, e
--     revogar é IRREVERSÍVEL (`estado='revogado'` não tem volta). Um
--     "arquivar" que se anuncia reversível e destrói links não é reversível.
--
--     A regra passa a ser: **arquivar (`congelada`) não revoga; encerrar
--     revoga.** `perdida`, `descartada`, `ganha` e `anonimizada` continuam
--     exatamente como estavam — nenhum caminho existente muda de
--     comportamento além do arquivamento, que é o que a Fase 8 está criando.
--     Quem quiser revogar ao arquivar continua podendo: é a caixa da tela,
--     que vira `p_revogar_links = true` e revoga de forma explícita e contada.
--
--     Corpo VIGENTE (lido de `pg_get_functiondef` no banco, 07/09) com UMA
--     condição a mais.
-- ===========================================================================
create or replace function app.revoga_links_ao_fechar_jornada() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- `congelada` = Arquivado (D15/B53): situação REVERSÍVEL. Efeito colateral
  -- irreversível não pode viajar de carona numa ação que promete desfazer.
  if new.desfecho = 'congelada' then
    return new;
  end if;
  if new.desfecho <> 'aberta' and old.desfecho = 'aberta' then
    update links_publicos
       set estado = 'revogado', revogado_em = now()
     where jornada_id = new.id and estado = 'ativo';
  end if;
  return new;
end $$;

comment on function app.revoga_links_ao_fechar_jornada() is
  'Fecha a porta pública quando o processo encerra. Desde a 0086, `congelada` (Arquivado) é exceção: arquivar é reversível, revogar link não é — quem quer revogar pede em public.arquivar_jornada(p_revogar_links => true).';
