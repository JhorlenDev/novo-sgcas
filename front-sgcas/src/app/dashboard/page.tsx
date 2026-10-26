"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList, FolderOpen, Headset, Send, Stethoscope, Users, XCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import type { Caso, Senha } from "@/types/sgcas";

const situacoesDosCasos: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  EM_TRIAGEM: { label: "Em triagem", icon: ClipboardList, className: "border-blue-200 bg-blue-50 !text-blue-800" },
  EM_ATENDIMENTO: { label: "Em atendimento", icon: Stethoscope, className: "border-amber-200 bg-amber-50 !text-amber-800" },
  CONCLUIDO: { label: "Concluído", icon: CheckCircle2, className: "border-green-200 bg-green-50 !text-green-800" },
  ENCAMINHADO: { label: "Encaminhado", icon: Send, className: "border-violet-200 bg-violet-50 !text-violet-800" },
  CANCELADO: { label: "Cancelado", icon: XCircle, className: "border-red-200 bg-red-50 !text-red-800" },
};

function SituacaoDoCaso({ value }: { value: string }) {
  const situacao = situacoesDosCasos[value] ?? {
    label: value.replaceAll("_", " ").toLocaleLowerCase("pt-BR"),
    icon: FolderOpen,
    className: "border-slate-200 bg-slate-50 !text-slate-700",
  };
  const Icon = situacao.icon;
  return (
    <small className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-3 py-1 font-medium ${situacao.className}`}>
      <Icon size={14} aria-hidden="true" />
      {situacao.label}
    </small>
  );
}

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
      <PageHeader title="Painel" description="Resumo operacional da unidade para comecar o atendimento." />

      <div className="grid three dashboard-stats">
        <StatCard title="Na fila" value={fila.length} icon={Users} hero />
        <StatCard title="Casos em acompanhamento" value={casos.length} icon={FolderOpen} />
        <Card className="stat action-stat">
          <span>Atalho rapido</span>
          <Headset size={28} />
          <Link href="/recepcao">
            <Button>Registrar recepcao</Button>
          </Link>
        </Card>
      </div>

      <div style={{ height: 16 }} />

      <div className="grid two dashboard-lists">
        <Card>
          <h2>Fila de atendimento</h2>
          {fila.length === 0 ? (
            <EmptyState title="Fila vazia" text="Quando a recepcao encaminhar alguem, a senha aparece aqui." />
          ) : (
            fila.slice(0, 6).map((senha) => (
              <div className="row line-row" key={senha.id}>
                <span>{senha.senha} - {senha.cidadao_nome}</span>
                <small>{senha.servico}</small>
              </div>
            ))
          )}
        </Card>
        <Card>
          <h2>Casos recentes</h2>
          {casos.length === 0 ? (
            <EmptyState title="Sem casos" text="Os atendimentos encaminhados aparecem nesta lista." />
          ) : (
            casos.slice(0, 6).map((caso) => (
              <div className="line-row flex flex-wrap items-center justify-between gap-x-4 gap-y-2" key={caso.id}>
                <span className="min-w-0 break-words">{caso.cidadao_nome}</span>
                <SituacaoDoCaso value={caso.situacao} />
              </div>
            ))
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  hero = false,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  hero?: boolean;
}) {
  return (
    <Card className={`stat ${hero ? "hero-stat" : ""}`}>
      <div className="stat-head">
        <span>{title}</span>
        <div className="stat-icon">
          <Icon size={21} />
        </div>
      </div>
      <strong>{value.toLocaleString("pt-BR")}</strong>
      <small>{hero ? "Atendimentos aguardando chamada." : "Casos visiveis para sua unidade."}</small>
    </Card>
  );
}
