import { AdminApp } from "@/components/admin/AdminApp";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";

export default function PaginaAdmin() {
  return (
    <div className="flex flex-col gap-8">
      <CabecalhoPagina
        rotulo="Administração"
        titulo="Admin"
        descricao="A mesa de controle do sistema: o que travou, quem tem acesso, o que está ligado e os números do método. Restrito ao papel admin."
      />
      <AdminApp />
    </div>
  );
}
