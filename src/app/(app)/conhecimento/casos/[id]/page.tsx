import { LeitorCaso } from "@/components/conhecimento/LeitorCaso";

export const metadata = { title: "Caso · Conhecimento · SIC-HF" };

export default async function PaginaCaso({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeitorCaso casoId={id} />;
}
