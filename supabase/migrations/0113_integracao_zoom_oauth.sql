-- 0113_integracao_zoom_oauth.sql
-- Bot autenticado no Zoom (token ZAK) — pedido do João, 17/09/2026. A conta
-- Zoom da Dra. Elaine exige "Somente usuários autenticados" e trava o admin
-- da conta (não dá para desligar); a solução oficial da Recall
-- (docs.recall.ai/docs/zoom-signed-in-bots, lida via WebFetch nesta rodada
-- — não suposta) é: um app OAuth do Zoom autoriza uma vez, a Recall guarda o
-- refresh token (evita nós guardarmos), e ao criar o bot mandamos
-- `zoom.zak_url` — uma URL NOSSA que devolve o ZAK em texto puro, chamada
-- pela Recall inclusive DURANTE a reunião (o token expira rápido).
--
-- 100% ADITIVA. Nenhuma tabela, coluna ou policy existente é alterada.
--
-- O QUE ENTRA
--   integracoes_zoom — SINGLETON (1 linha só, id fixo), guarda o
--   `recall_credential_id` devolvido por `POST /api/v2/zoom-oauth-credentials/`
--   da Recall. NUNCA guarda o `code`/access_token/refresh_token do Zoom em
--   si — só o id OPACO da credencial na Recall (é exatamente o que o
--   caminho recomendado da doc evita: nós guardarmos segredo do Zoom).
--
-- POR QUE NÃO EM `configuracoes` (0027): aquela tabela nega INSERT/DELETE de
-- propósito e é para PARÂMETRO EDITÁVEL PELO ADMIN (teto, interruptor,
-- enum). Isto aqui é ESTADO TÉCNICO gravado pelo PRÓPRIO SERVIDOR no
-- callback OAuth — mesma categoria de `sessoes_copiloto.gravacao_externa_id`
-- (0091): id opaco de um fornecedor, nunca editado pela tela.
--
-- RLS/GRANT: só `app.eh_admin()` — é credencial de acesso à conta Zoom da
-- Dra. Elaine, mais restrita que `app.ve_patrimonio()` (que cobre
-- admin+advogada). `service_role` não dispensa RLS nem GRANT (regra da
-- casa): revoke amplo + grants nomeados.
--
-- ROTEIRO DE VERIFICAÇÃO: `scripts/verificacao-0113.sql`.
--
-- ROLLBACK:
--   drop table if exists integracoes_zoom;
-- ===========================================================================

create table integracoes_zoom (
  -- Singleton: só a linha id=1 pode existir (CHECK, não é convenção de
  -- aplicação) — só há uma conta Zoom autorizada (apoio@csmholding.com.br).
  id                    int primary key default 1 check (id = 1),

  -- Id OPACO devolvido pela Recall ao trocar o `code` do Zoom por credencial
  -- (`POST /api/v2/zoom-oauth-credentials/`). NUNCA o token do Zoom em si.
  recall_credential_id  text,

  -- E-mail da conta que autorizou, só para auditoria/tela — não é usado em
  -- nenhuma chamada (a Recall já sabe qual credencial é qual pelo id acima).
  autorizado_por_email  text,
  autorizado_em         timestamptz,

  atualizado_em         timestamptz not null default now()
);

comment on table integracoes_zoom is
  'Singleton (id=1). Guarda só o id OPACO da credencial OAuth do Zoom na '
  'Recall — nunca o code/access_token/refresh_token do Zoom. Gravado pelo '
  'callback OAuth (server, service_role), nunca editável pela tela.';
comment on column integracoes_zoom.recall_credential_id is
  'Id devolvido por POST /api/v2/zoom-oauth-credentials/ na Recall. NULL = '
  'conta Zoom ainda não autorizada; pedir bot em sala Zoom sem isto tem de '
  'devolver erro específico ("a conta Zoom ainda não foi autorizada"), não '
  'genérico.';

create trigger trg_integracoes_zoom_atualizado_em
  before update on integracoes_zoom
  for each row execute function app.set_atualizado_em();

alter table integracoes_zoom enable row level security;
alter table integracoes_zoom force row level security;

revoke all on integracoes_zoom from public, anon, authenticated;

-- Só admin lê (a tela de Admin → Integrações mostra "autorizado"/"não
-- autorizado" e o e-mail, nunca o credential_id em si — mas a policy é por
-- LINHA, não por coluna; a tela decide o que exibir). Escrita só
-- service_role: o callback OAuth roda com `criarClienteAdmin()` (o usuário
-- que autoriza no Zoom pode nem ter perfil nesta aplicação).
create policy iz_sel on integracoes_zoom for select to authenticated
  using ((select app.eh_admin()));
grant select on integracoes_zoom to authenticated;
grant select, insert, update on integracoes_zoom to service_role;
