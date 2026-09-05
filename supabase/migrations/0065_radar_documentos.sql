-- 0065_radar_documentos.sql — Fase 5 · M2 (`docs/ARQUITETURA-FASE-5.md` §8.3).
-- Aplicar depois da 0064. Tudo ADITIVO e IDEMPOTENTE. Nenhum DELETE, nenhum
-- UPDATE em dado de cliente, nenhum backfill.
--
-- O QUE É: o "radar de documentos" mostra, por cliente, o que falta chegar
-- (coleta: IR, matrícula, contrato social, certidões) e o que falta entregar
-- (entrega: carta, sumário, contrato social de cada célula, alvará, cartão
-- CNPJ, acordo de sócios). Hoje isso é uma planilha estática de TRUE/FALSE no
-- Drive do escritório (`brain/06 - Materiais/Processo real do escritorio (Drive).md` §7).
--
-- A LISTA NÃO MORA AQUI. Ela é DERIVADA em código puro
-- (`src/lib/radar/derivar.ts`) do patrimônio, da família e do modelo do croqui.
-- Esta tabela guarda só o ATO HUMANO: pedi, conferi, dispensei. É por isso que
-- o radar tem um quarto estado, `a_pedir` (§11.5, CONFLITO 11) — a lista nasce
-- sem pedido nenhum, e chamar isso de "pedido" seria mentir na tela.
--
-- O que esta migration faz:
--   (a) `documentos.tipo` ganha 6 tipos. O CHECK é substituído por um mais
--       LARGO — nenhuma linha existente deixa de passar.
--   (b) `documentos.item_ref` — a qual bem/familiar o documento pertence. Sem
--       isso, "3 matrículas" não sabem dizer de qual dos 3 imóveis são, e o
--       radar teria de chutar. Nasce NULL para tudo que já existe: no radar o
--       casamento é exato ou não existe (nunca aproximado).
--   (c) `documentos_pedidos` — o ato humano: RLS `ve_patrimonio`, sem DELETE,
--       carimbo de servidor em quem/quando, imutabilidade do que identifica a
--       linha, e evento de timeline em pedido e conferência.
--   (d) template `documentos_pedido` (e-mail e WhatsApp) + RPC service_role
--       `enfileirar_pedido_documentos`, idempotente POR DIA: dois cliques em
--       "Pedir agora" no mesmo dia não viram duas mensagens.
--
-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO — harness runnável em scripts/verificacao-0064-0067.sql
-- (transacional; cada passo termina em `raise 'rollback_proposital'`).
--
--  0. PRÉ (antes de aplicar):
--       select tipo, count(*) from documentos group by 1 order by 1;   -- guardar a saída
--       select count(*) from pg_tables where tablename = 'documentos_pedidos';   → 0
--     DEPOIS de aplicar, repetir o group by: os MESMOS tipos, as MESMAS contagens.
--
--  1. CHECK novo, mais largo:
--       select pg_get_constraintdef(oid) from pg_constraint
--        where conrelid = 'documentos'::regclass and conname = 'ck_documentos_tipo';
--     → os 10 tipos. E `select count(*) from documentos` igual ao PRÉ.
--
--  2. Como `relacionamento` (não vê patrimônio):
--       select count(*) from documentos_pedidos;                        → 0 linhas (RLS)
--       insert into documentos_pedidos (jornada_id, chave, tipo)
--         values (:j,'coleta:imposto_renda:-','imposto_renda');         → 42501
--
--  3. Como `advogada`:
--       insert into documentos_pedidos (jornada_id, chave, tipo, pedido_em, pedido_por)
--            values (:j, 'coleta:imposto_renda:-', 'imposto_renda', '2000-01-01', :outro_perfil);
--       → ok, MAS `pedido_em` ≈ now() e `pedido_por` = perfil de auth.uid()
--       mesmo (jornada_id, chave) de novo                               → 23505
--       update ... set chave = 'x'                                      → 23514 pedido_imutavel
--       update ... set jornada_id = :outra                              → 23514 pedido_imutavel
--       update ... set conferido_em = '2000-01-01'
--       → ok, `conferido_em` ≈ now(), `conferido_por` = perfil de auth.uid()
--       update ... set conferido_em = null                              → 23514 conferencia_imutavel
--       update ... set mensagem_id = :m                                 → 42501 (sem grant de coluna)
--       delete from documentos_pedidos where id = :p                    → 42501 (sem grant)
--       select count(*) from eventos_timeline where jornada_id = :j and tipo = 'documento_pedido'; → 2
--
--  4. Idempotência da mensagem (como service_role):
--       select public.enfileirar_pedido_documentos(:j, 'https://app.exemplo/p/d/TOKEN');  → 1..2
--       repetir na mesma data                                                            → 0
--       select chave_idempotencia from mensagens_agendadas
--        where jornada_id = :j and chave_idempotencia like '%documentos_pedido%';
--       → '{jornada}:documentos_pedido:{AAAA-MM-DD}:{canal}'
--     Como `authenticated`: select public.enfileirar_pedido_documentos(:j, 'x'); → 42501
--
--  5. Sem destinatário (pessoa sem e-mail e sem telefone) → 0, sem erro e sem linha na fila.
--
--  6. Reaplicar a migration inteira não duplica template, coluna, política, índice nem trigger.
--
-- REVERSÃO:
--   drop function if exists public.enfileirar_pedido_documentos(uuid, text);
--   delete from mensagens_templates where chave = 'documentos_pedido'
--     and not exists (select 1 from mensagens_agendadas m where m.template_id = mensagens_templates.id);
--   drop trigger if exists trg_documentos_pedidos_timeline on documentos_pedidos;
--   drop trigger if exists trg_documentos_pedidos_protege on documentos_pedidos;
--   drop trigger if exists trg_documentos_pedidos_atualizado_em on documentos_pedidos;
--   drop function if exists app.documentos_pedidos_timeline();
--   drop function if exists app.protege_documento_pedido();
--   drop table if exists documentos_pedidos;
--   alter table documentos drop column if exists item_ref;
--   alter table documentos drop constraint if exists ck_documentos_tipo;
--   alter table documentos add constraint documentos_tipo_check
--     check (tipo in ('imposto_renda','contrato_social','matricula_imovel','outro'));
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- (a) Tipos novos. O CHECK vira uma constraint NOMEADA (a original é anônima,
-- `documentos_tipo_check`), para a reversão ser explícita.
-- ---------------------------------------------------------------------------
alter table documentos drop constraint if exists documentos_tipo_check;
alter table documentos drop constraint if exists ck_documentos_tipo;
alter table documentos add constraint ck_documentos_tipo check (tipo in (
  'imposto_renda',
  'contrato_social',
  'matricula_imovel',
  'certidao_casamento',
  'certidao_nascimento',
  'crlv',
  'extrato_investimento',
  'balanco',
  'comprovante_residencia',
  'outro'
));

