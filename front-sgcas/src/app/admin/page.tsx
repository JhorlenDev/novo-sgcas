"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, ShieldAlert, UserCog, UsersRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, SectionHeading, Select, Stat } from "@/components/ui";
import { formatarDataCurta } from "@/lib/datas";
import { api } from "@/lib/api";
import type { Operador, Papel, Unidade } from "@/types/sgcas";

type Pedido = {
  id: string;
  nome: string;
  email: string;
  situacao: string;
  pedido_em: string;
};

const papeis: Array<{ value: Papel; label: string; hint: string }> = [
  { value: "RECEPCIONISTA", label: "Recepcionista", hint: "Balcão, busca cidadão e gera senha." },
  { value: "TECNICO", label: "Técnico", hint: "Chama fila e registra atendimento." },
  { value: "ASSISTENTE_SOCIAL", label: "Assistente social", hint: "Atendimento técnico/social." },
  { value: "COORDENADOR", label: "Coordenador", hint: "Acompanha unidade e equipe." },
  { value: "GESTOR_ACOES_ITINERANTES", label: "Gestor de ações", hint: "Ações itinerantes em campo." },
  { value: "VISUALIZADOR", label: "Visualizador", hint: "Somente consulta." },
  { value: "ADMIN", label: "Administrador", hint: "Acesso total ao sistema." },
];

