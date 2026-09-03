-- 0032_base_conhecimento.sql
-- ONDA 4 (B-4A) — Módulo 4: Base de Conhecimento (docs/ARQUITETURA-FASE-2.md
-- §4.5, linha B-4A da §5). CONFLITO C13 e C14, BLOQUEIO B13 definem o formato
-- inteiro deste arquivo — leia os três antes de tocar em qualquer parte dele.
--
-- O QUE ENTRA AQUI: até 3,4 MB de transcrição de CLIENTE REAL (hoje 70
-- arquivos: nome, família, patrimônio, valor declarado). É a maior massa de
-- PII de uma vez só neste banco. RLS = app.ve_patrimonio() em toda tabela
-- nova, sem exceção — a regra da tarefa é literal: "só quem vê patrimônio lê
-- transcrição: é conversa de advogado com cliente".
--
-- O QUE NÃO ENTRA AQUI: nenhum passe de IA sobre o conteúdo das transcrições.
-- Não existe consentimento de tratamento por IA registrado para nenhum destes
-- clientes (BLOQUEIO B13 / CONFLITO C14). `analises_transcricao` e
-- `padroes_conhecimento` nascem como tabela vazia, SEM PRODUTOR: nenhum
-- código deste commit escreve nelas (nem `scripts/importar-transcricoes.ts`,
-- que só toca `transcricoes` e `casos_conhecimento`). A trava de banco no
-- final deste arquivo (`app.exige_flag_analise_ia_habilitada`) garante isso
-- mesmo que um agente futuro esqueça de checar a env var no TypeScript — não
-- depende de lembrança de quem escrever o job de IA depois.
--
-- CONFLITO C13: o material de hoje prova que 18 das 52 Sessões de Viabilidade
-- têm apresentação de Croqui gravada. As outras 34 são `indefinido` — NUNCA
-- `nao_converteu`. Ausência de gravação de croqui não é prova de que a pessoa
-- não seguiu adiante (pode ter comprado sem gravação, pode estar em
-- andamento). Rotular como perda produziria uma taxa de conversão falsa que
-- alimentaria prompt, indicador e decisão comercial. O `check` abaixo proíbe
-- o terceiro valor ESTRUTURALMENTE — não dá pra inserir 'nao_converteu' nem
-- por engano de aplicação, nem por UPDATE direto via PostgREST.

create type tipo_transcricao as enum ('sessao_viabilidade', 'apresentacao_croqui');

-- ---------------------------------------------------------------------------
-- transcricoes — o material bruto, uma linha por arquivo importado.
-- ---------------------------------------------------------------------------
create table transcricoes (
  id              uuid primary key default gen_random_uuid(),
  tipo            tipo_transcricao not null,
  -- Nome do arquivo em "sic-hf-brain/06 - Materiais/Transcricoes/" — é a
  -- CHAVE DE IDEMPOTÊNCIA do script de importação (unique) e a única
  -- referência estável entre o material bruto (fora do repo) e a linha aqui.
  arquivo_origem  text not null unique,
  -- Nome como aparece no cabeçalho do arquivo. PII. Guardado como o script
  -- extraiu — nunca normalizado aqui; normalização é lógica de PAREAMENTO
  -- (só existe em scripts/importar-transcricoes.ts), não faz parte do dado.
  rotulo          text not null,
  -- Best-effort a partir do cabeçalho (GMT<yyyymmdd> embutido no nome da
  -- gravação, ou "DD/MM/AAAA", ou "N de <mês> de AAAA"). NULL quando o
  -- cabeçalho só cita mês/ano — nunca inventamos o dia (campo novo/impreciso
  -- nasce vazio, não com um palpite).
  data_reuniao    date,
  consultor       text,
  -- NULL para as 70 de hoje: são histórico anterior ao sistema, sem jornada.
  -- Existe para o dia em que uma transcrição nova entrar já presa a uma
  -- jornada corrente (fluxo futuro, fora desta entrega).
  jornada_id      uuid references jornadas(id),
  conteudo        text not null,
  tamanho_bytes   bigint not null check (tamanho_bytes > 0),
  sha256          text not null unique,
  importado_em    timestamptz not null default now(),
  -- NULL de propósito: quem importa é o script (service_role, sem sessão de
  -- usuário) — nunca uma rota chamada do navegador. Mesmo padrão de
  -- `documentos.enviado_por` quando a origem não é um perfil da equipe.
  importado_por   uuid references perfis_equipe(id),
  origem_dado     text not null default 'real' check (origem_dado in ('real', 'exemplo'))
);

