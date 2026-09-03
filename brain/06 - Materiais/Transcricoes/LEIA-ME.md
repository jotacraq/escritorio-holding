# As 70 transcrições não estão neste repositório — de propósito

São **transcrições literais de reuniões da Dra. Elaine com clientes reais**: patrimônio, empresa, composição familiar, conflito entre herdeiros, valores. Isso é sigilo profissional de advogado, não material de projeto.

Repositório privado ainda é repositório: clonado em qualquer máquina, copiado em backup, exposto por um token vazado. O lugar dessas 70 conversas é o banco, com RLS — onde só quem enxerga patrimônio lê, e nem `admin` consegue apagar.

## Onde elas estão

| Onde | O quê |
|---|---|
| **Banco Supabase** `fcfsnqqaphtamhrpuyoh` | tabela `transcricoes`, 70 linhas, 3,4 MB, indexadas para busca full-text. Ver em **Conhecimento** no sistema. |
| **Máquina do João** | `C:\Users\João\sic-hf-brain\06 - Materiais\Transcricoes\` (70 `.md`) |
| **Origem** | `C:\Users\João\Desktop\Materiais para a elaboracao do sistema de sessao\transcricao*.docx` |

## Para reimportar (outra máquina, banco novo)

1. Extrair os `.docx` para `.md` (o conversor está no diário de 03/09/2026).
2. Rodar a ingestão:

```bash
# com service_role, quando existir:
npx tsx scripts/importar-transcricoes.ts                 # dry-run, confere o relatório
npx tsx scripts/importar-transcricoes.ts --aplicar

# sem service_role, com login de admin (foi assim que entrou em 03/09):
INGESTAO_EMAIL="..." INGESTAO_SENHA="..." npx tsx scripts/importar-transcricoes.ts --aplicar
```

O script é idempotente: rodar duas vezes não duplica, e nunca sobrescreve caso já revisado por humano.

## O que esperar

52 Sessões de Viabilidade · 18 apresentações de croqui · 18/18 pares resolvidos automaticamente · 52 casos, sendo 18 `avancou_para_croqui` e 34 `indefinido`.

**`indefinido` não é "não converteu".** Ver [[../../01 - Projeto/Fase 2 — o que entrou]].
