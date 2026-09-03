-- 0001_extensoes_enums_helpers.sql
-- Extensões, enums, schema app e funções de papel usadas por toda RLS do projeto.

-- Funcoes de papel referenciam perfis_equipe (criada em 0002). Sem isto, o Postgres
-- valida o corpo da funcao SQL no create e falha com 42P01.
set check_function_bodies = off;

create extension if not exists pgcrypto;   -- gen_random_uuid
create extension if not exists btree_gist; -- exclusion constraint de agenda (0008)
create extension if not exists unaccent;   -- busca por nome sem acento

create schema if not exists app;

-- Config de busca textual que ja remove acento no proprio dicionario.
-- unaccent(text) e STABLE e nao pode entrar em indice; to_tsvector(regconfig,text) e IMMUTABLE.
create text search configuration pt_unaccent (copy = portuguese);
alter text search configuration pt_unaccent
  alter mapping for hword, hword_part, word with unaccent, portuguese_stem;

create type papel_equipe as enum ('admin','advogada','relacionamento','assistente');
create type etapa_jornada as enum (
  'captado','qualificado','sessao_contratada','sessao_agendada',
  'sessao_realizada','croqui_contratado','croqui_apresentado','holding_contratada');
create type desfecho_jornada as enum ('aberta','ganha','perdida','descartada','congelada');
create type trilha_jornada  as enum ('seminario','preliminar'); -- POP 03 vs POP 03-B
create type origem_lead     as enum ('seminario','indicacao','organico','trafego_pago','outro');
create type produto_tipo    as enum ('sessao_viabilidade','croqui_estrutural','holding');
create type status_pagamento as enum ('pendente','em_analise','aprovado','cancelado','estornado','reembolsado');
create type tipo_bem        as enum ('imovel','veiculo','investimento','previdencia','empresa','outro');
create type status_agendamento as enum ('agendado','confirmado','realizado','nao_compareceu','cancelado','remarcado');
create type canal_mensagem  as enum ('email','whatsapp');
create type status_mensagem as enum ('pendente','enviando','enviada','falhou','cancelada');
create type status_execucao_ia as enum ('pendente','executando','concluida','falhou');
create type status_croqui   as enum ('rascunho','pronto','apresentado');
create type tipo_consentimento as enum (
  'gravacao_sessao','tratamento_ia','comunicacao_email','comunicacao_whatsapp','pesquisa_fontes_publicas');

-- NOTA: papel do usuário logado. SECURITY DEFINER + search_path fixo é obrigatório:
-- sem SET search_path a função é sequestrável por schema no path do chamador.
create or replace function app.papel() returns papel_equipe
language sql stable security definer set search_path = public, pg_temp as $$
  select p.papel from public.perfis_equipe p
   where p.auth_user_id = auth.uid() and p.ativo limit 1
$$;

create or replace function app.eh_interno() returns boolean
language sql stable as $$ select app.papel() is not null $$;

-- Quem enxerga VALOR de patrimônio, IR e contrato social. Só estes dois papéis.
create or replace function app.ve_patrimonio() returns boolean
language sql stable as $$ select app.papel() in ('admin','advogada') $$;

create or replace function app.eh_admin() returns boolean
language sql stable as $$ select app.papel() = 'admin' $$;

revoke execute on function app.papel() from public, anon;
grant  execute on function app.papel(), app.eh_interno(), app.ve_patrimonio(), app.eh_admin() to authenticated;

create or replace function app.set_atualizado_em() returns trigger
language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
