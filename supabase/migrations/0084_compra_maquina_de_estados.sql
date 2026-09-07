-- 0084_compra_maquina_de_estados.sql — Fase 8, Frente A (D5, D7, D9).
-- Aplicar DEPOIS da 0083 (usa o TIPO `status_pagamento`, não os valores novos)
-- e ANTES da 0085.
-- ===========================================================================
-- O QUE ESTA MIGRATION FECHA
--
-- [D7] `pagamentos` não guardava QUAL evento produziu o estado, e o upsert de
--   0011:218 (`do update set status = excluded.status`) deixava uma REENTREGA
--   antiga de `BILLET_PRINTED` rebaixar um `APPROVED` já gravado. A Hotmart
--   reentrega fora de ordem; o vault do João documenta o efeito (padrões P1/P3:
--   "boleto compensado não vira pago", "boleto preso em BILLET_PRINTED").
--   → nascem `pagamentos.evento_hotmart`, `.evento_em`, `.evento_externo_id` e
--     um trigger BEFORE UPDATE que RECUSA o rebaixamento por evento mais velho.
--
-- [D5] "Piso é histórico, teto é vigente". `jornadas.nivel_pago` é monotônico
--   (piso contábil, 0011) e NÃO cai no reembolso — apagar histórico seria mentir
--   sobre o que já aconteceu. Falta o TETO: hoje um humano move a jornada para
--   "Croqui pago" sem croqui pago, porque o trigger de 0004 só tem piso.
--   → nasce `app.nivel_pago_vigente(uuid)` = maior nível com pagamento
--     `aprovado` E não revertido, e o trigger da máquina de estados passa a
--     exigir teto >= 1/2/3 para entrar em sessao_contratada / croqui_contratado /
--     holding_contratada.
--
-- [D9] Zero coluna nova em `jornadas`: o estado de pagamento por produto que as
--   telas leem é DERIVADO (`vw_pagamentos_jornada`), não backfillado. Campo novo
--   nasce vazio e backfill reclassifica gente em silêncio — as duas armadilhas
--   já catalogadas nesta casa.
--
-- MEDIDO ANTES (07/09/2026, contra o banco): jornadas = 6 · pagamentos = 6,
-- todos `aprovado` · jornadas com etapa ACIMA do teto vigente = **0** → B52 sem
-- impacto: o trigger julga só transições NOVAS e nenhuma linha existente é
-- tocada por esta migration (não há um único UPDATE de dado aqui).
--
-- REVERSÃO (descrita, não automática):
--   drop trigger if exists trg_pagamento_ordem_do_evento on pagamentos;
--   drop trigger if exists trg_registra_transicao_pagamento on pagamentos;
--   drop function if exists app.pagamento_ordem_do_evento();
--   drop function if exists app.registra_transicao_pagamento();
--   drop view if exists vw_pagamentos_jornada;
--   drop table if exists pagamentos_transicoes;
--   drop function if exists app.nivel_pago_vigente(uuid);
--   alter table pagamentos drop column evento_hotmart, drop column evento_em,
--                          drop column evento_externo_id;
--   -- e recriar app.valida_transicao_jornada a partir do corpo de 0004:73-99.
-- ===========================================================================


-- ===========================================================================
-- (a) Colunas do EVENTO. Campo novo nasce VAZIO: as 6 linhas que já existem
--     ficam NULL e a tela mostra "sem informação", nunca um evento inventado.
-- ===========================================================================
alter table pagamentos
  add column if not exists evento_hotmart    text,
  add column if not exists evento_em         timestamptz,
  add column if not exists evento_externo_id text;

comment on column pagamentos.evento_hotmart is
  'Nome NORMALIZADO do evento da Hotmart que produziu este estado (APPROVED, COMPLETE, BILLET_PRINTED...), sem o prefixo PURCHASE_. NULL = linha anterior a 0084 ou registro que nao veio de webhook.';
comment on column pagamentos.evento_em is
  'Instante do evento segundo a Hotmart. E a chave de ORDEM: evento mais velho nunca rebaixa o estado (D7).';
