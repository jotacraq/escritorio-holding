"use client";

import { useEffect, useState } from "react";

export function useDebounce<T>(valor: T, atrasoMs = 300): T {
  const [debated, setDebatido] = useState(valor);
  useEffect(() => {
    const temporizador = setTimeout(() => setDebatido(valor), atrasoMs);
    return () => clearTimeout(temporizador);
  }, [valor, atrasoMs]);
  return debated;
}
