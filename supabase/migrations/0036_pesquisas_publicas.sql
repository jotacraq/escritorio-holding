-- 0036_pesquisas_publicas.sql
-- B-4B (Fase 2, ONDA 4) — arcabouço de PESQUISA EM FONTE PÚBLICA
-- (docs/ARQUITETURA-FASE-2.md §4.6, linha B-4B da §5; docs/ARQUITETURA.md
-- BLOQUEIO B4; backlog G16). Leia os três antes de tocar neste arquivo.
--
-- O QUE O JOÃO PEDIU: "informações públicas na internet... domínios públicos
-- como o JusBrasil... capturar muitas informações relevantes". O arquiteto
-- bloqueou a PARTE DE COLETA, com razão dupla: (1) uma advogada tratando dado
-- judicial de cliente sem base legal definida é exposição séria — do
-- escritório e do cliente (LGPD); (2) o JusBrasil não tem API pública
-- contratada — raspar tem risco de termos de uso e, em cima disso, ainda
-- herdaria o mesmo problema (1).
--
-- O QUE ESTE ARQUIVO ENTREGA: só a mesa onde a EQUIPE anota, à mão, o que
-- pesquisou por fora do sistema — fonte, link, o que achou, e a base legal
-- que ela própria declara ter usado para pesquisar. Trava de consentimento no
-- BANCO, no mesmo padrão de `app.exige_flag_analise_ia_habilitada` (0032,
-- BLOQUEIO B13): nem `service_role` contorna, porque é um BEFORE INSERT
-- trigger — trigger dispara pelo evento de DML, não pela policy de RLS (RLS
-- é o que `service_role`, com BYPASSRLS, ignora; trigger, não).
--
-- O QUE ESTE ARQUIVO **NÃO** FAZ, DE PROPÓSITO — leia antes de "melhorar":
--   - ZERO scraping. ZERO cliente HTTP para JusBrasil ou qualquer site de
--     terceiro. Não existe, neste commit, nenhum arquivo em
--     `src/server/**`/`src/app/api/**` que faça `fetch()`/requisição de rede
--     para um domínio de terceiro em nome desta feature.
--   - ZERO agendamento de coleta. Sem cron, sem fila, sem job — `criado_em`
--     é só o timestamp do INSERT manual, não o disparo de nada.
--   - ZERO leitura automática por IA: `entra_no_briefing` (abaixo) fica preso
--     em `false` por CHECK de banco — não é UI que "esquece" de expor o
--     botão, é impossível a coluna virar `true` nesta fase, mesmo por UPDATE
--     direto. A allowlist do contexto de IA (`src/server/ia/**`) não é
--     tocada por este arquivo.
--   - ZERO API de consulta a fonte pública. As únicas rotas desta entrega
--     (`src/app/api/pesquisas-publicas/**`) LEEM e ESCREVEM esta tabela —
--     nenhuma delas chama para fora.
--
-- Quando a decisão jurídica vier (base legal fixada, eventual contrato de API
-- com o JusBrasil), ligar a automação é `UPDATE` em `configuracoes` + uma
-- integração nova — e não vai existir NENHUM dado coletado indevidamente para
-- desfazer, porque nunca houve coleta. O caminho contrário (raspar primeiro,
-- perguntar depois) cria passivo que não se apaga.

