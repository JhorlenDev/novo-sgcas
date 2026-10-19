"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, ClipboardList, MapPin, MapPinned, Stethoscope } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge, Button, Card, EmptyState, Field, PageHeader, SecondaryButton, Select } from "@/components/ui";
import { api } from "@/lib/api";
import type { AcaoItinerante, Caso } from "@/types/sgcas";

type OrigemFiltro = "todos" | "sede" | "itinerante";

export default function CasosPage() {
  const [casos, setCasos] = useState<Caso[]>([]);
  const [acoes, setAcoes] = useState<AcaoItinerante[]>([]);
  const [origem, setOrigem] = useState<OrigemFiltro>("todos");
  const [acaoSelecionada, setAcaoSelecionada] = useState("");
  const [casoSelecionado, setCasoSelecionado] = useState<Caso | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [conclusao, setConclusao] = useState<{ situacao: FormDataEntryValue | null; relato: FormDataEntryValue | null } | null>(null);

  const carregar = useCallback(async () => {
    const params = new URLSearchParams();
    if (origem !== "todos") params.set("origem", origem);
    if (acaoSelecionada) params.set("acao_itinerante", acaoSelecionada);
    const query = params.toString();
    const data = await api<Caso[]>(`/cases/${query ? `?${query}` : ""}`).catch(() => []);
    setCasos(data);
  }, [acaoSelecionada, origem]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void carregar();
      void api<AcaoItinerante[]>("/acoes-itinerantes/?compacto=1").then(setAcoes).catch(() => setAcoes([]));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [carregar]);

  function alterarOrigem(valor: OrigemFiltro) {
    setOrigem(valor);
    if (valor !== "itinerante") setAcaoSelecionada("");
  }

  const resumo = useMemo(() => ({
    triagem: casos.filter((caso) => caso.situacao === "EM_TRIAGEM").length,
    atendimento: casos.filter((caso) => caso.situacao === "EM_ATENDIMENTO").length,
    finalizados: casos.filter((caso) => ["CONCLUIDO", "ENCAMINHADO"].includes(caso.situacao)).length,
  }), [casos]);

  function prepararConclusao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!casoSelecionado) return;

    const form = new FormData(event.currentTarget);
    setConclusao({
      situacao: form.get("situacao"),
      relato: form.get("relato"),
    });
    setConfirmOpen(true);
  }

  async function concluir() {
    if (!casoSelecionado || !conclusao) return;
    setSalvando(true);
    try {
      await api(`/cases/${casoSelecionado.id}/concluir`, {
        method: "POST",
        body: JSON.stringify({
          situacao: conclusao.situacao,
          relato: conclusao.relato,
        }),
      });
      setMensagem("Acompanhamento atualizado.");
      setCasoSelecionado(null);
      setConclusao(null);
      setConfirmOpen(false);
      await carregar();
    } catch {
      setMensagem("Não foi possível concluir o acompanhamento.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Acompanhamentos"
        description="Consulte o caso, veja em que etapa ele está e registre o desfecho quando o atendimento terminar."
      />

      {mensagem && <div className="notice">{mensagem}</div>}
      <div style={{ height: 16 }} />

      <div className="grid gap-4 md:grid-cols-3">
        <ResumoCard title="Em triagem" value={resumo.triagem} text="Criados pela recepção e aguardando chamada." tone="warn" />
        <ResumoCard title="Em atendimento" value={resumo.atendimento} text="Já assumidos por um atendente." tone="bad" />
        <ResumoCard title="Finalizados/encaminhados" value={resumo.finalizados} text="Casos com relato ou desfecho registrado." tone="good" />
      </div>

      <div style={{ height: 16 }} />

      <Card>
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="!mb-0">Lista de acompanhamentos</h2>
              <Badge tone="neutral">{casos.length}</Badge>
            </div>
            <p className="mt-1 text-sm text-meta-slate">Filtre por origem para separar atendimentos da sede e casos de ações itinerantes.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:w-[520px]">
            <Field label="Origem">
              <Select value={origem} onChange={(event) => alterarOrigem(event.target.value as OrigemFiltro)}>
                <option value="todos">Todos os acompanhamentos</option>
                <option value="sede">Atendimento na sede/unidade</option>
                <option value="itinerante">Ações itinerantes</option>
              </Select>
            </Field>
            <Field label="Ação itinerante">
              <Select
                value={acaoSelecionada}
                disabled={origem !== "itinerante"}
                onChange={(event) => setAcaoSelecionada(event.target.value)}
              >
                <option value="">Todas as ações</option>
                {acoes.map((acao) => (
                  <option key={acao.id} value={acao.id}>
                    {acao.titulo} · {formatarData(acao.data)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        {casos.length === 0 ? (
          <EmptyState title="Sem acompanhamentos" text="Quando a recepção gerar uma senha, o caso aparece aqui." />
        ) : (
          <div className="grid gap-3">
            {casos.map((caso) => (
              <button
                className="rounded-feature border border-meta-divider bg-white p-4 text-left shadow-lift transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-meta-warm-gray"
                key={caso.id}
                onClick={() => setCasoSelecionado(caso)}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <strong className="text-meta-charcoal">{caso.cidadao_nome}</strong>
                      <Badge tone={tomDoCaso(caso.situacao)}>{rotuloSituacao(caso.situacao)}</Badge>
                      <Badge tone={tomDaPrioridade(caso.prioridade)}>{rotuloPrioridade(caso.prioridade)}</Badge>
                      {caso.acao_itinerante && <Badge tone="neutral">Ação itinerante</Badge>}
                    </div>
                    <p className="text-sm font-medium text-meta-charcoal">{caso.servico_nome || "Serviço não informado"}</p>
                    {caso.acao_itinerante && (
                      <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                        <MapPinned size={14} />
                        {caso.acao_itinerante_titulo || "Ação itinerante"}{caso.acao_itinerante_local ? ` · ${caso.acao_itinerante_local}` : ""}
                      </p>
                    )}
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-meta-slate">
                      {caso.descricao || "Sem observação registrada."}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 text-xs text-meta-slate">
                    <span className="inline-flex items-center gap-1.5 rounded-pill bg-meta-soft-gray px-3 py-1.5">
                      <ClipboardList size={14} />
                      {caso.protocolo}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-pill bg-meta-soft-gray px-3 py-1.5">
                      <CalendarClock size={14} />
                      {formatarDataHora(caso.aberto_em)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={Boolean(casoSelecionado)} onOpenChange={(open) => !open && setCasoSelecionado(null)}>
        <DialogContent className="max-w-3xl">
          {casoSelecionado && (
            <>
              <DialogHeader>
                <DialogTitle>Acompanhamento {casoSelecionado.protocolo}</DialogTitle>
                <DialogDescription>{textoPorSituacao(casoSelecionado)}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-4">
                <div className="rounded-feature border border-meta-divider bg-meta-warm-gray p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">Cidadão</p>
                      <h3 className="mt-1 text-xl font-medium text-meta-charcoal">{casoSelecionado.cidadao_nome}</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={tomDoCaso(casoSelecionado.situacao)}>{rotuloSituacao(casoSelecionado.situacao)}</Badge>
                      <Badge tone={tomDaPrioridade(casoSelecionado.prioridade)}>{rotuloPrioridade(casoSelecionado.prioridade)}</Badge>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Info icon={ClipboardList} label="Serviço solicitado" value={casoSelecionado.servico_nome || "Serviço não informado"} />
                    <Info icon={MapPin} label="Unidade" value={casoSelecionado.unidade_nome} />
                    {casoSelecionado.acao_itinerante && (
                      <Info icon={MapPinned} label="Ação itinerante" value={[casoSelecionado.acao_itinerante_titulo, casoSelecionado.acao_itinerante_local].filter(Boolean).join(" · ") || "Ação itinerante"} />
                    )}
                    <Info icon={CalendarClock} label="Aberto em" value={formatarDataHora(casoSelecionado.aberto_em)} />
                    <Info icon={Stethoscope} label="Atendente/técnico" value={casoSelecionado.tecnico_nome || "Ainda não assumido"} />
                    {casoSelecionado.fechado_em && (
                      <Info icon={CheckCircle2} label="Finalizado em" value={formatarDataHora(casoSelecionado.fechado_em)} />
                    )}
                  </div>
                </div>

                <div className="rounded-feature border border-meta-divider bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">
                    {["CONCLUIDO", "ENCAMINHADO"].includes(casoSelecionado.situacao) ? "Relato/desfecho" : "Dados da triagem"}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-meta-charcoal">
                    {casoSelecionado.descricao || "Sem observação registrada."}
                  </p>
                </div>

                {!["CONCLUIDO", "CANCELADO", "ENCAMINHADO"].includes(casoSelecionado.situacao) && (
                  <form className="grid gap-4 rounded-feature border border-meta-divider bg-meta-soft-gray p-5" onSubmit={prepararConclusao}>
                    <div>
                      <h3>Registrar finalização</h3>
                      <p className="mt-1 text-sm leading-6 text-meta-slate">
                        Use quando o atendimento técnico terminar. O relato substitui a observação inicial do caso.
                      </p>
                    </div>
                    <Field label="Situação final">
                      <Select name="situacao" defaultValue="CONCLUIDO">
                        <option value="CONCLUIDO">Concluído</option>
                        <option value="ENCAMINHADO">Encaminhado</option>
                      </Select>
                    </Field>
                    <Field label="Relato do atendimento">
                      <textarea
                        className="input"
                        name="relato"
                        required
                        placeholder="Informe o que foi atendido, orientação dada, encaminhamento ou retorno combinado."
                      />
                    </Field>
                    <DialogFooter>
                      <SecondaryButton type="button" onClick={() => setCasoSelecionado(null)}>
                        Fechar
                      </SecondaryButton>
                      <Button>Salvar atendimento</Button>
                    </DialogFooter>
                  </form>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Salvar atendimento?"
        description="Confirme para registrar o relato e atualizar a situação do acompanhamento."
        confirmLabel="Salvar atendimento"
        cancelLabel="Revisar"
        onConfirm={() => void concluir()}
        isLoading={salvando}
      />
    </AppShell>
  );
}

function ResumoCard({
  title,
  value,
  text,
  tone,
}: {
  title: string;
  value: number;
  text: string;
  tone: "good" | "warn" | "bad";
}) {
  return (
    <Card className="!p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">{title}</p>
          <strong className="mt-2 block text-3xl text-meta-charcoal">{value.toLocaleString("pt-BR")}</strong>
          <small className="mt-1 block text-meta-slate">{text}</small>
        </div>
        <Badge tone={tone}>{rotuloTom(tone)}</Badge>
      </div>
    </Card>
  );
}

function Info({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-card bg-white p-4">
      <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">
        <Icon size={14} />
        {label}
      </p>
      <strong className="mt-2 block text-sm text-meta-charcoal">{value}</strong>
    </div>
  );
}

function textoPorSituacao(caso: Caso) {
  if (caso.situacao === "EM_TRIAGEM") {
    return "Este caso nasceu na recepção e ainda aguarda atendimento. Confira serviço, prioridade e observação da triagem.";
  }
  if (caso.situacao === "EM_ATENDIMENTO") {
    return "Este caso já foi chamado e está em atendimento. Confira quem assumiu e registre o desfecho ao finalizar.";
  }
  if (caso.situacao === "CONCLUIDO") {
    return "Este acompanhamento foi finalizado. Abaixo aparecem o relato, local e datas do atendimento.";
  }
  if (caso.situacao === "ENCAMINHADO") {
    return "Este acompanhamento foi encaminhado. Confira o relato e a unidade responsável.";
  }
  return "Confira os dados do acompanhamento.";
}

function formatarDataHora(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatarData(value: string) {
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

function rotuloSituacao(value: string) {
  const labels: Record<string, string> = {
    EM_TRIAGEM: "Em triagem",
    EM_ATENDIMENTO: "Em atendimento",
    CONCLUIDO: "Finalizado",
    ENCAMINHADO: "Encaminhado",
    CANCELADO: "Cancelado",
  };
  return labels[value] ?? value;
}

function rotuloPrioridade(value: string) {
  const labels: Record<string, string> = {
    BAIXA: "Baixa",
    NORMAL: "Normal",
    ALTA: "Alta",
    URGENTE: "Urgente",
  };
  return labels[value] ?? value;
}

function tomDaPrioridade(value: string): "neutral" | "good" | "warn" | "bad" {
  if (value === "URGENTE") return "bad";
  if (value === "ALTA") return "warn";
  if (value === "BAIXA") return "good";
  return "neutral";
}

function tomDoCaso(value: string): "neutral" | "good" | "warn" | "bad" {
  if (value === "CONCLUIDO") return "good";
  if (value === "CANCELADO") return "neutral";
  if (value === "EM_ATENDIMENTO") return "bad";
  if (value === "EM_TRIAGEM") return "warn";
  return "neutral";
}

function rotuloTom(tone: "good" | "warn" | "bad") {
  return {
    good: "OK",
    warn: "Atenção",
    bad: "Ativo",
  }[tone];
}