comment on column pagamentos.evento_externo_id is
  'Id do evento (payload.id) ja aplicado a esta compra. Base da idempotencia por evento, junto com pagamentos_transicoes.';

-- Índice do §F (escalabilidade): a Ficha e a lista de Clientes leem o estado
-- por (jornada, produto), não por varredura.
create index if not exists idx_pagamentos_produto_jornada on pagamentos (jornada_id, produto_id);


-- ===========================================================================
-- (b) Livro-razão da compra. Espelho de `jornadas_transicoes` (0004): a linha
--     do tempo de estados de UMA transação. Append-only de verdade — RLS sem
--     policy de update e sem policy de delete, e privilégio revogado à mão
--     (lição da 0065b: `alter default privileges` do Supabase dá ALL em tabela
--     nova para `authenticated`, então `grant select` sozinho não restringe).
-- ===========================================================================
create table if not exists pagamentos_transicoes (
  id                uuid primary key default gen_random_uuid(),
  pagamento_id      uuid not null references pagamentos(id) on delete cascade,
  de_status         status_pagamento,
  para_status       status_pagamento not null,
  evento_hotmart    text,
  evento_em         timestamptz,
  evento_externo_id text,
  ocorrido_em       timestamptz not null default now()
);
create index if not exists idx_pag_trans on pagamentos_transicoes (pagamento_id, ocorrido_em desc);
-- Idempotência por id de evento: a MESMA entrega não pode virar duas linhas.
create unique index if not exists uniq_pag_trans_evento
  on pagamentos_transicoes (pagamento_id, evento_externo_id)
  where evento_externo_id is not null;

alter table pagamentos_transicoes enable row level security;
alter table pagamentos_transicoes force row level security;
drop policy if exists pt_sel on pagamentos_transicoes;
create policy pt_sel on pagamentos_transicoes for select to authenticated
  using ((select app.eh_interno()));
-- append-only: SEM policy de insert/update/delete. RLS nega por ausência, e o
-- privilégio abaixo nega antes ainda.
revoke all on pagamentos_transicoes from public, anon, authenticated;
grant select on pagamentos_transicoes to authenticated;

comment on table pagamentos_transicoes is
  'Append-only. Uma linha por mudanca de estado de uma compra, com o evento da Hotmart que a causou. Escrita so pelo trigger app.registra_transicao_pagamento.';


-- ===========================================================================
-- (c) Ordem do evento (D7). BEFORE UPDATE: evento mais VELHO que o já gravado
--     não rebaixa nada — o estado, o evento e o bruto ficam como estão.
--     Não levanta exceção de propósito: reentrega fora de ordem é comportamento
--     NORMAL da Hotmart, não erro. Falhar aqui faria a rota devolver 500 e a
--     Hotmart reentregar para sempre o mesmo evento velho.
-- ===========================================================================
create or replace function app.pagamento_ordem_do_evento() returns trigger
language plpgsql as $$
begin
  if old.evento_em is not null
     and new.evento_em is not null
     and new.evento_em < old.evento_em then
    new.status            := old.status;
    new.evento_hotmart    := old.evento_hotmart;
    new.evento_em         := old.evento_em;
    new.evento_externo_id := old.evento_externo_id;
    new.pago_em           := old.pago_em;
    new.bruto             := old.bruto;
  end if;
  return new;
end $$;

drop trigger if exists trg_pagamento_ordem_do_evento on pagamentos;
create trigger trg_pagamento_ordem_do_evento before update on pagamentos
for each row execute function app.pagamento_ordem_do_evento();


