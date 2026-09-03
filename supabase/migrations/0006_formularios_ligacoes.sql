-- 0006_formularios_ligacoes.sql
-- POP 02 (Formulário Estratégico) e POP 03 / 03-B (Ligação Estratégica).

-- O formulário MUDA (hoje é v0.2). Resposta guardada como jsonb + versão da definição.
create table formularios (
  id uuid primary key default gen_random_uuid(),
  chave text not null,                 -- 'estrategico'
  versao smallint not null,            -- 2  (POP 02 v0.2)
  definicao jsonb not null,            -- [{id:'p9', bloco:'Patrimônio', tipo:'unica', rotulo:..., opcoes:[...]}]
  ativo boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (chave, versao)
);
create unique index uniq_formulario_ativo on formularios (chave) where ativo;

create table formularios_respostas (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  formulario_id uuid not null references formularios(id),
  respostas jsonb not null,            -- {"p1":"...","p9":"Entre R$ 1 milhão e R$ 2 milhões","p10":["Imóveis"]}
  origem text not null default 'sistema' check (origem in ('sistema','typeform','importado')),
  origem_dado text not null default 'real' check (origem_dado in ('real','exemplo')),
  respondido_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  unique (jornada_id)                  -- uma resposta por jornada; reenvio sobrescreve com histórico na timeline
);

-- POP 03 / 03-B. Separa FATO (resposta), OBSERVAÇÃO (o colaborador viu) e FRASE (literal do cliente).
-- O Protocolo 01 exige essa separação; misturar tudo num "notas" livre destrói o briefing.
create table ligacoes_estrategicas (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  pop text not null default '03' check (pop in ('03','03-B')),
  realizada_em timestamptz not null default now(),
  duracao_segundos int check (duracao_segundos >= 0),
  colaborador_id uuid references perfis_equipe(id),
  -- respostas às 5 perguntas do roteiro, chaveadas por pergunta
  respostas jsonb not null default '{}'::jsonb,
  -- registro obrigatório do POP 03 ("Informações obrigatórias para registro")
  expectativa_principal text,
  preocupacao_principal text,
  assunto_atencao_especial text,
  objecoes_percebidas text[],
  pessoas_mencionadas text[],
  -- observação comportamental OBJETIVA (POP 03-B manda registrar sem interpretar DISC)
  ritmo text check (ritmo in ('rapido','moderado','pausado')),
  estilo_resposta text check (estilo_resposta in ('muito_objetiva','objetiva','detalhada','conta_historias')),
  sinais text[],                        -- 'interrompe','demonstra_cautela','procura_numeros',...
  frases_marcantes text[],              -- 1 a 3 frases LITERAIS
  processo_decisorio text check (processo_decisorio in ('influenciador','comunicador','decisor_conjunto','decide_sozinho')),
  decisores_presentes_na_sessao boolean,
  transcricao text,                     -- PII: só entra na IA com consentimento (ver camada de IA)
  observacoes text,
  origem_dado text not null default 'real' check (origem_dado in ('real','exemplo')),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id), atualizado_por uuid references perfis_equipe(id)
);
create index idx_ligacoes_jornada on ligacoes_estrategicas (jornada_id, realizada_em desc);

create trigger trg_ligacoes_atualizado_em before update on ligacoes_estrategicas
for each row execute function app.set_atualizado_em();

alter table formularios enable row level security;
alter table formularios_respostas enable row level security;
alter table ligacoes_estrategicas enable row level security;
alter table formularios force row level security;
alter table formularios_respostas force row level security;
alter table ligacoes_estrategicas force row level security;

create policy form_sel on formularios for select to authenticated using ((select app.eh_interno()));
create policy form_wr  on formularios for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));

create policy fr_sel on formularios_respostas for select to authenticated using ((select app.eh_interno()));
create policy fr_wr  on formularios_respostas for all to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));

create policy lig_sel on ligacoes_estrategicas for select to authenticated using ((select app.eh_interno()));
create policy lig_wr  on ligacoes_estrategicas for all to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
