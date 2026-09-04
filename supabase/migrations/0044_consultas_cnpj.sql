-- 0044_consultas_cnpj.sql
-- Fase 3, ONDA 1, agente B (backend-cnpj) — docs/ARQUITETURA-FASE-3.md §4
-- (Dossiê público / consulta de CNPJ). Leia o §4 inteiro antes de tocar aqui.
--
-- O BLOQUEIO B4 (docs/ARQUITETURA.md) NÃO é reaberto por este arquivo: B4 é
-- sobre dado JUDICIAL e pesquisa sobre PESSOA FÍSICA (0036_pesquisas_publicas,
-- trava de consentimento). Isto aqui é dado CADASTRAL DE EMPRESA, público por
-- definição legal (Receita Federal), obtido de API oficial gratuita
-- (BrasilAPI — https://brasilapi.com.br/api/cnpj/v1/{cnpj}, sem chave). O
-- único ponto de contato com B4 é o `qsa` (quadro societário), que nomeia
-- pessoa física de terceiro — ver BLOQUEIO B21 (§9 do plano) e a RLS abaixo.
--
-- O QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO:
--   - Não faz nenhuma chamada de rede. Isto é DDL puro; o cliente HTTP da
--     BrasilAPI vive em `src/server/cnpj/**` (código de aplicação), nunca em
--     `pg_net`/extensão de rede do Postgres.
--   - Não é chave de pessoa: `consultas_cnpj` é um cache GLOBAL por CNPJ, não
--     por jornada/cliente — a mesma empresa pode aparecer no dossiê de mais
--     de um núcleo familiar (ex.: holding com sócios em comum) e não faz
--     sentido duplicar o cadastro. A rastreabilidade de "quem pediu, para
--     qual cliente" fica no evento gravado em `eventos_timeline` (aplicação),
--     não nesta tabela.
--   - Não cria coluna nova em `patrimonio_itens` — o vínculo é
--     `patrimonio_itens.detalhes->>'cnpj'`, que já é `jsonb` desde a 0007.

create table consultas_cnpj (
  -- Só dígitos, normalizado ANTES de chegar ao banco (a aplicação já valida
  -- `^[0-9]{14}$` antes de compor a URL — ver src/server/cnpj/normalizar.ts).
  -- O CHECK abaixo é defesa em profundidade: mesmo um INSERT feito fora da
  -- rota (SQL direto, script) não pode gravar um CNPJ mal formado.
  cnpj              char(14) primary key check (cnpj ~ '^[0-9]{14}$'),

  razao_social      text,
  nome_fantasia     text,
  situacao          text,                          -- descricao_situacao_cadastral
  data_situacao     date,                           -- data_situacao_cadastral
  capital_social    numeric(15,2) check (capital_social is null or capital_social >= 0),
  cnae_principal    text,                           -- cnae_fiscal (código)
  cnae_descricao    text,
  data_abertura     date,                           -- data_inicio_atividade
  municipio         text,
  uf                char(2),

  -- Quadro societário — PII de pessoa física de terceiro. BLOQUEIO B21: sob
  -- o mesmo recorte de `ve_patrimonio()` da tabela inteira, nunca superfície
  -- pública, nunca link público, nunca fora do gate `tratamento_ia` para IA.
  -- Reversão pontual (sem migration): `update consultas_cnpj set qsa = '[]'`.
  qsa               jsonb not null default '[]'::jsonb,

  -- Payload cru da BrasilAPI no momento da última consulta bem-sucedida —
  -- permite reprocessar/depurar sem nova chamada de rede. Default '{}' (não
  -- "not null" sem default) porque uma linha pode nascer de uma FALHA (ver
  -- comentário de falha_em abaixo), e nesse caso não existe payload nenhum
  -- para guardar.
  bruto             jsonb not null default '{}'::jsonb,
  fonte             text not null default 'brasilapi' check (fonte = 'brasilapi'),

  -- Timestamp da ÚLTIMA CONSULTA BEM-SUCEDIDA (não do INSERT da linha — uma
  -- falha nunca move este campo). É o que a tela usa para "consultado em
  -- DD/MM" e para o cálculo de frescor (`configuracoes['cnpj.validade_dias']`).
  consultado_em     timestamptz,
  consultado_por    uuid references perfis_equipe(id),

  -- Última tentativa que FALHOU (API fora do ar, timeout, CNPJ inexistente na
  -- Receita, resposta em formato inesperado). Existe para a tela poder dizer
  -- "não conseguimos consultar desde DD/MM" SEM apagar o dado bom que já
  -- estava aqui — e sem nunca fabricar dado: enquanto só `falha_em` estiver
  -- preenchido (linha nova, nenhuma consulta bem-sucedida ainda),
  -- `razao_social`/`qsa`/etc. permanecem null/vazio, e é isso — carimbado
  -- como "nunca consultado com sucesso", nunca como "empresa sem sócios".
  falha_em          timestamptz,
  falha_motivo      text,

  -- Regra do projeto (mesmo padrão de `pesquisas_publicas`): toda linha real
  -- é 'real'; 'exemplo' fica reservado para seed de demo, se algum dia
  -- existir (hoje não há seed desta tabela).
  origem_dado       text not null default 'real' check (origem_dado in ('real', 'exemplo')),

  -- Ao menos um dos dois carimbos precisa existir: uma linha não pode nascer
  -- sem ter sido, no mínimo, uma tentativa (sucesso OU falha registrada).
  constraint consultas_cnpj_tem_tentativa check (consultado_em is not null or falha_em is not null)
);

create index idx_consultas_cnpj_frescor on consultas_cnpj (consultado_em desc);

comment on table consultas_cnpj is
  'Fase 3 §4 — cache de consulta pública de CNPJ (BrasilAPI). Cache GLOBAL por '
  'CNPJ, não por jornada. RLS no recorte de app.ve_patrimonio() (mesmo de '
  'patrimonio_itens): o qsa nomeia sócio pessoa física de terceiro (BLOQUEIO '
  'B21). falha_em/falha_motivo registram a última tentativa que falhou sem '
  'jamais sobrescrever dado bom já obtido — falha nunca vira dado.';
comment on column consultas_cnpj.qsa is
  'Quadro societário cru da BrasilAPI (array de sócios com nome). PII de '
  'pessoa física de terceiro — BLOQUEIO B21. Só entra em prompt de IA sob o '
  'gate tratamento_ia (mesmo gate de transcrições). Nunca em superfície '
  'pública nem link público.';
comment on column consultas_cnpj.consultado_em is
  'Timestamp da ÚLTIMA CONSULTA BEM-SUCEDIDA. Uma falha NUNCA move este '
  'campo — é o que permite mostrar o dado antigo "consultado em DD/MM" '
  'mesmo com uma tentativa mais recente falha (ver falha_em).';
comment on column consultas_cnpj.falha_em is
  'Última tentativa que FALHOU (API fora do ar, timeout, CNPJ inexistente, '
  'formato inesperado). Não apaga dado bom anterior. Se é a única marca de '
  'tempo da linha (consultado_em ainda null), significa "nunca consultado '
  'com sucesso" — a tela deve mostrar erro, nunca "sem sócios"/"sem dados".';

-- ---------------------------------------------------------------------------
-- configuracoes['cnpj.validade_dias'] — frescor do cache (§4.3 do plano).
-- Inserção defensiva com ON CONFLICT DO NOTHING: a 0042 (agente A,
-- backend-ia, dono de outra fronteira) também está listada no plano como
-- inseridora desta MESMA chave (§7 do plano). Este INSERT garante que a
-- feature de CNPJ funciona sozinha mesmo se a 0042 nunca for aplicada ou for
-- aplicada depois — e não conflita se a 0042 chegar primeiro.
-- ---------------------------------------------------------------------------
insert into configuracoes (chave, valor, descricao) values
  ('cnpj.validade_dias', '30'::jsonb,
   'VALOR INICIAL, não vem do método (BLOQUEIO B21/§4.3 Fase 3). Dias até o '
   'cache de consulta de CNPJ ser considerado desatualizado e a tela '
   'oferecer "atualizar". Ajustável em Admin, sem deploy.')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- RLS — mesmo recorte de quem vê patrimônio (`app.ve_patrimonio()`): dado
-- cadastral de empresa é regra geral (`app.eh_interno()` bastaria), mas o
-- `qsa` nomeia pessoa física de terceiro na MESMA tabela — não há como
-- separar coluna por policy de RLS do Postgres, então a tabela inteira
-- herda a sensibilidade da coluna mais sensível que carrega (mesmo raciocínio
-- de `patrimonio_itens`/`pesquisas_publicas`).
--
-- Sem policy de DELETE, de propósito: é cache/registro de consulta, não dado
-- operacional do dia a dia — corrigir/atualizar é UPDATE (nova consulta),
-- nunca apagar o histórico de que uma consulta foi feita.
-- ---------------------------------------------------------------------------
alter table consultas_cnpj enable row level security;
alter table consultas_cnpj force row level security;

create policy cnpj_sel on consultas_cnpj for select to authenticated
  using ((select app.ve_patrimonio()));
create policy cnpj_ins on consultas_cnpj for insert to authenticated
  with check ((select app.ve_patrimonio()));
create policy cnpj_upd on consultas_cnpj for update to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));

