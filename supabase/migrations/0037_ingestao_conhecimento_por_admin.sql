-- 0037_ingestao_conhecimento_por_admin.sql
-- Aplicada em 03/09/2026. Estava no banco e NAO no repo — drift apontado pelo
-- pentest da Fase 2. Commitada aqui para que o time possa revisar em code review
-- o que ela faz, em vez de inferir por teste comportamental.
--
-- A ingestao do Modulo 4 (scripts/importar-transcricoes.ts) foi escrita para
-- rodar com service_role, que ainda nao existe neste ambiente. Sem escrita, a
-- base de conhecimento fica vazia e a tela nao tem o que mostrar.
--
-- Em vez de esperar a chave, damos a ESCRITA ao papel que ja e o dono legitimo
-- desse material: admin. Nao e afrouxamento — e o mesmo recorte que ja existe
-- em prompts_versoes, mensagens_templates e roteiros_versoes, onde admin cria e
-- versiona conteudo do metodo. A leitura continua restrita a quem ve patrimonio;
-- `relacionamento` e `assistente` seguem sem enxergar uma linha.
--
-- O que NAO muda: a trava de IA sobre transcricao (0032) continua valendo. Isto
-- permite GUARDAR o material do escritorio no banco do escritorio; nao permite
-- mandar nada para IA nenhuma.
--
-- Sem policy de DELETE em nenhuma das tabelas: ausencia de policy e negacao, e o
-- pentest confirmou que nem admin apaga transcricao.

create policy tr_ins on transcricoes for insert to authenticated
  with check ((select app.eh_admin()));
create policy tr_upd on transcricoes for update to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));

create policy cc_ins on casos_conhecimento for insert to authenticated
  with check ((select app.eh_admin()));

create policy pc_ins on padroes_conhecimento for insert to authenticated
  with check ((select app.eh_admin()));
create policy pc_upd on padroes_conhecimento for update to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));

comment on policy tr_ins on transcricoes is
  'Ingestao do Modulo 4 por admin autenticado (0037) — alternativa a service_role. Leitura segue restrita a ve_patrimonio.';