-- ---------------------------------------------------------------------------
-- (b) A qual item o documento pertence (`patrimonio_itens.id`, `familiares.id`
-- ou a célula, na entrega). `text` e não FK: o mesmo campo aponta para tabelas
-- diferentes conforme o tipo, e uma FK forçaria uma delas.
-- ---------------------------------------------------------------------------
alter table documentos add column if not exists item_ref text;
comment on column documentos.item_ref is
  'Fase 5 §8.3 — a qual item o documento pertence (patrimonio_itens.id, familiares.id ou a célula na entrega). NULL = documento solto: o radar só casa com item que também não tem referência, nunca distribui documento solto entre itens.';

-- ---------------------------------------------------------------------------
-- (c) O ato humano
-- ---------------------------------------------------------------------------
create table if not exists documentos_pedidos (
  id             uuid primary key default gen_random_uuid(),
  jornada_id     uuid not null references jornadas(id) on delete cascade,
  -- Chave do item derivado: '{lado}:{tipo}:{item_ref|-}[:{sufixo}]'
  -- (`chaveItemRadar` em src/lib/radar/derivar.ts). Uma linha por item.
  chave          text not null check (length(chave) between 3 and 160),
  item_ref       text,
  tipo           text not null check (tipo in (
                   'imposto_renda','contrato_social','matricula_imovel','certidao_casamento',
                   'certidao_nascimento','crlv','extrato_investimento','balanco',
                   'comprovante_residencia','outro')),
  pedido_em      timestamptz not null default now(),
  pedido_por     uuid references perfis_equipe(id),
  -- A mensagem que levou o link `/p/d`. Escrita só por service_role.
  mensagem_id    uuid references mensagens_agendadas(id) on delete set null,
  conferido_em   timestamptz,
  conferido_por  uuid references perfis_equipe(id),
  dispensado_em  timestamptz,
  dispensado_por uuid references perfis_equipe(id),
  nota           text check (nota is null or length(nota) <= 500),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  -- Um pedido por item. É o que faz o duplo clique em "Pedir agora" ser inócuo.
  constraint uniq_documento_pedido unique (jornada_id, chave)
);

