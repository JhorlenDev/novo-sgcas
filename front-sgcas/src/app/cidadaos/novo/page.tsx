"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { FormularioDeCadastro } from "@/components/cidadaos/formulario-de-cadastro";
import { Card, PageHeader } from "@/components/ui";

export default function NovoCidadaoPage() {
  const router = useRouter();

  return (
    <AppShell>
      <PageHeader title="Novo cidadão" description="O cadastro pode ser completado depois, durante o atendimento." />

      <Card className="max-w-3xl">
        <FormularioDeCadastro
          naPagina
          onCancelar={() => router.push("/cidadaos")}
          onSalvo={(cidadao) => router.replace(`/cidadaos/${cidadao.id}`)}
        />
      </Card>
    </AppShell>
  );
}