-- ---------------------------------------------------------------------------
-- Evento de timeline da consulta — `consultas_cnpj` é cache GLOBAL por CNPJ
-- (sem jornada_id, ver cabeçalho), então não dá para ligar um trigger comum
-- na própria tabela como a 0014 fez para `patrimonio_itens`/`familiares` (o
-- trigger não teria de onde tirar o jornada_id). O jornada_id só existe no
-- contexto da REQUISIÇÃO (§4.4.5: "consulta a fonte externa sobre cliente é
-- ato auditável" — o cliente é quem está sendo atendido na jornada, não uma
-- propriedade do CNPJ). Por isso o evento é disparado pela aplicação, não
-- por trigger de banco — via este wrapper fino em `public`.
--
-- NOTA (PostgREST, mesmo motivo de `public.vincular_perfil`, 0002): o schema
-- `app` não é exposto por padrão para `.rpc()` do supabase-js (só `public`
-- é exposto sem mudar "Exposed schemas" no painel, que este agente não tem
-- como aplicar). `security invoker` de propósito: quem chama precisa passar
-- pela mesma policy `tl_ins` (`app.eh_interno()`) de sempre — nenhum
-- privilégio novo é concedido por este wrapper.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_evento_consulta_cnpj(
  p_jornada_id uuid, p_titulo text, p_descricao text, p_dados jsonb
) returns void
language sql security invoker set search_path = public, pg_temp as $$
  select app.registrar_evento_timeline(p_jornada_id, 'patrimonio', p_titulo, p_descricao, p_dados)
