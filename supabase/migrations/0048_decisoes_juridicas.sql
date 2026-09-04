-- 0048_decisoes_juridicas.sql
-- Fase 3 — corrige achado MÉDIO do pentest (CONTINUAR-AQUI.md §7, item 5):
-- a trava de LGPD sobre análise de IA nas transcrições da Base de Conhecimento
-- (BLOQUEIO B13, 0032_base_conhecimento.sql) era um boolean solto em
-- `configuracoes['conhecimento.analise_ia_habilitada']` — editável por
-- QUALQUER admin, via UPDATE simples, sem registrar quem decidiu, quando, nem
-- com que base legal. Ganhou peso extra com a migração de IA para OpenRouter
-- (0040): o subprocessador mudou e o texto de consentimento de
-- `tratamento_ia` (src/server/ia/erros.ts) nomeia "Anthropic" especificamente
-- — mais um motivo para a decisão de liberar isto ser rastreável de verdade,
-- não um flip de valor.
--
-- IMPORTANTE — o que esta migration NÃO faz: não escreve nenhum texto de base
-- legal, não decide que a análise está liberada, não presume que o
-- consentimento de `tratamento_ia` (0005/0032) cobre o subprocessador novo.
-- Isto é ESTRUTURA — a decisão de mérito é da Dra. Elaine, registrada por ela
-- (ou por quem ela autorizar) depois que esta migration estiver no ar.
--
-- Diferença entre os dois mecanismos, para quem chegar depois (não são a
-- mesma coisa, ver tarefa que originou esta migration):
--   - `consentimentos` (0005) + `temConsentimento()` (src/server/ia/
--     consentimento.ts): consentimento do TITULAR (o cliente) para um tipo de
--     tratamento (`tratamento_ia`, entre outros). É por pessoa.
--   - `decisoes_juridicas` (esta migration): decisão INSTITUCIONAL do
--     escritório sobre USAR IA de terceiro sobre a base de transcrições —
--     "podemos rodar análise de IA sobre este material, com este
--     subprocessador, com esta base legal". É global, não por pessoa. As duas
--     travas continuam existindo e são independentes: uma rota de análise de
--     transcrição, quando existir, precisa das DUAS (consentimento do titular
--     E decisão institucional ativa) — nenhuma substitui a outra.

