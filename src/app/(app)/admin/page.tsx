import { AdminApp } from "@/components/admin/AdminApp";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";

export default function PaginaAdmin() {
  return (
    <div className="flex flex-col gap-8">
      {/* Sem descrição de página (§2: "descrição ≤ 1 linha ou nenhuma"). As
          39 palavras que estavam aqui só repetiam os nomes das abas logo
          abaixo — e eram o último bloco de prosa > 2 linhas de um cabeçalho
          no sistema. */}
      <CabecalhoPagina rotulo="Administração" titulo="Admin" />
      <AdminApp />
    </div>
  );
}
