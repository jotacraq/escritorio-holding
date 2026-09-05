# Processo real do escritório no Google Drive — leitura completa de uma pasta de cliente

Lido em 05/09/2026 pelo orquestrador numa pasta-cliente completa do Drive (contrato → sessão de viabilidade → croqui → minutas → entrega), 51 arquivos não-mídia lidos por script (docx/pptx/xlsx com fórmulas) + 1 PDF. **Sem nomes, CPF, endereço ou valor de bem de cliente aqui** — coeficientes e regras do método do escritório podem aparecer, porque são regra de negócio, não PII. Mapa completo com PII fica em `tmp/squad/drive-cliente-exemplo.md` (não versionado).

Esta nota **substitui e corrige** `Modelo real do Croqui e da Sessao (Drive).md` em vários pontos de fórmula — ver §5.

## 1. O processo, passo a passo

```
Pré-reunião (script de qualificação)
   ↓
Sessão de Viabilidade (SV) — diagnóstico, não venda; gravada; transcrição automática vira Resumo
   ↓ (durante a SV, estimativa de bolso numa planilha à parte, não calibrada — não é o motor)
Relatório da SV (entrevista completa + pesquisa de ITCMD/ITBI/cartório da jurisdição do cliente)
   ↓
Montagem do Croqui — a equipe alimenta UMA planilha (19 abas, todas as fórmulas do método)
   ↓ (planilha ligada por Apps Script a um Slides — botão manual "Atualizar Apresentação Agora")
Reunião de apresentação do Croqui — script próprio, slide a slide, com a planilha ao vivo
   ↓
Assinatura de contrato (Honorários holding OU Honorários "Empresários" para célula única de PJ operacional; Membership opcional pós-constituição)
   ↓
Execução — cronograma de ~15 marcos com prazo em dias, contratação → constituição → alterações societárias → ITBI/ITCMD → registro → entrega (60 dias)
   ↓
Entrega — carta, sumário jurídico de cada célula, qualificação de todos os envolvidos, checklist de documentos entregues
```

A Sessão de Viabilidade é explicitamente descrita pelo escritório como **diagnóstico para saber se a holding é viável e adequada** — só depois disso o Croqui é oferecido. Isso confirma a premissa do CLAUDE.md do projeto.

## 2. O motor de verdade é uma planilha de 19 abas — muito mais rico que o assumido

A planilha do cliente tem estas abas, nesta ordem, cada uma alimentando a seguinte: `1 Família` → `2 Patrimônio` → `3 Inventário` → `4 Doações` → `5/6/7 Uma/Duas/Três Células` → `8 Operacional` → `9 Payback` → `10 Operacional de aluguéis futuros` → `11 Comparativos` → `12 Comparativos com ITBI` → `13 Horas de trabalho` → `14 Honorários` → `15/17 Alíquotas ITCMD (causa mortis / doação)` → `16 Alíquotas IRPF (ganho de capital)` → `18 Tabela progressiva (IRPF mensal)` → `19 Tabela de notas (cartório, por UF)`.

Ela está ligada a uma apresentação de slides por um **Apps Script customizado** com um botão único ("Sincronização Slides → Atualizar Apresentação Agora"). Existe um botão legado conflitante dentro do próprio Slides que o guia de uso instrui a **nunca clicar**, porque "pode interferir na estrutura da apresentação" — ou seja, o processo manual já convive com duas fontes de sincronização concorrentes.

## 3. Prova de campo do problema que o SIC-HF resolve

Encontrado neste Drive um caso real de deck **entregue com número zerado**: uma tabela de custo total do inventário aparece como "R$ 0,00" e o texto de fechamento diz "a família perde aproximadamente R$ 0,00" — a sincronização falhou silenciosamente e ninguém percebeu antes do envio. Uma segunda cópia do mesmo deck, usada como modelo para reaproveitar em outro cliente, tem valores diferentes da primeira nas mesmas células — ou seja, nem a versão "limpa" bateu com a original. **Isto não é hipótese: é o que aconteceu.** Confirma, com evidência real, a regra "ausência nunca é zero" e a necessidade de versionar o cálculo (`croqui_calculos`, §5 da Fase 5).

## 4. Taxonomia jurídica das minutas (célula × regime de bens × variante × pós-morte)

Três células — **Cofre** (guarda os bens, sob controle absoluto dos doadores via usufruto), **Veículo** (gestão/controle, no meio da cadeia), **Destino** (planejamento patrimonial, onde entram os herdeiros como nu-proprietários) — encadeadas em cascata de controle: Destino controla Veículo, que controla Cofre.