-- Busca em 70 documentos e em 700 documentos tem que sair do MESMO formato de
-- plano — por isso o índice é GIN sobre to_tsvector(regconfig, texto), nunca
-- sobre unaccent(texto): unaccent() é STABLE (não indexável); to_tsvector
-- (regconfig, text) é IMMUTABLE e entra em índice (mesma nota de 0001 e do
-- índice análogo em 0003/0022 para `pessoas.nome`). `pt_unaccent` já existe
-- desde a 0001 — reaproveitado aqui, não recriado.
create index idx_transcricoes_busca on transcricoes
  using gin (to_tsvector('pt_unaccent', conteudo));
create index idx_transcricoes_tipo on transcricoes (tipo);
create index idx_transcricoes_jornada on transcricoes (jornada_id) where jornada_id is not null;

comment on table transcricoes is
  'Módulo 4 — material bruto das Sessões de Viabilidade e apresentações de '
  'Croqui Estrutural. PII pesada: só quem vê patrimônio lê (RLS ve_patrimonio). '
  'Sem passe de IA nesta entrega (BLOQUEIO B13) — conteudo nunca sai para a '
  'Anthropic. Ingestão idempotente por scripts/importar-transcricoes.ts.';
comment on column transcricoes.rotulo is
  'Nome do cliente como aparece no cabeçalho do arquivo original. PII.';
comment on column transcricoes.data_reuniao is
  'Best-effort a partir do cabeçalho do arquivo. NULL quando só dá pra saber '
  'mês/ano — nunca inventamos o dia.';

-- ---------------------------------------------------------------------------
-- casos_conhecimento — o pareamento SV -> apresentação de Croqui da MESMA
-- pessoa. Uma linha por Sessão de Viabilidade (52 no material de hoje);
-- transcricao_croqui_id fica NULL até o pareamento achar par (34 hoje).
-- ---------------------------------------------------------------------------
create table casos_conhecimento (
  id                    uuid primary key default gen_random_uuid(),
  -- Slug do arquivo da SV (ex.: 'cesar-emilio') — estável e único por
  -- construção (= transcricoes.arquivo_origem da SV, sem prefixo/extensão).
  -- Preferido a "nome normalizado" como chave porque o material de hoje já
  -- prova que nome não é chave segura: 'Rejane Pamplona de Campos Bonavita'
  -- aparece em DUAS Sessões de Viabilidade distintas, em datas diferentes,
  -- de pessoas presumivelmente da mesma família mas com sessões separadas.
  rotulo                text not null unique,
  transcricao_sv_id     uuid not null references transcricoes(id),
  transcricao_croqui_id uuid references transcricoes(id),
  -- NUNCA 'nao_converteu' — ver CONFLITO C13 no cabeçalho deste arquivo.
  desfecho_observado    text not null default 'indefinido'
    check (desfecho_observado in ('avancou_para_croqui', 'indefinido')),
  -- Preenchido quando a Dra. Elaine (ou o admin) CONFIRMA o desfecho de um
  -- caso a partir do que sabe por fora do material. É sempre UPDATE manual
  -- direto na tabela (a trigger abaixo só permite tocar isto e
  -- desfecho_observado, nunca o vínculo) — nunca migration nova. Ver
  -- CONFLITO C13 / BLOQUEIO B13 em docs/ARQUITETURA-FASE-2.md.
  revisado_por          uuid references perfis_equipe(id),
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  -- Invariante: se existe apresentação de croqui pareada, o desfecho só pode
  -- ser 'avancou_para_croqui' — o banco não deixa os dois campos discordarem.
  constraint ck_croqui_implica_avancou check (
    transcricao_croqui_id is null or desfecho_observado = 'avancou_para_croqui'
  )
);
create index idx_casos_desfecho on casos_conhecimento (desfecho_observado);
-- Uma apresentação de croqui pertence a, no máximo, um caso.
create unique index uniq_casos_croqui on casos_conhecimento (transcricao_croqui_id)
  where transcricao_croqui_id is not null;

create trigger trg_casos_conhecimento_atualizado_em before update on casos_conhecimento
for each row execute function app.set_atualizado_em();

-- O vínculo é obra da INGESTÃO (scripts/importar-transcricoes.ts), não de
-- edição manual: UPDATE direto só pode tocar desfecho_observado/revisado_por
-- (mesmo padrão de app.impede_realocacao_familiar / impede_realocacao_sessao
-- em 0021 — coluna de identidade/vínculo não é editável por UPDATE livre).
create or replace function app.impede_realocacao_caso_conhecimento() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.rotulo is distinct from old.rotulo
     or new.transcricao_sv_id is distinct from old.transcricao_sv_id
     or new.transcricao_croqui_id is distinct from old.transcricao_croqui_id then
    raise exception 'alteracao_invalida: rotulo/transcricao_sv_id/transcricao_croqui_id de casos_conhecimento são imutáveis por UPDATE — o vínculo é recomputado só por scripts/importar-transcricoes.ts' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_impede_realocacao_caso_conhecimento before update on casos_conhecimento
