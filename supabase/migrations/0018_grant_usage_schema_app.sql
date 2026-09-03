-- 0018_grant_usage_schema_app.sql
-- Sem USAGE no schema `app`, TODA policy que chama app.eh_interno()/ve_patrimonio()
-- falha com 42501 "permission denied for schema app" e o sistema inteiro responde 500.
-- Grant de EXECUTE na funcao nao basta: o role precisa poder ENTRAR no schema.
-- Achado em teste real no navegador (todas as rotas em 500), nao no build.
grant usage on schema app to authenticated, service_role;

-- `anon` continua SEM usage: quem nao esta logado nao resolve nem o nome da funcao.
revoke usage on schema app from anon;