Eixos de variação dos contratos sociais e alterações:
- **Regime de bens do casal instituidor**: Comunhão Parcial vs Comunhão Universal — muda a forma de outorga/integralização.
- **Tradicional (Usufruto) vs Golden Share**: dois desenhos de controle diferentes, só na célula Destino — usufruto vitalício clássico, ou uma classe de quotas específica com poder de veto ("super poderes") sobre decisões estruturais.
- **Alteração Pós-Morte**: documento específico por célula que formaliza o "gatilho": registra o óbito, aplica a cláusula de **reversão + direito de acrescer** do usufruto (o usufruto do falecido migra 100% para o sobrevivente), transfere a administração isolada e exclusiva ao sobrevivente, mantém o capital social inalterado. É a operação jurídica por trás do discurso de vendas "o gatilho dispara sozinho, sem depender do Estado".

O **Acordo de Sócios** (multi-célula) carrega as cláusulas de governança que não cabem no contrato social: mandato sucessório automático (Art. 684 CC) para um herdeiro assumir a administração em caso de morte/incapacidade; dispensa de inventário + renúncia à apuração de haveres; regra de distribuição dos aluguéis enquanto há usufruto; veto à alienação de imóvel sem aprovação de 100% de uma classe de quotas de controle; Call Option disciplinar dos pais sobre os filhos (recompra por valor contábil, parcelado, em caso de desarmonia/tentativa de venda/dilapidação); Tag Along / Drag Along; Quotas de classe de controle com veto absoluto sobre venda de imóvel, alteração do acordo e endividamento; arbitragem sigilosa como foro de solução de conflito. Existe ainda um **Termo de Ciência** que o escritório usa quando o cliente não assina o Acordo de Sócios no prazo (7 dias) — transfere ao cliente a responsabilidade por qualquer conflito societário até a assinatura, protegendo o escritório.

## 5. Fórmulas — correções e adições sobre a nota anterior

A nota `Modelo real do Croqui e da Sessao (Drive).md` inferiu coeficientes a partir de dois exemplos textuais. Esta leitura leu a **planilha real com fórmula por célula**, e corrige:

- **Honorários por hora do método: R$ 1.800,00** (não R$ 2.400,00).
- **Honorários advocatícios do inventário: 7% da base** (mínimo OAB) — não 5%.
- **Cartório de notas: 0,8% da base** e **cartório de imóveis: 0,5% da base**, como aproximação nas fórmulas de célula — mas o escritório também mantém uma **tabela de emolumentos fixos por UF e por faixa de valor** (não um percentual!) que é a fonte de verdade real dos tribunais de justiça estaduais, e essa tabela só está preenchida para uma fração das 27 UFs.
- **Certidões**: o próprio escritório tem duas constantes divergentes na mesma planilha (R$ 2.000 numa aba, R$ 7.000 nas demais) — sinal de que o parâmetro nunca foi unificado; tratar como pendência a esclarecer, não como regra dupla.
- **Base de cálculo do ITCMD por modelo de célula NÃO é uniformemente "valor DIRPF"**: os modelos de 1 e 2 células usam a base de **mercado**; só o modelo de 3 células usa a base de **DIRPF (valor histórico)**. É uma diferença de desenho tributário real entre os modelos, não um detalhe de implementação — precisa virar uma característica explícita de cada modelo no motor, não um parâmetro único "base do croqui".
- **ITCMD e ITBI de doação/herança não são alíquotas únicas por UF**: são **tabelas progressivas por faixa** (isento até X, faixa 1 até Y, faixa 2 até Z, faixa 3 acima, com teto) — o escritório mantém essa tabela completa para as 27 UF, tanto para causa mortis quanto para doação. O motor precisa de uma estrutura de faixas por UF e por tipo de fato gerador, não um escalar por chave.
- **Ganho de capital (IR) também é progressivo por faixa de ganho** (isento até certo valor; depois 15% / 17,5% / 20% / 22,5%), não um percentual fixo de 15% — 15% é só a faixa mais comum.
- **Reforma tributária (IBS/CBS) já está parametrizada de fato** na tributação de aluguel via PJ, com um conjunto de alíquotas específicas (débito, crédito, IR/CS) que o escritório usa em duas versões ligeiramente diferentes numa mesma planilha (indício de que ainda estão calibrando, não de erro).
- Existe uma tabela de **payback em meses e rendimento do capital economizado a juros compostos (CDI)** que hoje não está prevista no motor da Fase 5 — é um argumento de venda forte ("o investimento se paga sozinho em N meses") que vale considerar incluir.
- A tabela de horas por ato (usada para T15/T12 do croqui) tem 21 atos reais e confirma que o **modelo de 3 células é o que menos horas totais consome**, apesar de ter mais etapas de constituição — cada célula individualmente é mais simples de montar.

