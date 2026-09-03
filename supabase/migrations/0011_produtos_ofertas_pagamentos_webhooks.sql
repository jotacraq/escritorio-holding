-- 0011_produtos_ofertas_pagamentos_webhooks.sql
-- Produtos vendidos via Hotmart, oferta registrada ANTES do pagamento chegar
-- (o webhook não informa qual condição foi aplicada — ver CONFLITO C8 do plano),
-- livro-razão de pagamentos e livro-razão de eventos de webhook.

create table produtos (
  id                  uuid primary key default gen_random_uuid(),
  tipo                produto_tipo not null,
  nome                text not null,
  hotmart_produto_id  text,                 -- BLOQUEIO B7: preencher com os IDs reais da Hotmart
  ativo               boolean not null default true,
  criado_em           timestamptz not null default now(),
  unique (hotmart_produto_id)
);

-- O script comercial tem preço padrão e "Incentivo do Resolvedor" válido no dia.
-- Sem registrar QUAL oferta foi feita, o valor que chega do webhook não bate com nada.
create table ofertas (
  id             uuid primary key default gen_random_uuid(),
  jornada_id     uuid not null references jornadas(id) on delete cascade,
  produto_id     uuid not null references produtos(id),
  valor_padrao   numeric(15,2) not null check (valor_padrao >= 0),
  valor_ofertado numeric(15,2) not null check (valor_ofertado >= 0),
  condicao       text not null,             -- 'padrao' | 'incentivo_resolvedor'
  valida_ate     timestamptz,
  ofertada_em    timestamptz not null default now(),
  ofertada_por   uuid references perfis_equipe(id),
  aceita         boolean,
  criado_em      timestamptz not null default now()
);
create index idx_ofertas_jornada on ofertas (jornada_id, ofertada_em desc);

create table pagamentos (
  id                    uuid primary key default gen_random_uuid(),
  jornada_id            uuid references jornadas(id) on delete set null,
  pessoa_id             uuid references pessoas(id),
  produto_id            uuid references produtos(id),
  origem                text not null default 'hotmart',
  transacao_externa_id  text not null,
  status                status_pagamento not null,
  valor                 numeric(15,2) check (valor >= 0),
  moeda                 char(3) not null default 'BRL',
  parcelas              smallint check (parcelas >= 0),
  comprador_email       text,
  comprador_nome        text,
  comprador_telefone    text,
  pago_em               timestamptz,
  bruto                 jsonb not null,     -- payload original, sempre
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  unique (origem, transacao_externa_id)
);
create index idx_pagamentos_jornada on pagamentos (jornada_id, criado_em desc);
create index idx_pagamentos_pendentes on pagamentos (status) where status in ('pendente','em_analise');

create trigger trg_pagamentos_atualizado_em before update on pagamentos
for each row execute function app.set_atualizado_em();

-- Livro-razão do webhook. Grava PRIMEIRO (bruto + assinatura), processa depois.
-- Idempotência é do banco (constraint unique), não de cache em memória.
create table webhooks_eventos (
  id                  uuid primary key default gen_random_uuid(),
  origem              text not null default 'hotmart',
  evento_externo_id   text not null,
  tipo_evento         text,
  assinatura_valida   boolean not null,
  bruto               jsonb not null,
  processado_em       timestamptz,
  erro                text,
  tentativas          smallint not null default 0,
  recebido_em         timestamptz not null default now(),
  unique (origem, evento_externo_id)
);
create index idx_webhooks_pendentes on webhooks_eventos (recebido_em) where processado_em is null;

-- nivel_pago da jornada é DERIVADO do pagamento aprovado. Nunca digitado à mão, e o
-- webhook nunca escreve nele diretamente — o payload não pode "elevar" o nível por
-- conta própria além do que o produto de fato paga.
create or replace function app.atualiza_nivel_pago() returns trigger
language plpgsql as $$
declare novo smallint; v_tipo produto_tipo;
begin
  if new.status <> 'aprovado' or new.jornada_id is null then return new; end if;
  select p.tipo into v_tipo from produtos p where p.id = new.produto_id;
  if v_tipo is null then return new; end if; -- produto não mapeado: nada a fazer aqui
  novo := case v_tipo
            when 'sessao_viabilidade' then 1
            when 'croqui_estrutural'  then 2
            when 'holding'            then 3
            else 0
          end;
  update jornadas set nivel_pago = greatest(nivel_pago, novo) where id = new.jornada_id;
  return new;
