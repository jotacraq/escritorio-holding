import { SeloStub } from "@/components/ui/Selo";

const AREAS = [
  { titulo: "Equipe", descricao: "Convidar, ativar e desativar membros da equipe (perfis_equipe)." },
  { titulo: "Prompts de IA", descricao: "Versionar o Prompt Mestre e o Protocolo 01, ativar versão sem deploy." },
  { titulo: "Produtos e ofertas", descricao: "IDs de produto Hotmart, preço padrão e condição do Incentivo do Resolvedor." },
  { titulo: "Modelos de mensagem", descricao: "Templates da régua de e-mail e WhatsApp por chave e versão." },
  { titulo: "Custo de IA", descricao: "Custo por jornada, por mês e por versão de prompt (execucoes_ia)." },
];

export default function PaginaAdmin() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-tinta">Admin</h1>
        <p className="text-sm text-tinta-suave">Configuração operacional do sistema — restrito ao papel admin.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {AREAS.map((area) => (
          <div key={area.titulo} className="flex flex-col gap-2 rounded-sm border border-linha bg-papel-elevado p-4">
            <h2 className="font-serif text-base font-semibold text-tinta">{area.titulo}</h2>
            <p className="text-sm text-tinta-suave">{area.descricao}</p>
            <SeloStub texto="Tela ainda não construída — fora do escopo F1–F10 do frontend." />
          </div>
        ))}
      </div>
    </div>
  );
}
