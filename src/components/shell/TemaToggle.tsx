"use client";

import { useTema } from "@/hooks/useTema";

export function TemaToggle() {
  const { tema, alternar } = useTema();
  const escuro = tema === "escuro";
  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={escuro}
      className="relative z-10 inline-flex w-fit shrink-0 items-center gap-2 whitespace-nowrap rounded-sm border border-linha bg-papel px-2.5 py-1.5 text-xs font-medium text-tinta-suave hover:border-linha-forte hover:text-tinta"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current">
        {escuro ? (
          <path d="M10 2a.75.75 0 0 1 .75.75V4a.75.75 0 0 1-1.5 0V2.75A.75.75 0 0 1 10 2Zm0 12.5a.75.75 0 0 1 .75.75V16a.75.75 0 0 1-1.5 0v-.75A.75.75 0 0 1 10 14.5Zm8-4.5a.75.75 0 0 1-.75.75H16a.75.75 0 0 1 0-1.5h1.25A.75.75 0 0 1 18 10ZM4 10a.75.75 0 0 1-.75.75H2a.75.75 0 0 1 0-1.5h1.25A.75.75 0 0 1 4 10Zm11.03-5.03a.75.75 0 0 1 0 1.06l-.88.89a.75.75 0 1 1-1.06-1.06l.88-.89a.75.75 0 0 1 1.06 0ZM6.91 14.03a.75.75 0 0 1 0 1.06l-.88.88a.75.75 0 1 1-1.06-1.06l.88-.88a.75.75 0 0 1 1.06 0Zm8.12 1.94a.75.75 0 0 1-1.06 0l-.88-.88a.75.75 0 1 1 1.06-1.06l.88.88a.75.75 0 0 1 0 1.06ZM5.97 5.97a.75.75 0 0 1-1.06 0l-.88-.89a.75.75 0 0 1 1.06-1.06l.88.89a.75.75 0 0 1 0 1.06ZM10 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" />
        ) : (
          <path d="M17.293 13.293A8 8 0 0 1 6.707 2.707a8.001 8.001 0 1 0 10.586 10.586Z" />
        )}
      </svg>
      {escuro ? "Escuro" : "Claro"}
    </button>
  );
}