end $$;
create trigger trg_nivel_pago after insert or update on pagamentos
for each row execute function app.atualiza_nivel_pago();

-- Régua "boas-vindas" (§5.3 do ARQUITETURA.md): dispara sozinha quando um
-- pagamento de Sessão de Viabilidade é aprovado. Chama app.enfileirar_mensagem,
-- definida em 0013_regua_mensagens.sql — referência adiantada tolerada pelo
-- plpgsql (só resolve o nome em tempo de execução, depois de todas as
-- migrations aplicadas). Idempotente: a chave_idempotencia de
-- mensagens_agendadas (0013) absorve reentregas do webhook sem duplicar envio.
create or replace function app.regua_boas_vindas() returns trigger
language plpgsql as $$
declare v_tipo produto_tipo; v_pessoa record;
begin
  if new.status <> 'aprovado' or new.jornada_id is null then return new; end if;
  select p.tipo into v_tipo from produtos p where p.id = new.produto_id;
  if v_tipo is distinct from 'sessao_viabilidade' then return new; end if;
  select nome, email, telefone into v_pessoa from pessoas where id = new.pessoa_id;
  perform app.enfileirar_mensagem(new.jornada_id, null, 'boas_vindas', 'email',
    coalesce(v_pessoa.email, new.comprador_email), now(),
    coalesce(v_pessoa.nome, new.comprador_nome), null, null);
  perform app.enfileirar_mensagem(new.jornada_id, null, 'boas_vindas', 'whatsapp',
    coalesce(v_pessoa.telefone, new.comprador_telefone), now(),
    coalesce(v_pessoa.nome, new.comprador_nome), null, null);
  return new;
end $$;
create trigger trg_regua_boas_vindas after insert or update on pagamentos
for each row execute function app.regua_boas_vindas();