-- ---------------------------------------------------------------------------
-- pesquisas_publicas — uma linha por consulta que um humano da equipe fez,
-- por fora do sistema, e decidiu registrar aqui.
-- ---------------------------------------------------------------------------
create table pesquisas_publicas (
  id                uuid primary key default gen_random_uuid(),

  jornada_id        uuid not null references jornadas(id) on delete cascade,
  -- Redundante com `jornadas.pessoa_id` de propósito (mesmo padrão de
  -- `v_link.jornada_id` -> pessoa_id em 0028): permite indexar/filtrar por
  -- pessoa direto, sem join, e é o campo que a trava de consentimento abaixo
  -- usa. A trigger `trg_pesq_consistencia` (mais abaixo) impede o par
  -- (jornada_id, pessoa_id) discordar do dono real da jornada — não dá pra
  -- inserir pesquisa de uma pessoa "emprestando" a jornada de outra.
  pessoa_id         uuid not null references pessoas(id) on delete restrict,

  -- Digitado, sem lista fechada e sem integração — "JusBrasil", "Google",
  -- "Diário Oficial", o que a pessoa escrever. Fechar isto num enum hoje
  -- criaria a falsa impressão de que existe um conjunto de fontes homologado;
  -- não existe (BLOQUEIO B4).
  fonte             text not null check (length(trim(fonte)) between 1 and 200),
  -- Link para a própria equipe conferir depois — nunca é buscado pelo
  -- servidor (ver cabeçalho: zero cliente HTTP para terceiro). O check é só
  -- higiene de dado (evita `javascript:`/lixo se um dia isto virar link
  -- clicável em tela), não validação de alcançabilidade.
  url               text check (url is null or url ~* '^https?://'),
  -- Quando a consulta foi feita (não quando foi digitada no sistema — a
  -- equipe pode registrar um pouco depois). Não pode ser no futuro (folga de
  -- 1 minuto por deriva de relógio de cliente).
  consultado_em     timestamptz not null default now()
                       check (consultado_em <= now() + interval '1 minute'),
  -- Quem pesquisou. SEMPRE preenchido pelo servidor a partir da sessão
  -- (nunca aceito no corpo da requisição) — mesmo cuidado de
  -- `documentos.enviado_por`/`ligacoes_estrategicas.colaborador_id`: quem
  -- assina o registro não é informação que o cliente possa forjar.
  consultado_por    uuid not null references perfis_equipe(id),

  -- Obrigatório: quem registra DECLARA a base legal que amparou a consulta
  -- (ex.: "legítimo interesse pré-contratual, Art. 7º VI/IX LGPD" ou
  -- "consentimento do titular, ver consentimentos.id X"). Texto livre — não é
  -- o sistema que valida se a base legal é boa, é a advogada quem responde
  -- por isso. O sistema só garante que ALGUMA base foi declarada.
  base_legal        text not null check (length(trim(base_legal)) between 5 and 2000),
  resumo            text not null check (length(trim(resumo)) between 1 and 10000),

  -- Trava adicional de banco (ver cabeçalho): mesmo que uma tela futura tente
  -- gravar `true`, o CHECK abaixo recusa. Destravar isto é ALTER TABLE de uma
  -- migration nova, no dia em que existir decisão jurídica registrada — nunca
  -- um valor aceito de request. Nenhuma allowlist de prompt lê esta coluna
  -- hoje (grep: nenhuma referência em `src/server/ia/**`).
  entra_no_briefing boolean not null default false check (entra_no_briefing = false),

  origem_dado       text not null default 'real' check (origem_dado in ('real', 'exemplo')),
  criado_em         timestamptz not null default now()
);

create index idx_pesquisas_publicas_jornada on pesquisas_publicas (jornada_id, consultado_em desc);
create index idx_pesquisas_publicas_pessoa  on pesquisas_publicas (pessoa_id);

comment on table pesquisas_publicas is
  'BLOQUEIO B4/B-4B — registro MANUAL do que a equipe pesquisou por fora, em '
  'fonte pública (ex.: JusBrasil). Zero coleta automatizada: sem scraping, '
  'sem cliente HTTP para terceiro, sem job/cron/fila neste módulo. Toda '
  'linha exige consentimento vigente do tipo pesquisa_fontes_publicas '
  '(trigger trg_pesq_consentimento) — nem service_role contorna. '
  'entra_no_briefing é travado em false por CHECK; ligar depende de decisão '
  'jurídica registrada, não de UPDATE de rotina.';
comment on column pesquisas_publicas.base_legal is
  'Declaração da equipe, texto livre. O sistema garante que existe declaração, '
  'não que ela é juridicamente suficiente — isso é responsabilidade de quem '
  'assina (consultado_por).';
comment on column pesquisas_publicas.entra_no_briefing is
  'Travado em false por CHECK (entra_no_briefing = false). Destravar exige '
  'migration nova no dia da decisão jurídica — ver BLOQUEIO B4.';