-- ===========================================================================
--     Log da transição. SECURITY DEFINER pela mesma razão de
--     `app.registra_transicao_jornada` (0004:104-107): a tabela é append-only e
--     não tem policy de INSERT — sem definer, a própria RLS que a protege
--     bloquearia o trigger e toda escrita de pagamento quebraria.
--     `on conflict do nothing` fecha a idempotência por evento no nível do
--     banco, e não só no da função que chama.
-- ===========================================================================
create or replace function app.registra_transicao_pagamento() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if TG_OP = 'INSERT' then
    insert into pagamentos_transicoes
      (pagamento_id, de_status, para_status, evento_hotmart, evento_em, evento_externo_id)
    values (new.id, null, new.status, new.evento_hotmart, new.evento_em, new.evento_externo_id)
    on conflict do nothing;
    return new;
  end if;

  if new.status is distinct from old.status
     or new.evento_externo_id is distinct from old.evento_externo_id then
    insert into pagamentos_transicoes
      (pagamento_id, de_status, para_status, evento_hotmart, evento_em, evento_externo_id)
    values (new.id, old.status, new.status, new.evento_hotmart, new.evento_em, new.evento_externo_id)
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_registra_transicao_pagamento on pagamentos;
create trigger trg_registra_transicao_pagamento after insert or update on pagamentos
for each row execute function app.registra_transicao_pagamento();


-- ===========================================================================
-- (d) TETO VIGENTE (D5). Maior nível PAGO E NÃO REVERTIDO da jornada.
--     `stable` porque só lê; `security definer` porque quem a chama é o trigger
--     da máquina de estados, que roda como o usuário logado e não pode depender
--     da RLS de `pagamentos` para julgar uma invariante; `set search_path` fixo
--     (regra da 0070(d)).
--     EXECUTE NÃO é concedido a `authenticated` nem a `anon`: uma função
--     definer que responde "quanto esta jornada pagou" para qualquer uuid é um
--     oráculo. Quem precisa dela é o trigger — e o trigger passa a ser definer
--     também (bloco (e)), rodando como o dono, que tem EXECUTE por ser dono.
-- ===========================================================================
create or replace function app.nivel_pago_vigente(p_jornada_id uuid) returns smallint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(max(case pr.tipo
                         when 'sessao_viabilidade' then 1
                         when 'croqui_estrutural'  then 2
                         when 'holding'            then 3
                         else 0
                       end), 0)::smallint
    from pagamentos p
    join produtos  pr on pr.id = p.produto_id
   where p.jornada_id = p_jornada_id
     and p.status = 'aprovado';
$$;
revoke execute on function app.nivel_pago_vigente(uuid) from public, anon, authenticated;
grant  execute on function app.nivel_pago_vigente(uuid) to service_role;

comment on function app.nivel_pago_vigente(uuid) is
  'TETO por dinheiro: 0/1/2/3 conforme o maior produto com pagamento hoje aprovado. Cai no reembolso/estorno/cancelamento — ao contrario de jornadas.nivel_pago, que e piso historico e nao cai (D5).';