for each row execute function app.impede_realocacao_caso_conhecimento();

comment on table casos_conhecimento is
  'Pareamento SV -> apresentação de Croqui por pessoa. 52 linhas esperadas '
  'hoje (uma por Sessão de Viabilidade). desfecho_observado NUNCA é prova de '
  'perda (CONFLITO C13) — "indefinido" é o default honesto, não "não '
  'converteu". revisado_por marca confirmação humana; ver trigger de '
  'imutabilidade do vínculo.';

-- ---------------------------------------------------------------------------
-- analises_transcricao — o que a IA diria sobre CADA transcrição, quando/se
-- destravado. Tabela e RLS existem; NINGUÉM escreve nela nesta entrega
-- (BLOQUEIO B13) — ver trigger de trava mais abaixo.
-- ---------------------------------------------------------------------------
create table analises_transcricao (
  id             uuid primary key default gen_random_uuid(),
  transcricao_id uuid not null references transcricoes(id) on delete cascade,
  execucao_id    uuid references execucoes_ia(id),
  versao         smallint not null,
  conteudo       jsonb not null,
  origem_dado    text not null default 'real' check (origem_dado in ('real', 'exemplo')),
  atual          boolean not null default true,
  criado_em      timestamptz not null default now(),
  unique (transcricao_id, versao)
);
create unique index uniq_analise_transcricao_atual on analises_transcricao (transcricao_id) where atual;

comment on table analises_transcricao is
  'Saída de IA por transcrição — SEM PRODUTOR nesta entrega. Todo INSERT '
  'exige configuracoes[''conhecimento.analise_ia_habilitada''] = true (ver '
  'trigger app.exige_flag_analise_ia_habilitada). BLOQUEIO B13.';

