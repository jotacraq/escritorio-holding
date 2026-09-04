import { AdminApp } from "@/components/admin/AdminApp";

export default function PaginaAdmin() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tinta">Admin</h1>
        <p className="text-sm text-tinta-suave">Configuração operacional do sistema — restrito ao papel admin.</p>
      </div>
      <AdminApp />
    </div>
  );
}
