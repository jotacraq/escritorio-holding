-- 0012_documentos_storage.sql
-- Documentos sensíveis do cliente (IR, contrato social, matrícula de imóvel) em
-- bucket PRIVADO, com auditoria de todo acesso. Upload e URL assinada sempre
-- passam pela rota do servidor (service_role) — o cliente nunca escolhe o caminho
-- do objeto nem toca o bucket diretamente.

create table documentos (
  id              uuid primary key default gen_random_uuid(),
  pessoa_id       uuid not null references pessoas(id) on delete restrict,
  jornada_id      uuid references jornadas(id),
  tipo            text not null check (tipo in ('imposto_renda','contrato_social','matricula_imovel','outro')),
  nome_arquivo    text not null,
  bucket          text not null default 'documentos-sensiveis',
  caminho         text not null unique,     -- pessoas/{pessoa_id}/{documento_id}/{slug}, montado pelo servidor
  mime            text not null check (mime in ('application/pdf','image/jpeg','image/png')),
  tamanho_bytes   bigint not null check (tamanho_bytes > 0 and tamanho_bytes <= 20971520),
  sha256          text,
  enviado_por     uuid references perfis_equipe(id),
  criado_em       timestamptz not null default now()
);
create index idx_documentos_pessoa on documentos (pessoa_id, tipo);
create index idx_documentos_jornada on documentos (jornada_id);

-- Auditoria de ACESSO a PII: quem abriu o documento de quem e quando. Append-only —
-- nunca UPDATE/DELETE, nem para service_role via app.
create table documentos_acessos (
  id            uuid primary key default gen_random_uuid(),
  documento_id  uuid not null references documentos(id) on delete cascade,
  perfil_id     uuid references perfis_equipe(id),
  acao          text not null check (acao in ('url_assinada','download','exclusao_logica')),
  ip            inet,
  user_agent    text,
  ocorrido_em   timestamptz not null default now()
);
create index idx_documentos_acessos_documento on documentos_acessos (documento_id, ocorrido_em desc);

alter table documentos enable row level security;
alter table documentos force row level security;
alter table documentos_acessos enable row level security;
alter table documentos_acessos force row level security;

-- Mesmo recorte de quem vê patrimônio: só admin/advogada.
create policy doc_sel on documentos for select to authenticated using ((select app.ve_patrimonio()));
-- Sem policy de INSERT/UPDATE/DELETE para authenticated: o upload (com validação de
-- mime/tamanho e montagem do caminho) só acontece na rota do servidor, service_role.
create policy da_sel on documentos_acessos for select to authenticated using ((select app.eh_admin()));
-- Sem policy de INSERT: a auditoria é gravada pela rota do servidor (service_role)
-- no mesmo request que emite a URL assinada — nunca confiar no cliente pra logar o
-- próprio acesso.

-- Bucket PRIVADO. Criado via SQL para ficar versionado na migration.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-sensiveis', 'documentos-sensiveis', false, 20971520,
        array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

-- Segunda trava (a primeira é a rota do servidor com service_role, que nem expõe
-- este caminho ao client). Mesmo que alguém tente falar direto com o Storage via
-- PostgREST/anon, só quem vê patrimônio consegue ler objeto deste bucket — e mesmo
-- assim não é assim que o app funciona: o app sempre serve URL assinada de 300s.
create policy storage_doc_sel on storage.objects for select to authenticated
  using (bucket_id = 'documentos-sensiveis' and (select app.ve_patrimonio()));
-- Sem policy de INSERT/UPDATE/DELETE para authenticated em storage.objects deste
-- bucket: upload é exclusivamente via rota do servidor com service_role.