export default function AdminPage() {
  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [mensagem, setMensagem] = useState("");

  async function carregar() {
    const [users, requests, units] = await Promise.all([
      api<Operador[]>("/users/").catch(() => []),
      api<Pedido[]>("/access-requests/").catch(() => []),
      api<Unidade[]>("/institutional/units").catch(() => []),
    ]);
    setOperadores(users);
    setPedidos(requests);
    setUnidades(units);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void carregar();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!mensagem) return;
    const timer = window.setTimeout(() => setMensagem(""), 4500);
    return () => window.clearTimeout(timer);
  }, [mensagem]);

  const resumo = useMemo(() => ({
    pendentes: pedidos.length,
    ativos: operadores.filter((operador) => operador.ativo).length,
    semUnidade: operadores.filter((operador) => operador.ativo && !operador.unidade).length,
  }), [operadores, pedidos]);

  async function aprovar(event: FormEvent<HTMLFormElement>, pedido: Pedido) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/access-requests/${pedido.id}/aprovar`, {
        method: "POST",
        body: JSON.stringify({
          papel: form.get("papel"),
          unidade_id: form.get("unidade_id") || null,
        }),
      });
      setMensagem("Pedido aprovado. O usuário deve entrar novamente para receber o novo perfil.");
      await carregar();
    } catch {
      setMensagem("Não foi possível aprovar o pedido.");
    }
  }

  async function atualizarOperador(event: FormEvent<HTMLFormElement>, operador: Operador) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const novoPapel = form.get("papel");
    try {
      if (novoPapel && novoPapel !== operador.papel) {
        await api(`/users/${operador.id}/perfil`, {
          method: "PUT",
          body: JSON.stringify({ papel: novoPapel }),
        });
      }

      await api(`/users/${operador.id}/atualizar`, {
        method: "PUT",
        body: JSON.stringify({
          nome: form.get("nome"),
          unidade_id: form.get("unidade_id") || null,
          ativo: form.get("ativo") === "on",
        }),
      });
      setMensagem(novoPapel !== operador.papel ? "Perfil e operador atualizados. O usuário deve entrar novamente." : "Operador atualizado.");
      await carregar();
    } catch {
      setMensagem("Não foi possível atualizar operador.");
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Usuários"
        description="Aprove solicitações, defina perfil, vincule unidade e acompanhe operadores cadastrados."
      />

      {mensagem && <div className="notice mb-4" role="status">{mensagem}</div>}

      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        <Stat label="Solicitações" value={resumo.pendentes.toLocaleString("pt-BR")} hint="Aguardando aprovação" icon={Clock3} highlight={resumo.pendentes > 0} />
        <Stat label="Operadores ativos" value={resumo.ativos.toLocaleString("pt-BR")} hint="Com acesso liberado" icon={UsersRound} />
        <Stat label="Sem unidade" value={resumo.semUnidade.toLocaleString("pt-BR")} hint="Precisam de lotação" icon={ShieldAlert} highlight={resumo.semUnidade > 0} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <SectionHeading title="Solicitações de acesso" count={pedidos.length} />
          <p className="-mt-1 mb-4 text-sm leading-6 text-meta-slate">Escolha o perfil e a unidade antes de aprovar.</p>

          {pedidos.length === 0 ? (
            <EmptyState title="Sem solicitações" text="Quando alguém entrar sem perfil no SGCAS, o pedido aparece aqui." />
          ) : (
            <div className="space-y-3">
              {pedidos.map((pedido) => (
                <form
                  className="rounded-lg border border-meta-divider bg-meta-warm-gray p-3 sm:p-4"
                  key={pedido.id}
                  onSubmit={(event) => void aprovar(event, pedido)}
                >
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block text-sm text-meta-charcoal">{pedido.nome}</strong>
                      <small className="block text-xs text-meta-slate">{pedido.email}</small>
                    </div>
                    <Badge tone="warn">{formatarDataCurta(pedido.pedido_em)}</Badge>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Perfil">
                      <Select name="papel" defaultValue="RECEPCIONISTA">
                        {papeis.map((papel) => (
                          <option key={papel.value} value={papel.value}>
                            {papel.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Unidade">
                      <Select name="unidade_id" defaultValue="">
                        <option value="">Sem unidade</option>
                        {unidades.map((unidade) => (
                          <option key={unidade.id} value={unidade.id}>{unidade.nome}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>

                  <p className="mt-3 text-xs leading-5 text-meta-slate">
                    Dica: recepcionista e técnico normalmente precisam estar vinculados a uma unidade.
                  </p>

                  <Button className="mt-3" size="sm">
                    <CheckCircle2 size={15} aria-hidden="true" />
                    Aprovar acesso
                  </Button>
                </form>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeading title="Operadores cadastrados" count={operadores.length} />
          <p className="-mt-1 mb-4 text-sm leading-6 text-meta-slate">Ajuste perfil, lotação e status. O perfil é atualizado no Keycloak.</p>

          {operadores.length === 0 ? (
            <EmptyState title="Nenhum operador" text="Os usuários aprovados aparecem aqui." />
          ) : (
            <div className="space-y-3">
              {operadores.map((operador) => (
                <form
                  className="rounded-lg border border-meta-divider bg-white p-3 sm:p-4"
                  key={operador.id}
                  onSubmit={(event) => void atualizarOperador(event, operador)}
                >
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block text-sm text-meta-charcoal">{operador.nome || operador.email}</strong>
                      <small className="block text-xs text-meta-slate">{operador.email}</small>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={operador.ativo ? "good" : "bad"}>{operador.ativo ? "Ativo" : "Inativo"}</Badge>
                      <Badge tone="neutral">{rotuloPapel(operador.papel)}</Badge>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Nome">
                      <Input name="nome" defaultValue={operador.nome} />
                    </Field>
                    <Field label="Perfil">
                      <Select name="papel" defaultValue={operador.papel}>
                        {papeis.map((papel) => (
                          <option key={papel.value} value={papel.value}>
                            {papel.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Unidade">
                      <Select name="unidade_id" defaultValue={operador.unidade?.id ?? ""}>
                        <option value="">Sem unidade</option>
                        {unidades.map((unidade) => (
                          <option key={unidade.id} value={unidade.id}>{unidade.nome}</option>
                        ))}
                      </Select>
                    </Field>
                    <label className="flex min-h-11 items-center gap-2.5 self-end rounded-lg border border-input bg-white px-3 text-sm font-medium text-meta-charcoal md:min-h-10">
                      <input name="ativo" type="checkbox" className="h-4 w-4 accent-primary" defaultChecked={operador.ativo} />
                      Operador ativo
                    </label>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs leading-5 text-meta-slate">{descricaoPapel(operador.papel)}</p>
                    <Button size="sm" type="submit">
                      <UserCog size={15} aria-hidden="true" />
                      Salvar
                    </Button>
                  </div>
                </form>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function rotuloPapel(papel: Papel) {
  return papeis.find((item) => item.value === papel)?.label ?? papel;
}

function descricaoPapel(papel: Papel) {
  return papeis.find((item) => item.value === papel)?.hint ?? "Perfil do operador.";
}
