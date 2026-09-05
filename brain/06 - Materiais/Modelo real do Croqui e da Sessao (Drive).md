# Modelo real do Croqui e da Sessão de Viabilidade — como o escritório opera no Google Drive

Lido em 05/09/2026 pelo orquestrador nos modelos da Dra. Elaine (`1) RELATÓRIO DA SESSÃO DE VIABILIDADE`, `3) RELATÓRIO DO CROQUI`, `4.1) APRESENTAÇÃO DE CROQUI COM OPERACIONAL`; pasta-exemplo `HOLDING DRIVE - <cliente>`). Nomes e valores de cliente NÃO estão aqui (sigilo) — só a estrutura, as rubricas e as fórmulas inferidas de dois exemplos. **Esta nota é a referência do que o sistema tem de reproduzir.** O João foi explícito: "o croqui apresenta dados; 1, 2 e 3 células; vantagens financeiras de cada uma; economia de cada arquitetura. O sistema é um facilitador do que já existe no Drive."

## Pasta do cliente no Drive (numeração = ordem do processo)
`1) RELATÓRIO DA SESSÃO DE VIABILIDADE` → `2) …` → `3) CROQUI` (pasta) / `3) RELATÓRIO DO CROQUI` (doc) → `4.1) APRESENTAÇÃO DE CROQUI COM OPERACIONAL` (slides). A API do Drive não lista os filhos da pasta compartilhada — os modelos foram achados pelo prefixo numérico.

## 1) Relatório da Sessão de Viabilidade (template)
Cabeçalho: cliente, cidade, estado civil, profissão, natureza dos bens, quantidade de imóveis, valor do patrimônio, participará acompanhado? quem? o acompanhante decide? assistiu palestra/site? data da contratação da sessão, data da sessão, valor pago (parcelas).
Blocos: motivação · composição familiar (casal: idade, ocupação, regime, ano do casamento, residência; filhos: idade, ocupação, regime, netos) · **composição patrimonial** por classe — *imóveis* (ano de aquisição, valor histórico, valor de mercado, destinação e valor de locação), *veículos* (ano, histórico, mercado), *investimentos* (natureza, valor atual), *empresas* (objeto, composição societária, capital social, empregados, PL, faturamento) · receita familiar mensal · "tem ideia do custo do inventário?" · reserva/seguro · ciente do aumento do ITCMD? · como quer deixar organizado · motivação/urgência · **resultado: fechou ou não e por quê**.
**Dados para início do croqui** (pesquisa que a equipe faz depois): ITCMD (lei estadual, link, alíquota/base para herança e para doação), ITBI (lei municipal, link, alíquota, entendimento da prefeitura sobre diferença histórico × mercado), cartório de notas (estimativa para escritura de inventário extrajudicial, link da corregedoria), registro de imóveis (estimativa, link). Depois: "considerações relevantes observadas na apresentação do croqui".

## 3) Relatório do Croqui / 4.1) Apresentação — a sequência de slides (todos com DADOS)
1. **Composição familiar** — titular(es), regime de bens, filhos (idade, ocupação, estado civil, filhos).
2. **Formação patrimonial** — tabela BEM × VALOR DIRPF × VALOR MERCADO, com TOTAL das duas colunas.
3. "Por que, neste caso, holding não é só boa opção, mas necessidade" — por causa do inventário.
4. **Impacto de um inventário** (cenário atual) — BASE = total mercado; cartório de notas; certidões; cartório de imóveis; honorários; imposto (ITCMD herança); TOTAL. **Levantamento para pagar o inventário**: valor a levantar (= total), bem a ser vendido, valor DIRPF, valor mercado, deságio (20%), rendimento = ganho de capital, IR sobre ganho de capital, **CUSTO DO INVENTÁRIO** = total + IR.
5. **Impacto após a reforma tributária** — mesma tabela com ITCMD majorado (20%).
6. **Comparação com a doação** — cenário atual × após reforma: base, notas, certidões, imóveis, imposto (ITCMD doação), total, diferença para o inventário e %.
7. Frase: "Quem não tem vida eterna não deveria ter bens em seu nome." Como funciona: COFRE · GATILHO · manutenção do controle (texto fixo do método).
8. **Modelo básico (1 célula)** — passos 1-3 + diagrama + **comparação modelo × inventário** (atual × reforma): BASE = total DIRPF (valor histórico!), cartório de imóveis, junta comercial, contabilidade, honorários, imposto, total, diferença, %.
9. **Duas células com domicílio fiscal mais vantajoso** — passos 1-5 + diagrama + comparação.
10. **Três células** (Cofre · Veículo · Destino) — passos 1-6 + diagrama + comparação.
11. **Comparação de todos os cenários** — SISTEMA × VALORES × DIF. INVENTÁRIO × DIF. % (inventário, doação, 1, 2, 3 células); versão "após reforma" (inclui inventário após reforma).
12. **Atenção ao ITBI** — texto + as duas tabelas comparativas recalculadas com "POSSÍVEL ITBI".
13. **Membership** — R$ 2.000/mês, 6 meses isentos; tabela "sem o membership" (horas por ato × R$ 2.400) e "custos após constituição" (contabilidade, alterações, consultoria jurídica, consultoria financeira) por 1/2/3 células.
14. **Operacional** (quando há locação): custo da locação PF hoje (IRRF 27,5%) × futuro (30%) × com sociedade operacional (lucro presumido); diferença/ano; custo operacional de montar a célula (minuta, constituição, relação com a cofre, junta, alvará).
15. **Honorários** — tabela ATO × horas (básico/2/3 células) → preço/hora R$ 2.400 → total; "+ célula operacional".
16. **Deduções** — SV (R$ 2.000) + incentivo resolvedores na SV (R$ 1.600) + croqui (R$ 4.500) + incentivo no CE (R$ 2.700) = R$ 10.800; saldo; **incentivo resolvedores 10%**; novo saldo.
17. **Forma de pagamento** — sinal = 10% do maior valor; saldo à vista; 2x…5x (boleto/PIX).