-- ===========================================================================
-- Processamento atômico do pagamento Hotmart (§3.1 passo 4). Vive como função
-- porque precisa ser UMA transação: resolver pessoa/jornada, tentar avançar a
-- etapa e só então inserir o pagamento — nessa ordem, e nunca em passos HTTP
-- separados (dois `await supabase.from(...)` do Next não são atômicos entre si).
--
-- ATENÇÃO — risco cross-migration que o BACK-CORE precisa revisar (fora da
-- minha fronteira, 0004 não é meu arquivo): `app.valida_transicao_jornada()`
-- roda o check de "piso por nivel_pago" em TODO update de `jornadas`, inclusive
-- o update que `app.atualiza_nivel_pago()` (0011) dispara depois de inserir o
-- pagamento. Se a etapa não puder ser avançada ANTES do pagamento (ex.: pular
-- direto para holding sem passar pelas etapas anteriores), aquele UPDATE de
-- nivel_pago é recusado e o INSERT em pagamentos falha inteiro — dinheiro
-- ficaria sem registro. Esta função tenta avançar a etapa primeiro para cobrir
-- o caminho normal; o `exception when others` abaixo é a rede de segurança para
-- o caso patológico, e SEMPRE aparece em `webhooks_eventos.erro` — nunca é
-- engolido em silêncio. O conserto definitivo é o dono de 0004 restringir o
-- check de piso a `new.etapa is distinct from old.etapa`.
create or replace function public.processar_pagamento_hotmart(
  p_hotmart_produto_id text, p_transacao_externa_id text, p_status status_pagamento,
  p_valor numeric, p_moeda char(3), p_parcelas smallint,
  p_comprador_email text, p_comprador_nome text, p_comprador_telefone text,
  p_pago_em timestamptz, p_bruto jsonb
) returns table (
  pagamento_id uuid, jornada_id uuid, produto_mapeado boolean, etapa_avancada boolean, observacao text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_produto produtos%rowtype;
  v_pessoa_id uuid;
  v_jornada_id uuid;
  v_etapa_alvo etapa_jornada;
  v_etapa_atual etapa_jornada;
  v_pagamento_id uuid;
  v_observacao text := null;
  v_etapa_avancada boolean := false;
begin
  select * into v_produto from produtos where hotmart_produto_id = p_hotmart_produto_id;

  if v_produto.id is null then
    insert into pagamentos (jornada_id, pessoa_id, produto_id, origem, transacao_externa_id,
                            status, valor, moeda, parcelas, comprador_email, comprador_nome,
                            comprador_telefone, pago_em, bruto)
    values (null, null, null, 'hotmart', p_transacao_externa_id, p_status, p_valor, p_moeda,
            p_parcelas, p_comprador_email, p_comprador_nome, p_comprador_telefone, p_pago_em, p_bruto)
    on conflict (origem, transacao_externa_id) do nothing
    returning id into v_pagamento_id;
    return query select v_pagamento_id, null::uuid, false, false, 'produto_nao_mapeado'::text;
    return;
  end if;

  if p_comprador_email is not null then
    select id into v_pessoa_id from pessoas where lower(email) = lower(p_comprador_email);
  end if;
  if v_pessoa_id is null and p_comprador_telefone is not null then
    select id into v_pessoa_id from pessoas where telefone = p_comprador_telefone;
  end if;
  if v_pessoa_id is null then
    insert into pessoas (nome, email, telefone)
    values (coalesce(p_comprador_nome, 'Cliente Hotmart'), p_comprador_email, p_comprador_telefone)
    returning id into v_pessoa_id;
  end if;

  select id, etapa into v_jornada_id, v_etapa_atual from jornadas
   where pessoa_id = v_pessoa_id and desfecho = 'aberta' limit 1;

  if v_jornada_id is null then
    insert into jornadas (pessoa_id, origem, trilha, etapa)
    values (v_pessoa_id, 'outro', 'seminario', 'captado')
    returning id, etapa into v_jornada_id, v_etapa_atual;
  end if;

  if p_status = 'aprovado' then
    v_etapa_alvo := case v_produto.tipo
                      when 'sessao_viabilidade' then 'sessao_contratada'
                      when 'croqui_estrutural'  then 'croqui_contratado'
                      when 'holding'            then 'holding_contratada'
                    end;
    if v_etapa_alvo is not null and v_etapa_atual is distinct from v_etapa_alvo then
      begin
        update jornadas set etapa = v_etapa_alvo where id = v_jornada_id;
        v_etapa_avancada := true;
      exception when check_violation then
        v_observacao := 'etapa_nao_avancada: transicao ' || v_etapa_atual::text || ' -> ' || v_etapa_alvo::text || ' nao permitida';
      end;
    end if;
  end if;

  begin
    insert into pagamentos (jornada_id, pessoa_id, produto_id, origem, transacao_externa_id,
                            status, valor, moeda, parcelas, comprador_email, comprador_nome,
                            comprador_telefone, pago_em, bruto)
    values (v_jornada_id, v_pessoa_id, v_produto.id, 'hotmart', p_transacao_externa_id,
            p_status, p_valor, p_moeda, p_parcelas, p_comprador_email, p_comprador_nome,
            p_comprador_telefone, p_pago_em, p_bruto)
    on conflict (origem, transacao_externa_id) do update set status = excluded.status
    returning id into v_pagamento_id;
  exception when others then
    v_observacao := coalesce(v_observacao || ' | ', '') || 'pagamento_bloqueado: ' || sqlerrm;
    return query select null::uuid, v_jornada_id, true, v_etapa_avancada, v_observacao;
    return;
  end;

  return query select v_pagamento_id, v_jornada_id, true, v_etapa_avancada, v_observacao;
end $$;
revoke execute on function public.processar_pagamento_hotmart from public, anon, authenticated;
grant  execute on function public.processar_pagamento_hotmart to service_role;

alter table produtos enable row level security;
alter table produtos force row level security;
alter table ofertas enable row level security;
alter table ofertas force row level security;
alter table pagamentos enable row level security;
alter table pagamentos force row level security;
alter table webhooks_eventos enable row level security;
alter table webhooks_eventos force row level security;

create policy prod_sel on produtos for select to authenticated using ((select app.eh_interno()));
create policy prod_wr  on produtos for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
create policy of_sel on ofertas for select to authenticated using ((select app.eh_interno()));
create policy of_wr  on ofertas for all to authenticated
  using ((select app.papel()) in ('admin','advogada')) with check ((select app.papel()) in ('admin','advogada'));
create policy pag_sel on pagamentos for select to authenticated using ((select app.eh_interno()));
-- Sem policy de INSERT/UPDATE para authenticated em pagamentos: só o webhook
-- (service_role) grava. Ver §3.1 — payload nunca é confiável para escrita direta.
-- webhooks_eventos: NENHUMA policy de leitura/escrita para authenticated. Só
-- service_role toca — o bruto pode carregar PII do comprador (nome, e-mail, telefone).
