"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ConciergeBell, FolderOpen, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, EmptyState, PageHeader, SectionHeading, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { rotuloSituacao, tomDoCaso } from "@/lib/casos";
import type { Caso, Senha } from "@/types/sgcas";

export default function DashboardPage() {
  const [fila, setFila] = useState<Senha[]>([]);
  const [casos, setCasos] = useState<Caso[]>([]);

  useEffect(() => {
    void Promise.all([
      api<Senha[]>("/queues/").then(setFila).catch(() => setFila([])),
      api<Caso[]>("/cases/").then(setCasos).catch(() => setCasos([])),
    ]);
  }, []);

  return (
    <AppShell>
      <PageHeader
        title="Painel"
        description="O que está em andamento hoje na sua unidade."
        action={
          <Link href="/recepcao" className="button">
            <ConciergeBell size={16} aria-hidden="true" />
            Registrar recepção
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Aguardando atendimento"
          value={fila.length.toLocaleString("pt-BR")}
          hint="Senhas na fila, esperando chamada."
          icon={Users}
          highlight
        />
        <Stat
          label="Casos em acompanhamento"
          value={casos.length.toLocaleString("pt-BR")}
          hint="Casos visíveis para a sua unidade."
          icon={FolderOpen}
        />
      </div>

      <div className="grid two mt-4">
        <Card>
          <SectionHeading
            title="Fila de atendimento"
            action={fila.length > 0 ? <Link href="/fila" className="inline-flex min-h-10 items-center text-sm font-semibold text-primary hover:underline">Abrir fila</Link> : undefined}
          />
          {fila.length === 0 ? (
            <EmptyState title="Fila vazia" text="Quando a recepção encaminhar alguém, a senha aparece aqui." />
          ) : (
            <ul>
              {fila.slice(0, 6).map((senha) => (
                <li className="line-row flex items-start gap-3" key={senha.id}>
                  <span className="mt-0.5 shrink-0 rounded-md bg-meta-soft-gray px-2 py-0.5 text-xs font-semibold tabular-nums text-meta-charcoal">
                    {senha.senha}
                  </span>
                  <span className="min-w-0">
                    <strong className="block">{senha.cidadao_nome}</strong>
                    <small className="block">{senha.servico}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeading
            title="Casos recentes"
            action={casos.length > 0 ? <Link href="/casos" className="inline-flex min-h-10 items-center text-sm font-semibold text-primary hover:underline">Ver todos</Link> : undefined}
          />
          {casos.length === 0 ? (
            <EmptyState title="Sem casos" text="Os atendimentos encaminhados aparecem nesta lista." />
          ) : (
            <ul>
              {casos.slice(0, 6).map((caso) => (
                <li className="line-row flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5" key={caso.id}>
                  <span className="min-w-0 text-sm font-medium">{caso.cidadao_nome}</span>
                  <Badge tone={tomDoCaso(caso.situacao)}>{rotuloSituacao(caso.situacao)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