## Fórmulas inferidas (dois exemplos batem; conferir com a Dra. Elaine antes de virar regra)
- Cartório de notas (inventário/doação) = **1% × base mercado**. Cartório de imóveis = **1% × base** (mercado no inventário/doação; DIRPF nos modelos de holding). Certidões = **R$ 7.000 fixo**. Honorários do inventário = **5% × base mercado**.
- ITCMD herança e doação = alíquota do ESTADO (exemplos: 4% e 8%); **após reforma = 20%**. Nos modelos de holding a base é o **valor DIRPF**: 1 célula = alíquota de doação do estado; 2 células = **alíquota do estado de domicílio fiscal vantajoso** (exemplo 2%); 3 células = **valor fixo** (exemplo R$ 4.000; após reforma R$ 20.000).
- Deságio na venda forçada = **20%** do mercado; ganho de capital = (mercado × 0,8) − DIRPF; **IR = 15%** do ganho.
- Junta comercial e contabilidade = **fixos por modelo** (ex.: 3.577/3.500/4.599 e 2.133/3.555/4.266).
- Honorários da holding = **parâmetro por modelo** (não saiu de fórmula nos exemplos) — ou horas × R$ 2.400 (tabela de atos).
- **ITBI possível = 3% × Σ (mercado − DIRPF) só dos imóveis** (bate nos dois exemplos).
- Diferença = custo do inventário − custo do sistema; % = diferença ÷ custo do inventário.
- IRRF PF sobre locação = 27,5% (futuro 30%); sociedade operacional ≈ 6,7% hoje / 21,4% futuro (lucro presumido — parametrizar).

## O que o SIC-HF tem hoje e o que falta
Tem: `patrimonio_itens` (com `valor_mercado`, `origem_valor`), `familiares`, `parametros_metodo` (versionado, ITCMD/ITBI exigem base legal), `cenarios_patrimoniais` + `cenario_rubricas` (procedência digitado/calculado/ausente), croqui de 13 slides gerado por IA, `Apresentacao` genérica, `DeckImpressao`, material em PDF.
Falta: o **motor** que, a partir dos bens (DIRPF × mercado, por classe) + família + parâmetros do estado/município, produz TODAS as tabelas acima de forma determinística — e o croqui/apresentação/relatório nascerem desse motor (a IA só narra). Ver `docs/ARQUITETURA-FASE-5.md`.

> **SUPERADA em 05/09/2026 (03:55)** pela nota [[Processo real do escritorio (Drive)]], lida célula a célula da `PLANILHA DO CLIENTE.xlsx` (19 abas). Diferenças que valem: hora = R$ 1.800 (não 2.400); honorários de inventário = 7% (não 5%); incentivo Resolvedores na SV = R$ 2.400; ITCMD/ITBI/ganho de capital são **faixas progressivas**, não alíquota única; base do ITCMD = mercado em 1 e 2 células, DIRPF só em 3 células. Mantida como registro da primeira leitura (docs do Drive online).
