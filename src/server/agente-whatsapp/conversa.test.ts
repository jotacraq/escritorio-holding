import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A 15ª trava (achado MÉDIO do pentest da Fase 9): o `conversation.id` vem do
 * corpo do webhook e, sem esta checagem, quem tivesse o
 * `CHATWOOT_WEBHOOK_SECRET` mandaria o onboarding de um cliente real para uma
 * conversa que ele mesmo controla.
 *
 * O mock é do CLIENTE do Chatwoot, não do `fetch`: o que se prova aqui é a
 * REGRA de decisão (casa / não casa / não deu para saber), e a regra tem de
 * ser fail-closed nos três casos que não são "casa".
 */
const telefoneDaConversa = vi.fn();
vi.mock("@/server/chatwoot/cliente", () => ({ telefoneDaConversa: (id: string) => telefoneDaConversa(id) }));

const { conversaPertenceAoTelefone } = await import("./conversa");

afterEach(() => {
  telefoneDaConversa.mockReset();
});

describe("conversaPertenceAoTelefone", () => {
  it("mesmo número: passa", async () => {
    telefoneDaConversa.mockResolvedValue({ ok: true, telefone: "+5511988887777" });
    expect(await conversaPertenceAoTelefone("42", "+5511988887777")).toEqual({ ok: true });
  });

  it("mesma pessoa gravada sem o nono dígito no Chatwoot: passa", async () => {
    telefoneDaConversa.mockResolvedValue({ ok: true, telefone: "+551188887777" });
    expect(await conversaPertenceAoTelefone("42", "+5511988887777")).toEqual({ ok: true });
  });

  it("OUTRO contato: recusa — é o ataque do finding MÉDIO", async () => {
    telefoneDaConversa.mockResolvedValue({ ok: true, telefone: "+5511900000000" });
    const r = await conversaPertenceAoTelefone("42", "+5511988887777");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("conversa_nao_pertence_ao_telefone");
  });

  it("o telefone do terceiro NUNCA aparece no detalhe que vai para a tarefa", async () => {
    telefoneDaConversa.mockResolvedValue({ ok: true, telefone: "+5511900000000" });
    const r = await conversaPertenceAoTelefone("42", "+5511988887777");
    if (!r.ok) {
      expect(r.detalhe).not.toContain("+5511900000000");
      expect(r.detalhe).not.toContain("900000000");
    }
  });

  it("conversa sem telefone no contato: recusa (não dá para afirmar que é dele)", async () => {
    telefoneDaConversa.mockResolvedValue({ ok: true, telefone: null });
    const r = await conversaPertenceAoTelefone("42", "+5511988887777");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("conversa_nao_pertence_ao_telefone");
  });

  it("Chatwoot fora do ar: NÃO responde — não saber de quem é a conversa não é licença para falar nela", async () => {
    telefoneDaConversa.mockResolvedValue({ ok: false, erro: "chatwoot_rede: timeout" });
    const r = await conversaPertenceAoTelefone("42", "+5511988887777");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("conversa_nao_verificada");
  });

  it("conversa com id não numérico nem chega a virar chamada", async () => {
    telefoneDaConversa.mockResolvedValue({ ok: false, erro: "conversa invalida" });
    const r = await conversaPertenceAoTelefone("../../admin", "+5511988887777");
    expect(r.ok).toBe(false);
  });
});
