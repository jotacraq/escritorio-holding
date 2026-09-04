import type { Ficha360 } from "@/lib/api";

/**
 * Um item que falta para a jornada andar. `abaId` é o `id` da aba (ver
 * `DefinicaoAba` em `Abas.tsx`) para onde o link do item deve apontar —
 * usado tanto pela faixa fixa (`CabecalhoFicha`) quanto pelo
 * `ChecklistPendencias`.
 *
 * Regra do projeto (CLAUDE.md): vazio é vazio, nunca zero. Um item só entra
 * nesta lista quando a fonte de dado existe E está de fato pendente — nunca
 * por falta de permissão de leitura (`podeVerPatrimonio=false` não é
 * "documento pendente", é "esta pessoa não vê documento").
 */
export interface ItemPendencia {
  id: "formulario" | "ligacao" | "briefing" | "documento" | "agendamento";
  rotulo: string;
  abaId: string;
}

export function calcularPendencias(ficha: Ficha360, podeVerPatrimonio: boolean): ItemPendencia[] {
  const itens: ItemPendencia[] = [];

  if (!ficha.formulario) {
    itens.push({ id: "formulario", rotulo: "Preencher o formulário estratégico", abaId: "formulario" });
  }

  if (!ficha.ligacao || !ficha.ligacao.realizada_em) {
    itens.push({ id: "ligacao", rotulo: "Registrar a Ligação Estratégica (POP 03)", abaId: "ligacao" });
  }

  if (!ficha.briefingAtual) {
    itens.push({ id: "briefing", rotulo: "Gerar o Briefing Estratégico", abaId: "briefing" });
  }

  // Aba "Documentos" só existe para quem vê patrimônio — sem ela, não há
  // link possível, e o item não é "pendente", é "não se aplica".
  if (podeVerPatrimonio && ficha.documentos.length === 0) {
    itens.push({ id: "documento", rotulo: "Anexar documentos (IR, contrato social)", abaId: "documentos" });
  }

  const sessaoRealizada = Boolean(ficha.sessao?.realizada_em);
  const temAgendamentoAtivo = ficha.agendamentos.some((a) => a.status === "agendado" || a.status === "confirmado");
  if (!sessaoRealizada && !temAgendamentoAtivo) {
    itens.push({ id: "agendamento", rotulo: "Agendar a Sessão de Viabilidade", abaId: "sessao" });
  }

  return itens;
}
