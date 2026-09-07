// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { montar, semViolacoes } from "@/components/ui/a11y-teste";
import { ProvaDeVidaCron } from "./ProvaDeVidaCron";

/**
 * Fase 8: "o envio automático parou" deixou de ser um selo âmbar no meio de
 * uma linha cinza e virou aviso acionável. O teste existe porque a diferença
 * entre os dois estados é justamente o que ninguém vê em captura de tela de
 * um banco saudável — o cron do ambiente de desenvolvimento está sempre em
 * dia, então o caminho ruim só é exercido aqui.
 */
describe("ProvaDeVidaCron", () => {
  const agora = new Date().toISOString();

  it("em dia: confirmação discreta, anunciada como status e nunca como alerta", () => {
    const { container } = montar(<ProvaDeVidaCron regua={{ ultimo_cron_em: agora, cron_atrasado: false, aviso: null }} />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("Rodando");
  });

  it("atrasado: vira alerta, diz a consequência e leva à tela que resolve", () => {
    const { container } = montar(<ProvaDeVidaCron regua={{ ultimo_cron_em: agora, cron_atrasado: true, aviso: "atrasado" }} />);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).toContain("parado");
    expect(container.textContent).toContain("não estão saindo sozinhas");
    const acao = container.querySelector<HTMLAnchorElement>('a[href="/admin#integracoes"]');
    expect(acao?.textContent).toBe("Configurar o envio");
  });

  it("nunca rodou: não diz 'último envio' que não existe — vazio é vazio", () => {
    const { container } = montar(<ProvaDeVidaCron regua={{ ultimo_cron_em: null, cron_atrasado: false, aviso: "nunca" }} />);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).toContain("nunca rodou");
    expect(container.textContent).not.toContain("Último envio");
    expect(container.querySelector("time")).toBeNull();
  });

  it("não tem violação de acessibilidade nos dois estados", async () => {
    const emDia = montar(<ProvaDeVidaCron regua={{ ultimo_cron_em: agora, cron_atrasado: false, aviso: null }} />);
    await semViolacoes(emDia.container);
    const parado = montar(<ProvaDeVidaCron regua={{ ultimo_cron_em: agora, cron_atrasado: true, aviso: "atrasado" }} />);
    await semViolacoes(parado.container);
  });
});
