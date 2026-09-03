import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

export default function LayoutAutenticado({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
