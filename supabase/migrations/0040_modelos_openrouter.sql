-- 0040_modelos_openrouter.sql
-- Migração de provedor de IA: Anthropic direto → OpenRouter (rota pinada só na
-- Anthropic, provider.order=["anthropic"], allow_fallbacks:false — mesma cadeia
-- de subprocessador de hoje). Slug do modelo passa a ser o do OpenRouter
-- ("anthropic/claude-opus-5" / "anthropic/claude-sonnet-5"), não mais o slug
-- cru da Anthropic ("claude-opus-5" / "claude-sonnet-5").
--
-- ADITIVA: as linhas antigas de modelos_ia_precos (slug sem prefixo) e os
-- prompts_versoes anteriores NÃO são apagados — servem de histórico e de
-- fallback caso IA_PROVEDOR=anthropic (reversão sem deploy) volte a rodar.

-- ===========================================================================
-- (a) Preço dos modelos com o slug do OpenRouter. Multiplicadores de cache no
-- DEFAULT da tabela (1.25 escrita / 0.10 leitura, 0009) — conferem com o que o
-- OpenRouter cobra hoje para a rota Anthropic.
-- ===========================================================================
insert into modelos_ia_precos (modelo, entrada_usd_mtok, saida_usd_mtok, vigente_desde) values
 ('anthropic/claude-opus-5', 5.0000, 25.0000, current_date),
 ('anthropic/claude-sonnet-5', 2.0000, 10.0000, current_date);

-- ===========================================================================
-- (b) `prompts_versoes.modelo_padrao` passa a apontar para o slug do
-- OpenRouter. REVISADO em 03/09/2026 após teste real: `anthropic/claude-opus-5`
-- com `reasoning.max_tokens=4096` + `response_format` estrito + o schema
-- completo de `BriefingSchema` (13 seções) devolveu corpo vazio/inválido em
-- chamada real via OpenRouter (`openrouter_resposta_vazia`), apesar de chamadas
-- isoladas com schema simples funcionarem normalmente no mesmo modelo — não
-- houve tempo de isolar a causa raiz (schema grande demais para o strict do
-- Opus, ou falha transitória do provider) antes de fechar a sessão. Decisão do
-- usuário: usar Sonnet nas 4 tarefas — testado e funcionando de ponta a ponta
-- (gerarBriefing real, custo medido US$0,0738, latência ~70s, stop_reason
-- end_turn). Se algum dia quiser Opus no diagnóstico, reproduzir o bug antes
-- (script descartável, mesmo padrão de scripts/testar-json-schema-estrito.ts)
-- — não trocar o modelo_padrao de volta sem antes confirmar que o Opus
-- completa uma chamada real com o BriefingSchema inteiro.
-- ===========================================================================
update prompts_versoes
   set modelo_padrao = 'anthropic/claude-sonnet-5'
 where chave in ('protocolo_01_briefing', 'agente_croqui_analise', 'material_pos_sessao', 'ordenar_horarios_agenda')
   and ativo;

-- NOTA: 'prompt_mestre' (0009) não é chamado diretamente por nenhum chamador
-- de IA (é o texto-base institucional, embutido nos outros corpo_sistema) —
-- seu modelo_padrao fica com o slug antigo de propósito, não afeta execução.