$$;

revoke execute on function public.registrar_evento_consulta_cnpj(uuid, text, text, jsonb) from public, anon;
grant  execute on function public.registrar_evento_consulta_cnpj(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Verificação esperada após aplicar:
--   select polname, polcmd from pg_policy where polrelid = 'consultas_cnpj'::regclass;
--     -- 'cnpj_sel' (r), 'cnpj_ins' (a), 'cnpj_upd' (w) -- nenhum 'd' (delete)
--   insert into consultas_cnpj (cnpj) values ('123');
--     -- ERROR: new row for relation "consultas_cnpj" violates check constraint
--     -- (char(14) preenche '123' com espaços à direita; a regex exige 14 dígitos)
--   insert into consultas_cnpj (cnpj, falha_em, falha_motivo)
--     values ('11222333000181', now(), 'timeout: sem resposta em 10s');
--     -- OK: linha só de falha, sem nenhum dado fabricado (razao_social etc. permanecem null)
--   select valor from configuracoes where chave = 'cnpj.validade_dias'; -- 30
--   select public.registrar_evento_consulta_cnpj('<jornada existente>', 'teste', null, '{}'::jsonb);
--     -- OK, gera 1 linha em eventos_timeline tipo 'patrimonio'
--   select public.registrar_evento_consulta_cnpj('00000000-0000-0000-0000-000000000000', 'teste', null, '{}'::jsonb);
--     -- ERROR: insert or update on table "eventos_timeline" violates foreign key constraint (jornada inexistente)
-- ---------------------------------------------------------------------------
