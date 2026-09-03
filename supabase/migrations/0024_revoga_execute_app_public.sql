-- 0024_revoga_execute_app_public.sql
-- BAIXO (pentest): só ~6 das ~20 funções do schema `app` tinham EXECUTE
-- revogado de PUBLIC. Postgres concede EXECUTE a PUBLIC em todo CREATE
-- FUNCTION por padrão — hoje não é explorável (PostgREST não expõe o schema
-- `app`, só `public`, via "Exposed schemas"), mas a proteção real hoje é essa
-- configuração de painel, não o banco. Fecha na origem: revoga de PUBLIC e
-- ANON tanto as funções já existentes quanto as futuras (`alter default
-- privileges`), e reconcede explicitamente só o que `authenticated` precisa —
-- as 4 funções de papel são chamadas de DENTRO das policies (RLS) e ficam
-- quebradas (500 em toda rota) se ficarem sem EXECUTE, como já aconteceu e foi
-- corrigido em 0018.

alter default privileges in schema app revoke execute on functions from public;
revoke execute on all functions in schema app from public, anon;

-- Funções de papel: chamadas de dentro de toda policy RLS deste projeto.
-- Precisam continuar executáveis por `authenticated` (já eram concedidas em
-- 0001/0002 — reafirmamos aqui para deixar explícito e à prova de reset).
grant execute on function app.papel()       to authenticated;
grant execute on function app.eh_interno()  to authenticated;
grant execute on function app.ve_patrimonio() to authenticated;
grant execute on function app.eh_admin()    to authenticated;
grant execute on function app.vincular_perfil() to authenticated;

-- ATENÇÃO — achado testando esta própria migration (não fazer o revoke cego):
-- `app.registrar_evento_timeline` (0014) é chamada via `perform` de dentro de
-- app.timeline_jornada/formulario/ligacao/patrimonio/familiar/agendamento/
-- relatorio/croqui/documento — NENHUMA dessas é SECURITY DEFINER, e TODAS
-- disparam em UPDATE/INSERT feito por `authenticated` de verdade (PATCH
-- jornadas/etapa, POST familiares, POST agendamentos, etc.), nunca só via
-- service_role. O código de 0014 é explícito: "Não precisamos de SECURITY
-- DEFINER aqui — a policy tl_ins já libera qualquer eh_interno()" — ou seja, a
-- função sempre dependeu do GRANT padrão de PUBLIC que o `revoke... from
-- public, anon` acima acabou de remover. Sem este GRANT explícito, o blanket
-- revoke quebraria a timeline inteira (e a transação inteira junto, por ela
-- rodar em trigger AFTER) na primeira escrita de um usuário real — a mesma
-- classe de bug do BUG P0 corrigido em 0020, desta vez introduzida por esta
-- migration se este GRANT não existisse.
--
-- `service_role` também precisa: `POST /api/documentos` (upload) insere em
-- `documentos` usando o cliente admin (`criarClienteAdmin()`), então
-- `trg_timeline_documento` — também não SECURITY DEFINER — dispara com
-- current_role = service_role, não authenticated.
grant execute on function app.registrar_evento_timeline(uuid, text, text, text, jsonb) to authenticated, service_role;

-- `app.tem_consentimento` NÃO entra na lista: nenhuma policy/trigger a chama
-- hoje (a camada de IA replica a lógica em TS consultando a tabela direto —
-- ver comentário em src/server/ia/consentimento.ts). Sem uso, sem GRANT —
-- least privilege. Se um dia virar RPC de servidor, conceder ali.
--
-- O restante das funções de `app` (triggers puros como app.set_atualizado_em,
-- app.valida_transicao_jornada, app.atualiza_nivel_pago, e os app.timeline_*)
-- não precisa de GRANT: são só DESTINO de `create trigger` — o disparo de um
-- trigger não checa EXECUTE de quem fez o DML, só CHAMADAS ANINHADAS feitas de
-- dentro do corpo da função checam (foi exatamente essa distinção que causou o
-- BUG P0 de 0020 e quase causou uma regressão aqui). `app.enfileirar_mensagem`,
-- `app.registra_transicao_jornada` e `app.regua_boas_vindas` também não
-- precisam: as duas primeiras já são SECURITY DEFINER (owner bypassa GRANT); a
-- terceira só dispara dentro da cadeia SECURITY DEFINER do webhook Hotmart
-- (`pagamentos` não tem policy de INSERT/UPDATE para `authenticated`).