-- FK sem índice varre a tabela no ON DELETE (0053 aprendeu isso do jeito difícil).
create index if not exists idx_documentos_pedidos_mensagem on documentos_pedidos (mensagem_id) where mensagem_id is not null;
create index if not exists idx_documentos_pedidos_pendentes on documentos_pedidos (jornada_id) where conferido_em is null and dispensado_em is null;

drop trigger if exists trg_documentos_pedidos_atualizado_em on documentos_pedidos;
create trigger trg_documentos_pedidos_atualizado_em before update on documentos_pedidos
for each row execute function app.set_atualizado_em();

-- Carimbo de servidor + imutabilidade. Regra que só existe na rota não existe
-- (armadilha 4 do projeto): pelo PostgREST direto, `authenticated` gravaria
-- "conferido por outra pessoa em 2000".
create or replace function app.protege_documento_pedido() returns trigger
language plpgsql as $$
declare v_perfil uuid;
begin
  select id into v_perfil from perfis_equipe where auth_user_id = auth.uid() and ativo;

  if tg_op = 'INSERT' then
    -- service_role (sem auth.uid()) pode carimbar quem quiser: é a régua/cron.
    if v_perfil is not null then
      new.pedido_em     := now();
      new.pedido_por    := v_perfil;
      new.mensagem_id   := null;   -- quem enfileira é o servidor, não a tela
    end if;
    -- Nunca nasce conferido/dispensado: são atos posteriores.
    new.conferido_em   := null;
    new.conferido_por  := null;
    new.dispensado_em  := null;
    new.dispensado_por := null;
    return new;
  end if;

  if new.jornada_id is distinct from old.jornada_id
     or new.chave    is distinct from old.chave
     or new.tipo     is distinct from old.tipo
     or new.item_ref is distinct from old.item_ref
     or new.pedido_em  is distinct from old.pedido_em
     or new.pedido_por is distinct from old.pedido_por then
    raise exception 'pedido_imutavel: jornada, chave, tipo, item e o pedido original não mudam.'
      using errcode = '23514';
  end if;

  -- Conferência e dispensa não voltam atrás (é registro de ato, não rascunho).
  if old.conferido_em is not null and new.conferido_em is null then
    raise exception 'conferencia_imutavel: documento conferido não volta a pendente.' using errcode = '23514';
  end if;
  if old.dispensado_em is not null and new.dispensado_em is null then
    raise exception 'dispensa_imutavel: documento dispensado não volta a pendente.' using errcode = '23514';
  end if;

  if v_perfil is not null then
    if new.conferido_em is distinct from old.conferido_em and new.conferido_em is not null then
      new.conferido_em  := now();
      new.conferido_por := v_perfil;
    end if;
    if new.dispensado_em is distinct from old.dispensado_em and new.dispensado_em is not null then
      new.dispensado_em  := now();
      new.dispensado_por := v_perfil;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_documentos_pedidos_protege on documentos_pedidos;
create trigger trg_documentos_pedidos_protege before insert or update on documentos_pedidos
for each row execute function app.protege_documento_pedido();

-- Timeline: pedido e conferência são fatos da jornada, aparecem na Ficha.
create or replace function app.documentos_pedidos_timeline() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform app.registrar_evento_timeline(new.jornada_id, 'documento_pedido',
      'Documento pedido', new.tipo,
      jsonb_build_object('chave', new.chave, 'tipo', new.tipo, 'item_ref', new.item_ref, 'lado', split_part(new.chave, ':', 1)));
  elsif new.conferido_em is not null and old.conferido_em is null then
    perform app.registrar_evento_timeline(new.jornada_id, 'documento_pedido',
      'Documento conferido', new.tipo,
      jsonb_build_object('chave', new.chave, 'tipo', new.tipo, 'item_ref', new.item_ref));
  elsif new.dispensado_em is not null and old.dispensado_em is null then
    perform app.registrar_evento_timeline(new.jornada_id, 'documento_pedido',
      'Documento dispensado', new.tipo,
      jsonb_build_object('chave', new.chave, 'tipo', new.tipo, 'item_ref', new.item_ref, 'nota', new.nota));
  end if;
  return null;
end $$;

drop trigger if exists trg_documentos_pedidos_timeline on documentos_pedidos;
create trigger trg_documentos_pedidos_timeline after insert or update on documentos_pedidos
for each row execute function app.documentos_pedidos_timeline();

alter table documentos_pedidos enable row level security;
alter table documentos_pedidos force row level security;

