-- 0019_marcar_mensagem_manual.sql
-- ALTO 1 (pentest, reproduzido ao vivo): `ma_upd` (0013) só checava
-- app.eh_interno(), sem checar canal nem estado. Um PATCH direto no PostgREST
-- com o JWT de `relacionamento` trocava `destinatario`/`status`/`enviada_em`
-- de QUALQUER linha, inclusive canal='email' — a regra real (só whatsapp, só
-- pendente->enviada, campos carimbados pelo servidor) vivia só na rota
-- src/app/api/mensagens/[id]/route.ts. Fecha o buraco: revoga UPDATE direto de
-- `authenticated` e expõe uma RPC security definer que é a ÚNICA porta de
-- escrita, replicando exatamente a regra que a rota já aplicava.

revoke update on mensagens_agendadas from authenticated;

create or replace function public.marcar_mensagem_manual(p_id uuid)
returns mensagens_agendadas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_atual mensagens_agendadas%rowtype;
  v_perfil_id uuid;
begin
  if not app.eh_interno() then
    raise exception 'sem_permissao: apenas equipe interna pode marcar mensagem como enviada' using errcode = '42501';
  end if;

  select id into v_perfil_id from perfis_equipe where auth_user_id = auth.uid() and ativo;

  select * into v_atual from mensagens_agendadas where id = p_id for update;
  if not found then
    raise exception 'mensagem_nao_encontrada' using errcode = 'P0002';
  end if;

  if v_atual.canal <> 'whatsapp' then
    raise exception 'canal_nao_manual: só mensagens de WhatsApp podem ser marcadas como enviadas manualmente' using errcode = '23514';
  end if;

  if v_atual.status <> 'pendente' then
    raise exception 'status_nao_pendente: mensagem já está em status ''%''', v_atual.status using errcode = '23514';
  end if;

  update mensagens_agendadas
     set status = 'enviada',
         enviada_em = now(),
         marcada_manual_por = v_perfil_id
   where id = p_id
  returning * into v_atual;

  return v_atual;
end;
$$;

comment on function public.marcar_mensagem_manual(uuid) is
  'Única porta de escrita para a fila manual de WhatsApp (ALTO 1 do pentest de 03/09/2026). '
  'Substitui o UPDATE direto em mensagens_agendadas: valida canal/estado no servidor e carimba '
  'enviada_em/marcada_manual_por — nunca aceita esses valores do cliente.';

revoke execute on function public.marcar_mensagem_manual(uuid) from public, anon;
grant  execute on function public.marcar_mensagem_manual(uuid) to authenticated;