-- ===========================================================================
-- (a) decisoes_juridicas — registra COM peso de auditoria: o quê, base legal,
--     quem (só admin/advogada — mesmo recorte de quem vê patrimônio e decide
--     sobre IA no resto do sistema, app.ve_patrimonio()), quando, e se está
--     ativa. Revogar é UPDATE de `revogada_em`/`revogada_por` — NUNCA DELETE
--     nem sobrescrita do texto: decisão revogada continua rastreável
--     (mesmo princípio de dado versionado da tarefa/CLAUDE.md, "prompt é
--     versionado" — aqui é "decisão jurídica é versionada").
-- ===========================================================================
create table decisoes_juridicas (
  id               uuid primary key default gen_random_uuid(),

  -- Chave estável do QUE está sendo decidido — não é texto livre: uma rota
  -- de enforcement (trigger, RPC) precisa de um valor fixo para consultar,
  -- do mesmo jeito que `configuracoes.chave` é fixo. Nasce com uma única
  -- chave conhecida (a que substitui o boolean de 0032); CHECK fecha a
  -- lista — chave nova de decisão jurídica é migration, mesmo raciocínio
  -- de "configuracoes não aceita INSERT livre pela tela" (0027).
  escopo           text not null
    check (escopo in ('conhecimento.analise_ia_transcricoes')),

  -- O que foi decidido, em linguagem humana (auditoria/exibição). Texto
  -- livre preenchido por quem registra — não inferido, não padrão.
  descricao        text not null check (length(trim(descricao)) > 0),

  -- Base legal — TEXTO LIVRE de propósito (LGPD art. X, consentimento
  -- expresso do titular, legítimo interesse etc.). Esta migration não
  -- assume nenhum valor aqui: fica para a Dra. Elaine preencher a decisão
  -- real via a rota (item 5 da tarefa). Sem default — decisão sem base
  -- legal escrita não é uma decisão jurídica, é um flip disfarçado.
  base_legal       text not null check (length(trim(base_legal)) > 0),

  -- Subprocessador nomeado por esta decisão (Anthropic, OpenRouter, ambos).
  -- Também texto livre: não é este código que decide se o consentimento de
  -- `tratamento_ia` cobre um subprocessador adicional — é uma pergunta para
  -- a Dra. Elaine (nota da tarefa: "confirmar se isso cobre um
  -- subprocessador adicional"). O campo existe para a resposta ficar
  -- registrada, não para o sistema resolver sozinho.
  subprocessador   text not null check (length(trim(subprocessador)) > 0),

  decidido_por     uuid not null references perfis_equipe(id),
  decidido_em      timestamptz not null default now(),

  -- Revogação preserva histórico — nunca DELETE, nunca sobrescreve
  -- descricao/base_legal de uma decisão já tomada (trigger de imutabilidade
  -- abaixo). Mudar de ideia é uma decisão NOVA (linha nova), como prompt
  -- versionado.
  revogada_em      timestamptz,
  revogada_por     uuid references perfis_equipe(id),
  motivo_revogacao text,

  criado_em        timestamptz not null default now(),

  constraint ck_revogacao_consistente check (
    (revogada_em is null and revogada_por is null)
    or (revogada_em is not null and revogada_por is not null)
  )
);

-- "Decisão ativa" = não revogada. No máximo UMA linha ativa por escopo — a
-- outra tentativa é ativar uma decisão nova de mesmo escopo depois de
-- revogar a anterior (histórico completo continua rastreável, só não pode
-- haver duas decisões "vigentes" e potencialmente conflitantes ao mesmo
-- tempo sobre o mesmo escopo).
create unique index uniq_decisao_juridica_ativa on decisoes_juridicas (escopo)
  where revogada_em is null;

create index idx_decisoes_juridicas_escopo on decisoes_juridicas (escopo, decidido_em desc);

comment on table decisoes_juridicas is
  'Decisão institucional (não do titular/cliente) sobre uso de IA de '
  'terceiro em dado sensível. Substitui o boolean solto de '
  'configuracoes[''conhecimento.analise_ia_habilitada''] (0032) por um '
  'registro com quem decidiu, quando, base legal e subprocessador — nunca '
  'sobrescrito, só revogado (linha nova = nova decisão). Independente de '
  '`consentimentos`/tratamento_ia (0005), que é consentimento do TITULAR.';
comment on column decisoes_juridicas.escopo is
  'Chave fixa do que está sendo decidido — CHECK fecha a lista, igual a '
  'configuracoes.chave. Escopo novo é migration.';
comment on column decisoes_juridicas.base_legal is
  'Texto livre (LGPD art. X, consentimento expresso, legítimo interesse...). '
  'NÃO preenchido por esta migration — decisão de mérito da Dra. Elaine.';
comment on column decisoes_juridicas.subprocessador is
  'Quem processa o dado sob esta decisão (ex.: "OpenRouter, roteado só para '
  'Anthropic"). Texto livre — o sistema não presume cobertura de '
  'subprocessador novo por consentimento antigo.';

-- Imutabilidade do conteúdo já decidido: UPDATE só pode tocar os três campos
-- de revogação. Mesmo padrão de app.impede_realocacao_caso_conhecimento
-- (0032) e app.impede_realocacao_familiar (0021) — campo de identidade/mérito
-- não é editável por UPDATE livre, só por INSERT de linha nova.
create or replace function app.impede_edicao_decisao_juridica() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.escopo is distinct from old.escopo
     or new.descricao is distinct from old.descricao
     or new.base_legal is distinct from old.base_legal
     or new.subprocessador is distinct from old.subprocessador
     or new.decidido_por is distinct from old.decidido_por
     or new.decidido_em is distinct from old.decidido_em then
    raise exception 'alteracao_invalida: decisao_juridica e imutavel apos criada - revogue e registre uma decisao nova' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_impede_edicao_decisao_juridica before update on decisoes_juridicas
for each row execute function app.impede_edicao_decisao_juridica();

-- ===========================================================================
-- (b) RLS — mesmo recorte de quem vê patrimônio e decide sobre IA no resto do
--     sistema (app.ve_patrimonio(): admin ou advogada). Leitura para
--     app.eh_interno() faria sentido operacionalmente, mas a tarefa pede
--     explicitamente "mesma regra de quem vê patrimônio" para TODA a
--     superfície desta tabela — inclusive leitura, dado que o conteúdo
--     (base legal, subprocessador) é, ele mesmo, informação sensível sobre
--     como o escritório trata dado de cliente.
-- ===========================================================================
alter table decisoes_juridicas enable row level security;
alter table decisoes_juridicas force row level security;

create policy dj_sel on decisoes_juridicas for select to authenticated
  using ((select app.ve_patrimonio()));
create policy dj_ins on decisoes_juridicas for insert to authenticated
  with check ((select app.ve_patrimonio()) and decidido_por = (
    select id from perfis_equipe where auth_user_id = auth.uid() and ativo
  ));
create policy dj_upd on decisoes_juridicas for update to authenticated
  using ((select app.ve_patrimonio()))
  with check ((select app.ve_patrimonio()));
-- Sem policy de DELETE: decisão jurídica (ativa ou revogada) nunca se apaga —
-- é o próprio objetivo desta migration (auditoria real, não editável em
-- silêncio). GRANT explícito abaixo, porque service_role não dispensa GRANT
-- (regra da tarefa) e o role de migração já revoga PUBLIC/anon por default
-- desde a 0024.
revoke all on decisoes_juridicas from public, anon;
grant select, insert, update on decisoes_juridicas to authenticated;
grant select, insert, update on decisoes_juridicas to service_role;

-- ===========================================================================
-- (c) Enforcement técnico — a trigger de 0032 que hoje olha o boolean simples
--     passa a olhar para a EXISTÊNCIA de decisão ativa deste escopo. Mesma
--     tabela-alvo (analises_transcricao), mesmo texto de exceção (código),
--     comportamento honesto para quem já lida com o erro
--     'analise_ia_de_transcricao_bloqueada' hoje (nenhum código de aplicação
--     trata isso ainda — grep confirma: 0 chamadores de INSERT em
--     analises_transcricao — mas o nome do erro fica estável de propósito).
--     `create or replace function` MESMA assinatura: substitui, não
--     sobrepõe (armadilha #6 do brain só se aplica a parâmetro novo).
-- ===========================================================================
create or replace function app.exige_flag_analise_ia_habilitada() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_tem_decisao_ativa boolean;
begin
  select exists (
    select 1 from decisoes_juridicas
     where escopo = 'conhecimento.analise_ia_transcricoes'
       and revogada_em is null
  ) into v_tem_decisao_ativa;

  if not coalesce(v_tem_decisao_ativa, false) then
    raise exception 'analise_ia_de_transcricao_bloqueada: BLOQUEIO B13 - sem decisao juridica ativa registrada em decisoes_juridicas para o escopo conhecimento.analise_ia_transcricoes' using errcode = 'check_violation';
  end if;

  return new;
end $$;
-- Trigger já existe (0032, trg_exige_flag_analise_ia before insert on
-- analises_transcricao) e não precisa ser recriada: aponta para a função
-- pelo nome, e create or replace já trocou o corpo dela.

comment on function app.exige_flag_analise_ia_habilitada() is
  'BLOQUEIO B13. Trava de BANCO (não só aplicação): todo INSERT em '
  'analises_transcricao exige decisão ATIVA em decisoes_juridicas para o '
  'escopo conhecimento.analise_ia_transcricoes. Substitui o boolean solto de '
  'configuracoes (0032) — corrige achado MÉDIO do pentest (sem auditoria de '
  'quem/quando/base legal). Ver 0048.';

-- A chave antiga de `configuracoes` fica no banco (histórico — não é
-- destrutivo apagar/alterar dado de outra tabela numa migration aditiva) mas
-- passa a ser DECORATIVA: nenhum código (TS ou trigger) a lê mais depois
-- desta migration. Descrição atualizada para não confundir quem olhar a
-- tabela depois e achar que ainda é a trava vigente.
update configuracoes
   set descricao = 'OBSOLETA desde 0048 — não é mais lida por nenhum trigger '
     || 'nem rota. A trava de BLOQUEIO B13 agora é decisoes_juridicas '
     || '(escopo conhecimento.analise_ia_transcricoes). Mantida só como '
     || 'histórico; não editar esperando efeito.'
 where chave = 'conhecimento.analise_ia_habilitada';

-- ===========================================================================
-- VERIFICAÇÃO — rodar depois de aplicar, prova que a trava bloqueia sem
-- decisão ativa e libera com uma:
--
--   -- 1. sem decisão nenhuma, insert tem que falhar:
--   insert into analises_transcricao (transcricao_id, versao, conteudo)
--     values ('00000000-0000-0000-0000-000000000000', 1, '{}'::jsonb);
--   -- esperado: ERROR analise_ia_de_transcricao_bloqueada
--
--   -- 2. registra decisão de teste (rode como admin/advogada autenticado):
--   insert into decisoes_juridicas
--     (escopo, descricao, base_legal, subprocessador, decidido_por)
--   values (
--     'conhecimento.analise_ia_transcricoes',
--     'teste de verificacao - revogar depois',
--     'teste', 'teste',
--     (select id from perfis_equipe where papel in ('admin','advogada') limit 1)
--   );
--   -- 3. mesmo insert de (1) agora só falha por FK/coluna, não pela trava;
--   -- 4. revogar e confirmar que volta a bloquear:
--   update decisoes_juridicas set revogada_em = now(),
--     revogada_por = (select id from perfis_equipe limit 1)
--    where escopo = 'conhecimento.analise_ia_transcricoes' and revogada_em is null;
-- ===========================================================================