-- ===========================================================================
-- (e) A máquina de estados ganha TETO. `create or replace` a partir do corpo
--     VIGENTE de 0004:73-99 — copiado inteiro, com as diferenças marcadas
--     `0084`. `create or replace` troca o corpo INTEIRO: o que não for
--     recopiado some (ordem, transicoes_permitidas, piso, auto-'ganha',
--     entrou_na_etapa_em, atualizado_em estão todos aqui).
--
--     DUAS MUDANÇAS, e só duas:
--
--     1. TETO (D5). Só quando `new.etapa <> old.etapa` — B52: o trigger julga
--        transições NOVAS, nenhuma linha existente é revalidada. Mensagem de
--        erro GENÉRICA de propósito: trigger BEFORE fala antes da RLS filtrar e
--        não pode virar oráculo de existência (regra do próprio 0004).
--
--     2. O PISO passa a ser conferido só quando a etapa MUDA. Não é
--        afrouxamento: nenhum UPDATE consegue baixar a etapa abaixo do que foi
--        pago, porque toda mudança de etapa continua sendo julgada. O que deixa
--        de acontecer é a recusa de um UPDATE que NÃO mexe na etapa — e essa
--        recusa é exatamente o bug que a própria 0011 documentou em 0011:129-140
--        ("dinheiro ficaria sem registro... O conserto definitivo é o dono de
--        0004 restringir o check de piso a `new.etapa is distinct from
--        old.etapa`"). Sem isto o teto seria impossível: registrar o pagamento
--        eleva `nivel_pago` antes de a etapa subir (é preciso: o teto exige o
--        pagamento JÁ gravado), e o piso antigo recusaria esse próprio UPDATE.
--
--     SECURITY DEFINER (novo): para poder chamar `app.nivel_pago_vigente`, cujo
--     EXECUTE não é público. O corpo só LÊ tabelas de configuração
--     (etapas_jornada_ordem, transicoes_permitidas) e a função de teto; não
--     escreve em lugar nenhum e não expõe nada ao chamador além de "sim/não".
--     Mesmo padrão já usado por `app.registra_transicao_jornada` (0004:108).
-- ===========================================================================
create or replace function app.valida_transicao_jornada() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare ord_novo smallint; ord_velho smallint; piso smallint; teto_exigido smallint;
begin
  if new.etapa <> old.etapa then
    select ordem into ord_novo  from etapas_jornada_ordem where etapa = new.etapa;
    select ordem into ord_velho from etapas_jornada_ordem where etapa = old.etapa;
    if ord_novo < ord_velho then
      raise exception 'transicao_invalida: etapa nao regride' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from transicoes_permitidas where de = old.etapa and para = new.etapa) then
      raise exception 'transicao_invalida' using errcode = 'check_violation';
    end if;
    -- piso por dinheiro: pagamento aprovado trava a etapa mínima. Estorno NÃO
    -- rebaixa (piso é HISTÓRICO). 0084: conferido só na troca de etapa.
    piso := case new.nivel_pago when 1 then 30 when 2 then 60 when 3 then 80 else 0 end;
    if ord_novo < piso then
      raise exception 'transicao_invalida: abaixo do nivel pago' using errcode = 'check_violation';
    end if;
    -- 0084 · TETO por dinheiro (D5): só entra na etapa quem PAGOU aquele
    -- produto e não teve o pagamento revertido. Vale para o webhook e para a
    -- mão do humano na tela — era o pedido literal do João ("só avança para o
    -- Croqui quando pagou o Croqui").
    teto_exigido := case new.etapa
                      when 'sessao_contratada'  then 1
                      when 'croqui_contratado'  then 2
                      when 'holding_contratada' then 3
                      else 0
                    end;
    if teto_exigido > 0 and app.nivel_pago_vigente(new.id) < teto_exigido then
      raise exception 'transicao_invalida' using errcode = 'check_violation';
    end if;
  end if;
  if new.etapa = 'holding_contratada' and new.desfecho = 'aberta' then
    new.desfecho := 'ganha'; new.motivo_desfecho := coalesce(new.motivo_desfecho,'Holding contratada');
  end if;
  if new.etapa <> old.etapa then new.entrou_na_etapa_em := now(); end if;
  new.atualizado_em := now();
  return new;
end $$;


-- ===========================================================================
-- (f) Estado de pagamento por produto, para as telas lerem por JOIN e não por
--     N chamadas (D9 + §F escalabilidade). `security_invoker` reafirmado de
--     propósito — lição da 0047: view sem invoker roda com os direitos do DONO
--     e passa por cima de toda a RLS de baixo.
--     `revoke` ANTES do `grant`, nomeando `public` e `anon` — a 0064 provou que
--     `grant` sem `revoke` não restringe nada.
-- ===========================================================================
create or replace view vw_pagamentos_jornada with (security_invoker = true) as
select
  p.jornada_id,
  p.produto_id,
  pr.tipo            as produto_tipo,
  pr.nome            as produto_nome,
  p.status,
  p.evento_hotmart,
  p.evento_em,
  p.valor,
  p.moeda,
  p.pago_em,
  p.transacao_externa_id,
  p.criado_em,
  (p.status in ('cancelado','reembolsado','estornado')) as revertido,
  (p.status in ('boleto_gerado','expirado','atrasado'))  as aguardando_dinheiro
from pagamentos p
join produtos  pr on pr.id = p.produto_id
where p.jornada_id is not null;

revoke all on vw_pagamentos_jornada from public, anon;
grant select on vw_pagamentos_jornada to authenticated;

comment on view vw_pagamentos_jornada is
  'Estado da compra por (jornada, produto) para a Ficha e a lista de Clientes. Derivada — zero coluna nova em jornadas, zero backfill (D9).';
