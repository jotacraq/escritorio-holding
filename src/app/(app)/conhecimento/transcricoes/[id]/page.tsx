import { LeitorTranscricao } from "@/components/conhecimento/LeitorCaso";

export const metadata = { title: "Transcrição · Conhecimento · SIC-HF" };

export default async function PaginaTranscricao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeitorTranscricao transcricaoId={id} />;
}