-- ---------------------------------------------------------------------------
-- Trigger única: (a) consistência pessoa<->jornada, (b) trava de
-- consentimento. BEFORE INSERT — não existe UPDATE/DELETE possível para
-- `authenticated` nesta tabela (ver policies abaixo), então não precisa
-- cobrir esses eventos.
-- ---------------------------------------------------------------------------
create or replace function app.exige_consentimento_pesquisa() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_dono_jornada uuid;
begin
  select pessoa_id into v_dono_jornada from jornadas where id = new.jornada_id;
  if v_dono_jornada is null then
    raise exception 'jornada_nao_encontrada: jornada_id % não existe', new.jornada_id
      using errcode = 'P0002';
  end if;
  if v_dono_jornada is distinct from new.pessoa_id then
    raise exception 'pessoa_jornada_incompativel: pessoa_id % não é o dono da jornada %',
      new.pessoa_id, new.jornada_id
      using errcode = '23514';
  end if;

  -- BLOQUEIO B4: sem consentimento vigente do tipo pesquisa_fontes_publicas
  -- (`app.tem_consentimento`, 0005), nenhuma linha entra — nem por
  -- service_role (trigger, não RLS). `pesquisa_fontes_publicas` já existe no
  -- enum `tipo_consentimento` desde a 0005.
  if not app.tem_consentimento(new.pessoa_id, 'pesquisa_fontes_publicas') then
    raise exception 'sem_consentimento_pesquisa_fontes_publicas: pessoa % sem consentimento vigente do tipo pesquisa_fontes_publicas — registre o consentimento antes de pesquisar', new.pessoa_id
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger trg_pesq_consentimento before insert on pesquisas_publicas
for each row execute function app.exige_consentimento_pesquisa();

comment on function app.exige_consentimento_pesquisa() is
  'Trava de BANCO do BLOQUEIO B4: confere que pessoa_id é dona de jornada_id e '
  'que existe consentimento vigente pesquisa_fontes_publicas antes de aceitar '
  'INSERT em pesquisas_publicas. Dispara em BEFORE INSERT — não depende de '
  'RLS, então service_role (BYPASSRLS) não contorna.';

-- `app.tem_consentimento` (0005) não tinha GRANT para ninguém além do dono —
-- 0024 registrou explicitamente "sem uso, sem GRANT" e disse "se um dia virar
-- RPC de servidor, conceder ali". Este é esse dia: a chamada aninhada dentro
-- do corpo da trigger acima é checada contra o EXECUTE de quem fez o INSERT
-- (mesma observação de 0028 sobre `app.registrar_evento_timeline`) — sem este
-- GRANT, todo INSERT em pesquisas_publicas quebraria com "permission denied
-- for function tem_consentimento", authenticated e service_role igual.
grant execute on function app.tem_consentimento(uuid, tipo_consentimento) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS — mesmo recorte de quem vê patrimônio (`app.ve_patrimonio()`): é dado
-- de investigação sobre a vida financeira/judicial do cliente, mesma
-- sensibilidade de `transcricoes`/`patrimonio_itens`. INSERT também no mesmo
-- recorte: quem registra a pesquisa é a própria advogada/admin pela tela —
-- não existe rota de service_role para isto (contraste com `documentos`,
-- cujo upload passa por processamento de arquivo no servidor).
--
-- Sem policy de UPDATE/DELETE para `authenticated`, de propósito: é registro
-- de auditoria de consulta (mesmo espírito de `documentos_acessos` e de
-- `consentimentos`, que também não permitem reescrever o passado) — corrigir
-- um erro de digitação é uma linha nova, não editar a antiga.
-- ---------------------------------------------------------------------------
alter table pesquisas_publicas enable row level security;
alter table pesquisas_publicas force row level security;

create policy pp_sel on pesquisas_publicas for select to authenticated
  using ((select app.ve_patrimonio()));
create policy pp_ins on pesquisas_publicas for insert to authenticated
  with check ((select app.ve_patrimonio()));

-- ---------------------------------------------------------------------------
-- Verificação esperada após aplicar:
--   select polname, polcmd from pg_policy where polrelid = 'pesquisas_publicas'::regclass;
--     -- só 'pp_sel' (r) e 'pp_ins' (a=insert) -- nenhum 'w' (update) nem 'd' (delete)
--   insert into pesquisas_publicas (jornada_id, pessoa_id, fonte, base_legal, resumo)
--     values ('<jornada sem consentimento>', '<pessoa>', 'JusBrasil', 'legitimo interesse', 'teste');
--     -- ERROR: sem_consentimento_pesquisa_fontes_publicas (mesmo com service_role)
--   update pesquisas_publicas set entra_no_briefing = true where id = '<qualquer>';
--     -- (via service_role — authenticated nem tem policy de UPDATE)
--     -- ERROR: new row for relation "pesquisas_publicas" violates check constraint
-- ---------------------------------------------------------------------------
