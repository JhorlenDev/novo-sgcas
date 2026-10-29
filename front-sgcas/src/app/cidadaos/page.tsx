"use client";

import { ArrowRight, Search, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, Card, EmptyState, Input, PageHeader, SectionHeading } from "@/components/ui";
import { FormularioDeCadastro } from "@/components/cidadaos/formulario-de-cadastro";
import { api } from "@/lib/api";
import { formatCPF } from "@/lib/utils";
import type { CidadaoLista } from "@/types/sgcas";

export default function CidadaosPage() {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<CidadaoLista[]>([]);
  const [buscou, setBuscou] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const carregarCidadaos = useCallback(async (termo = "") => {
    setCarregando(true);
    const query = termo.trim() ? `?busca=${encodeURIComponent(termo.trim())}` : "";
    const data = await api<CidadaoLista[]>(`/citizens/${query}`).catch(() => []);
    setResultados(data);
    setBuscou(true);
    setCarregando(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void carregarCidadaos(busca);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [busca, carregarCidadaos]);

  return (
    <AppShell>
      <PageHeader
        title="Cidadãos"
        description="Busque por nome, CPF, NIS ou e-mail, ou abra um dos cadastros mais recentes."
        action={
          <Button type="button" onClick={() => setModalAberto(true)}>
            <UserPlus size={18} aria-hidden="true" />
            Novo cadastro
          </Button>
        }
      />

      <Card>
        <div className="relative mb-5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta-slate" aria-hidden="true" />
          <Input
            type="search"
            className="pl-10"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Digite nome, CPF, NIS ou e-mail"
            aria-label="Buscar cidadão por nome, CPF, NIS ou e-mail"
          />
        </div>

        <SectionHeading
          icon={Users}
          title={busca.trim() && buscou ? "Resultado da busca" : "Cidadãos recentes"}
          action={carregando ? <span className="text-sm text-meta-slate" role="status">Carregando...</span> : undefined}
        />

        {resultados.length > 0 && (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>CPF</th>
                  <th>Bairro e cidade</th>
                  <th><span className="sr-only">Ação</span></th>
                </tr>
              </thead>
              <tbody>
                {resultados.map((cidadao) => (
                  <tr className="clickable-row" key={cidadao.id} onClick={() => router.push(`/cidadaos/${cidadao.id}`)}>
                    <td data-label="Nome">
                      <strong>{cidadao.nome}</strong>
                    </td>
                    <td data-label="CPF" className="tabular-nums">
                      {cidadao.cpf ? formatCPF(cidadao.cpf) : <span className="text-meta-slate">Não informado</span>}
                    </td>
                    <td data-label="Bairro e cidade">
                      {[cidadao.bairro, cidadao.cidade].filter(Boolean).join(" · ") || <span className="text-meta-slate">Não informado</span>}
                    </td>
                    <td className="md:w-px md:whitespace-nowrap md:text-right">
                      <Link
                        href={`/cidadaos/${cidadao.id}`}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Abrir cadastro de ${cidadao.nome}`}
                        className="button secondary sm"
                      >
                        Abrir cadastro
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!carregando && buscou && resultados.length === 0 && (
          <EmptyState
            title={busca.trim() ? "Nada encontrado" : "Nenhum cidadão cadastrado"}
            text={busca.trim() ? "Confira o dado informado ou crie um novo cadastro." : "Quando houver cadastros, eles aparecem aqui automaticamente."}
          />
        )}
      </Card>

      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cadastrar novo cidadão</DialogTitle>
            <DialogDescription>
              Informe os dados essenciais para identificar o cidadão e seguir com o atendimento.
            </DialogDescription>
          </DialogHeader>

          <FormularioDeCadastro
            onCancelar={() => setModalAberto(false)}
            onSalvo={(cidadao) => {
              setModalAberto(false);
              router.push(`/cidadaos/${cidadao.id}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