## 6. O que o Guia Sheets×Slides revela sobre como eles montam a apresentação hoje

O processo é: preencher a planilha inteira primeiro → clicar um botão de Apps Script para empurrar os números renderizados para os slides → conferir manualmente se bateu. Não há log de sincronização, não há aviso de falha, não há versão anterior guardada, e existe um botão concorrente legado que a própria instrução manda evitar. É sincronização unidirecional, manual, sem controle de erro — exatamente o ponto que o motor determinístico + `ResultadoCroqui` versionado da Fase 5 substitui.

## 7. O que o SIC-HF precisa reproduzir / o que falta / o que pode inovar

**Reproduzir (é a regra do método, não op cional):**
- As 19 abas encadeadas, na ordem família → patrimônio → inventário → doação → células 1/2/3 → operacional → comparativos → ITBI → horas → honorários → deduções → parcelamento.
- Base de cálculo diferente por modelo de célula (mercado para 1/2 células, DIRPF para 3 células) — não é detalhe, é desenho tributário do método.
- ITCMD/ITBI/ganho de capital como **tabelas de faixa progressiva por UF**, não escalares — isso muda o catálogo de parâmetros da Fase 5 (§4.3): as chaves de alíquota precisam de uma estrutura de faixas, não um valor único.
- Cartório de notas/registro como opção entre percentual aproximado (fallback) e tabela de emolumentos fixos por UF/faixa (fonte de verdade, quando cadastrada) — replicar a lógica de fallback com procedência clara de qual dos dois foi usado.
- A cadeia de deduções e incentivo "Resolvedores" (SV + Croqui + incentivos abatidos do honorário total, depois um incentivo adicional de 10% sobre o saldo).
- A taxonomia de minutas por célula × regime de bens × variante (tradicional/golden share) × pós-morte, com o conjunto de placeholders por tipo de documento.
- O Acordo de Sócios como documento de governança separado do contrato social, com as cláusulas listadas no §4.

**Falta (não existe hoje em nenhuma ferramenta do escritório, é oportunidade de produto):**
- **Versionamento e procedência do cálculo** — hoje um número errado só é descoberto por conferência manual visual, depois de já ter ido para o slide (e às vezes para o cliente). Motor determinístico + snapshot resolve isso de raiz.
- **Reconciliação dos parâmetros divergentes** que o próprio escritório carrega hoje (certidões R$2.000 vs R$7.000; duas versões de alíquota de reforma tributária) — o sistema deveria forçar essa reconciliação como pré-requisito de cadastro de parâmetro, não deixar conviver duas fontes.
- **Payback e rendimento do capital economizado** como tabela oficial do croqui, não um rascunho à parte.
- **Checklist de entrega vivo** (o `ENTREGA DA HOLDING.xlsx` hoje é uma planilha estática de TRUE/FALSE) — dá para virar o "Radar de documentos" já proposto na Fase 5 (§1.5), só que do lado da entrega em vez da coleta.
- **Cronograma de execução pós-venda como sub-esteira** — hoje é um PDF estático; o sistema tem o trilho de 7 passos comercial, mas nada equivalente para os ~15 marcos jurídicos entre assinatura e entrega (constituição → alterações → ITBI → registro), que têm dependência sequencial e paralela real.

**Pode inovar (o escritório não tem, mas o sistema pode oferecer):**
- Alerta automático quando dois parâmetros do mesmo tipo divergem (o problema das certidões e da reforma tributária) — nenhuma ferramenta do escritório hoje sinaliza isso, é descoberto por acaso.
- Sincronização com log e reversão — o Apps Script deles é "fire and forget"; o motor pode gravar toda vez que gerou e a partir de qual snapshot, permitindo auditar exatamente quando um número mudou e por quê.
- Simulador ao vivo (§1.2 da Fase 5) — o processo real depende de a advogada navegar manualmente pelas abas da planilha durante a apresentação; um componente de simulação native del croqui elimina esse malabarismo.
- Assistente de placeholder para as minutas — hoje o preenchimento de `[CPF]`, `[ENDEREÇO COMPLETO]` etc. é manual, copiado do Croqui aprovado; o sistema já tem os dados estruturados do cliente e pode gerar a minuta pronta a partir do `EntradaCroqui` + cadastro de qualificação.