-- ---------------------------------------------------------------------------
-- padroes_conhecimento — o que a base de conhecimento "aprendeu" ao longo do
-- tempo (frase que aumenta conversão, objeção recorrente etc.). Também sem
-- produtor nesta entrega: alimentar isto depende da análise por IA acima,
-- que depende do mesmo BLOQUEIO B13. Sem policy de escrita para
-- `authenticated` de propósito — o fluxo de aprovação humana
-- (aprovado_por/aprovado_em) só faz sentido quando existir o que aprovar.
-- ---------------------------------------------------------------------------
create table padroes_conhecimento (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null check (tipo in ('frase_aumenta', 'frase_reduz', 'objecao', 'padrao_condicao')),
  texto          text not null,
  observacoes    text,
  ocorrencias    int not null default 0 check (ocorrencias >= 0),
  casos_ids      uuid[] not null default '{}',
  grau_confianca smallint check (grau_confianca between 0 and 100),
  -- Nada daqui entra em prompt de produção sem aprovado_em preenchido — e
  -- ligar isso ao contexto do briefing é tarefa de outra migration (versão
  -- nova de prompt), não desta. Base de conhecimento que se auto-injeta em
  -- prompt sem aprovação é o método virando ruído (nota do plano, §4.5).
  aprovado_por   uuid references perfis_equipe(id),
  aprovado_em    timestamptz,
  criado_em      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS — "só quem vê patrimônio lê transcrição: é conversa de advogado com
-- cliente" (regra da tarefa). Nenhuma das quatro tabelas tem policy de
-- INSERT/DELETE para `authenticated`; a única exceção de escrita é o UPDATE
-- restrito de casos_conhecimento (desfecho/revisão) logo abaixo. Toda a
-- escrita de ingestão é `service_role` (o script roda fora de sessão de
-- usuário — mesmo padrão de `documentos`/`webhooks_eventos`), e o futuro
-- passe de IA também escreveria com `service_role` a partir de um job, nunca
-- de uma rota chamada pelo navegador.
-- ---------------------------------------------------------------------------
alter table transcricoes         enable row level security;
alter table casos_conhecimento   enable row level security;
alter table analises_transcricao enable row level security;
alter table padroes_conhecimento enable row level security;
alter table transcricoes         force row level security;
alter table casos_conhecimento   force row level security;
alter table analises_transcricao force row level security;
alter table padroes_conhecimento force row level security;

create policy tr_sel on transcricoes         for select to authenticated using ((select app.ve_patrimonio()));
create policy cc_sel on casos_conhecimento   for select to authenticated using ((select app.ve_patrimonio()));
create policy at_sel on analises_transcricao for select to authenticated using ((select app.ve_patrimonio()));
create policy pc_sel on padroes_conhecimento for select to authenticated using ((select app.ve_patrimonio()));

-- Única exceção de escrita para `authenticated`: carimbar o desfecho revisado
-- por um humano (CONFLITO C13). `ve_patrimonio()`, não `eh_admin()` — quem
-- tem contexto pra confirmar um caso 'indefinido' é a advogada (papel
-- 'advogada'), não só o admin técnico. A trigger de imutabilidade acima
-- garante que este UPDATE só consegue mudar desfecho_observado/revisado_por.
create policy cc_upd on casos_conhecimento for update to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
-- Sem policy de INSERT/DELETE em nenhuma das quatro tabelas para
-- `authenticated`: casos e transcrições nascem só pela ingestão.

-- ---------------------------------------------------------------------------
-- BLOQUEIO B13 — trava de BANCO, não só de aplicação, contra o passe de IA.
-- `configuracoes` já existe desde a 0027; a chave abaixo é lida por qualquer
-- job futuro E, mais importante, CHECADA por trigger: mesmo que alguém
-- escreva o job de IA e esqueça de checar a env var `CONHECIMENTO_ANALISE_IA`
-- no TypeScript, o INSERT em analises_transcricao falha até esta linha virar
-- `true` — e virar `true` é uma decisão jurídica registrada (CONFLITO C14),
-- não um flip de env var num deploy apressado.
-- ---------------------------------------------------------------------------
insert into configuracoes (chave, valor, descricao) values
 ('conhecimento.analise_ia_habilitada', 'false',
  'BLOQUEIO B13 / CONFLITO C14 (LGPD): trava de banco para o passe de IA sobre '
  'transcrições de Sessão de Viabilidade. Nasce false. Nenhuma linha entra em '
  'analises_transcricao enquanto for false — mesmo com service_role, mesmo por '
  'engano de código (ver trigger app.exige_flag_analise_ia_habilitada). Ligar '
  'exige decisão jurídica registrada, não um UPDATE motivado por pressa — ver '
  'docs/ARQUITETURA-FASE-2.md §6 (C14) e §7 (B13).')
on conflict (chave) do nothing;

create or replace function app.exige_flag_analise_ia_habilitada() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_habilitada boolean;
begin
  select coalesce((valor #>> '{}')::boolean, false) into v_habilitada
    from configuracoes where chave = 'conhecimento.analise_ia_habilitada';
  if not coalesce(v_habilitada, false) then
    raise exception 'analise_ia_de_transcricao_bloqueada: BLOQUEIO B13 - sem decisao juridica registrada para tratamento por IA das transcricoes' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger trg_exige_flag_analise_ia before insert on analises_transcricao
for each row execute function app.exige_flag_analise_ia_habilitada();

-- ---------------------------------------------------------------------------
-- Busca segura, parametrizada — mesmo racional de 0022_busca_pessoas_segura:
-- `p_termo`/`p_tipo`/`p_desfecho` são sempre bind parameters do PostgREST,
-- nunca concatenados em filtro — sem meta-caractere pra escapar da árvore de
-- filtro. `websearch_to_tsquery` (nunca `to_tsquery`/`plainto_tsquery`) de
-- propósito: é permissivo com sintaxe de operador solta e NUNCA lança erro de
-- parsing de tsquery — um erro de sintaxe aqui poderia virar mensagem de erro
-- ecoando fragmento do termo (ou, em tese, do plano/dado) para o cliente, que
-- é exatamente o que a tarefa proíbe ("a busca não pode vazar trecho por
-- mensagem de erro"). `security invoker`: a RLS de `transcricoes`/
-- `casos_conhecimento` (ve_patrimonio) filtra por baixo — quem não vê
-- patrimônio recebe zero linhas, nunca um erro que confirme que a tabela tem
-- dado (P11 do plano de pentest).
-- ---------------------------------------------------------------------------
create or replace function public.buscar_transcricoes_por_termo(
  p_termo    text,
  p_tipo     tipo_transcricao default null,
  p_desfecho text default null,
  p_limite   integer default 20,
  p_offset   integer default 0
)
returns table (
  transcricao_id uuid,
  tipo           tipo_transcricao,
  arquivo_origem text,
  rotulo         text,
  data_reuniao   date,
  relevancia     real,
  trecho         text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select t.id, t.tipo, t.arquivo_origem, t.rotulo, t.data_reuniao,
         ts_rank(to_tsvector('pt_unaccent', t.conteudo), websearch_to_tsquery('pt_unaccent', p_termo)) as relevancia,
         ts_headline('pt_unaccent', t.conteudo, websearch_to_tsquery('pt_unaccent', p_termo),
           'StartSel=**,StopSel=**,MaxFragments=2,MaxWords=30,MinWords=10,ShortWord=3,HighlightAll=false') as trecho
    from transcricoes t
    left join casos_conhecimento c
      on c.transcricao_sv_id = t.id or c.transcricao_croqui_id = t.id
   where p_termo is not null and length(trim(p_termo)) > 0
     and to_tsvector('pt_unaccent', t.conteudo) @@ websearch_to_tsquery('pt_unaccent', p_termo)
     and (p_tipo is null or t.tipo = p_tipo)
     and (p_desfecho is null or c.desfecho_observado = p_desfecho)
   order by relevancia desc, t.data_reuniao desc nulls last
   limit greatest(least(coalesce(p_limite, 20), 100), 1)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

comment on function public.buscar_transcricoes_por_termo(text, tipo_transcricao, text, integer, integer) is
  'Busca full-text em transcricoes.conteudo via pt_unaccent (0001/0003/0022). '
  'Todo parâmetro é bind parameter — nunca concatenado. RLS de transcricoes '
  'filtra por baixo: quem não vê patrimônio recebe zero linhas, nunca erro.';

revoke execute on function public.buscar_transcricoes_por_termo(text, tipo_transcricao, text, integer, integer) from public, anon;
grant  execute on function public.buscar_transcricoes_por_termo(text, tipo_transcricao, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Views de leitura (mesmo padrão de 0033/0034: security_invoker, RLS por
-- baixo decide quem vê linha). Cobrem "lista de casos" e "contagem por
-- desfecho" do F-4A sem RPC nenhuma — é SELECT simples, não precisa de
-- security definer.
-- ---------------------------------------------------------------------------
create view vw_casos_conhecimento with (security_invoker = true) as
select
  c.id                    as caso_id,
  c.rotulo,
  c.desfecho_observado,
  c.revisado_por,
  c.criado_em,
  c.atualizado_em,
  sv.id                   as transcricao_sv_id,
  sv.data_reuniao         as sv_data_reuniao,
  sv.consultor            as sv_consultor,
  cr.id                   as transcricao_croqui_id,
  cr.data_reuniao         as croqui_data_reuniao
from casos_conhecimento c
join transcricoes sv on sv.id = c.transcricao_sv_id
left join transcricoes cr on cr.id = c.transcricao_croqui_id;

comment on view vw_casos_conhecimento is
  'Conhecimento > lista de casos, com rótulo e datas das duas transcrições. '
  'security_invoker: RLS de transcricoes/casos_conhecimento decide quem vê '
  'linha — não é bypass de RLS.';

-- Numerador e denominador SEPARADOS de propósito (mesma regra de
-- vw_indicadores_pop01 em 0034_painel_dia.sql): o percentual de conversão é
-- calculado na TELA, nunca aqui — e a tela não pode dizer "68% avançaram" sem
-- dizer, ao lado, "34 indefinidos, isso não é perda" (CONFLITO C13).
create view vw_conhecimento_contagem_desfecho with (security_invoker = true) as
select desfecho_observado, count(*) as total
  from casos_conhecimento
 group by desfecho_observado;

comment on view vw_conhecimento_contagem_desfecho is
  'Conhecimento > os dois números do CONFLITO C13. Nunca combinar em '
  'percentual sem mostrar os dois — "indefinido" não é "não converteu".';

-- ---------------------------------------------------------------------------
-- Verificação esperada após scripts/importar-transcricoes.ts --aplicar contra
-- as 70 transcrições de sic-hf-brain/06 - Materiais/Transcricoes/:
--   select tipo, count(*) from transcricoes group by tipo;
--     -- sessao_viabilidade: 52 · apresentacao_croqui: 18
--   select count(*), count(*) filter (where desfecho_observado = 'avancou_para_croqui')
--     from casos_conhecimento;
--     -- 52 casos, 18 com avancou_para_croqui (ver relatório de entrega do script)
--   select polname, polcmd from pg_policy
--     where polrelid in ('transcricoes'::regclass, 'casos_conhecimento'::regclass,
--                         'analises_transcricao'::regclass, 'padroes_conhecimento'::regclass);
--     -- nenhuma linha com polcmd = 'a' (ALL) nem polcmd = 'd' (DELETE)
-- ---------------------------------------------------------------------------
