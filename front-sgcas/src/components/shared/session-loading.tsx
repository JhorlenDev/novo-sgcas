import { LoaderCircle } from "lucide-react";

export function SessionLoading() {
  return (
    <main className="center-screen">
      <div role="status" aria-label="Carregando SGCAS">
        <LoaderCircle aria-hidden="true" className="h-10 w-10 animate-spin text-primary motion-reduce:animate-none" />
        <span className="sr-only">Carregando SGCAS</span>
      </div>
    </main>
  );
}
