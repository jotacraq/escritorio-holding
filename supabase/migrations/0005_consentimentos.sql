-- 0005_consentimentos.sql
-- LGPD. O TEXTO do consentimento é congelado na linha: mudar o texto no futuro
-- não pode reescrever o que a pessoa aceitou ontem.

create table consentimentos (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references pessoas(id) on delete restrict,
  tipo tipo_consentimento not null,
  concedido boolean not null,
  texto_apresentado text not null,        -- cópia literal do que foi lido/mostrado
  versao_texto text not null,             -- ex.: '4-sims-v1'
  canal text not null,                    -- 'sessao_zoom' | 'formulario' | 'email' | 'telefone'
  registrado_por uuid references perfis_equipe(id),
  concedido_em timestamptz not null default now(),
  revogado_em  timestamptz,
  criado_em timestamptz not null default now()
);
create index idx_consent_pessoa_tipo on consentimentos (pessoa_id, tipo, concedido_em desc);

-- Consentimento VIGENTE: último registro não revogado daquele tipo.
create or replace function app.tem_consentimento(p_pessoa uuid, p_tipo tipo_consentimento)
returns boolean language sql stable as $$
  select coalesce((select c.concedido and c.revogado_em is null
                     from consentimentos c
                    where c.pessoa_id = p_pessoa and c.tipo = p_tipo
                    order by c.concedido_em desc limit 1), false)
$$;

alter table consentimentos enable row level security;
alter table consentimentos force row level security;

create policy con_sel on consentimentos for select to authenticated using ((select app.eh_interno()));
create policy con_ins on consentimentos for insert to authenticated with check ((select app.eh_interno()));
create policy con_upd on consentimentos for update to authenticated  -- só para revogar
  using ((select app.papel()) in ('admin','advogada')) with check ((select app.papel()) in ('admin','advogada'));