-- Mesmo recorte de `documentos`: o pedido revela QUE bem a família tem.
drop policy if exists dp_sel on documentos_pedidos;
create policy dp_sel on documentos_pedidos for select to authenticated
  using ((select app.ve_patrimonio()));

drop policy if exists dp_ins on documentos_pedidos;
create policy dp_ins on documentos_pedidos for insert to authenticated
  with check ((select app.ve_patrimonio()));

drop policy if exists dp_upd on documentos_pedidos;
create policy dp_upd on documentos_pedidos for update to authenticated
  using ((select app.ve_patrimonio()))
  with check ((select app.ve_patrimonio()));

-- Sem DELETE para ninguém além de service_role: registro de ato não se apaga.
revoke all on documentos_pedidos from public, anon;
grant select, insert on documentos_pedidos to authenticated;
grant update (conferido_em, dispensado_em, nota) on documentos_pedidos to authenticated;
grant select, insert, update on documentos_pedidos to service_role;

comment on table documentos_pedidos is
  'Fase 5 §8.3 — o ATO HUMANO do radar de documentos (pedi, conferi, dispensei). A LISTA é derivada em src/lib/radar/derivar.ts; aqui não há checklist. RLS ve_patrimonio, sem DELETE, carimbos de servidor.';

-- ---------------------------------------------------------------------------
-- (d) A mensagem que pede os documentos
-- ---------------------------------------------------------------------------
insert into mensagens_templates (chave, canal, versao, assunto, corpo, ativo) values
 ('documentos_pedido', 'email', 1, 'Documentos para o seu Croqui',
  $t$Olá, {{nome}}.

Para montar o seu Croqui precisamos de alguns documentos.

Envie por este link seguro: {{link_documentos}}

Qualquer dúvida, é só responder este e-mail.

Equipe Time Holding Brasil$t$, true),
 ('documentos_pedido', 'whatsapp', 1, null,
  $t$Olá, {{nome}}! Para montar o seu Croqui precisamos de alguns documentos. Envie por este link seguro: {{link_documentos}}$t$, true)
on conflict (chave, canal, versao) do nothing;

/**
 * Enfileira a mensagem com o link `/p/d`, um envio por canal ativo, idempotente
 * POR DIA. Molde de `public.enfileirar_link_agendamento_ligacao_ia` (0053):
 * `security definer` porque `mensagens_agendadas` não aceita INSERT de
 * `authenticated` (0013/0019), e a rota nunca deve escrever a fila direto.
 *
 * Devolve quantas mensagens ENTRARAM na fila agora (0 = já pedido hoje, ou
 * pessoa sem e-mail e sem telefone, ou template inativo). Nunca levanta por
 * falta de destinatário: isso é pendência de cadastro, não erro de banco.
 */
create or replace function public.enfileirar_pedido_documentos(p_jornada_id uuid, p_url text)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pessoa record; v_t mensagens_templates; v_n int := 0;
  v_corpo text; v_assunto text; v_dest text; v_dia text;
begin
  if p_jornada_id is null or p_url is null or p_url !~ '^https?://' then
    return 0;
  end if;

  select p.nome, p.email, p.telefone into v_pessoa
    from jornadas j join pessoas p on p.id = j.pessoa_id
   where j.id = p_jornada_id;
  if not found then return 0; end if;

  v_dia := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');

  for v_t in select * from mensagens_templates where chave = 'documentos_pedido' and ativo loop
    v_dest := case v_t.canal when 'email' then v_pessoa.email else v_pessoa.telefone end;
    if v_dest is null or length(trim(v_dest)) = 0 then continue; end if;

    v_corpo := replace(replace(v_t.corpo, '{{nome}}', coalesce(split_part(v_pessoa.nome, ' ', 1), '')),
                       '{{link_documentos}}', p_url);
    v_assunto := nullif(replace(coalesce(v_t.assunto, ''), '{{nome}}', coalesce(split_part(v_pessoa.nome, ' ', 1), '')), '');

    insert into mensagens_agendadas (jornada_id, agendamento_id, template_id, canal, destinatario,
                                     agendada_para, chave_idempotencia, assunto_renderizado, corpo_renderizado)
    values (p_jornada_id, null, v_t.id, v_t.canal, v_dest, now(),
            p_jornada_id::text || ':documentos_pedido:' || v_dia || ':' || v_t.canal::text,
            v_assunto, v_corpo)
    on conflict (chave_idempotencia) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;

  return v_n;
end $$;
revoke execute on function public.enfileirar_pedido_documentos(uuid, text) from public, anon, authenticated;
grant  execute on function public.enfileirar_pedido_documentos(uuid, text) to service_role;
