import { AdminApp } from "@/components/admin/AdminApp";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";

export const metadata = { title: "Admin · SIC-HF" };

export default function PaginaAdmin() {
  return (
    <div className="flex flex-col gap-bloco">
      <CabecalhoPagina
        rotulo="Administração"
        titulo="Admin"
        descricao="Ajustes do escritório: equipe, valores, textos e o repertório da IA."
      />
      <AdminApp />
    </div>
  );
}
