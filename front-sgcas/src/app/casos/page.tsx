"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ClipboardList, MapPinned } from "lucide-react";
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
import { Badge, Button, Card, DadosEmLista, EmptyState, Field, PageHeader, SecondaryButton, SectionHeading, Select, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { rotuloPrioridade, rotuloSituacao, tomDaPrioridade, tomDoCaso } from "@/lib/casos";
import { formatarData, formatarDataHora } from "@/lib/datas";
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

      {mensagem && <div className="notice mb-4" role="status">{mensagem}</div>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Em triagem" value={resumo.triagem.toLocaleString("pt-BR")} hint="Criados pela recepção, aguardando chamada." />
        <Stat label="Em atendimento" value={resumo.atendimento.toLocaleString("pt-BR")} hint="Já assumidos por um atendente." />
        <Stat label="Finalizados e encaminhados" value={resumo.finalizados.toLocaleString("pt-BR")} hint="Com relato ou desfecho registrado." />
      </div>

      <Card className="mt-4">
        <SectionHeading title="Lista de acompanhamentos" count={casos.length} />
        <p className="-mt-1 mb-4 text-sm text-meta-slate">
          Filtre por origem para separar os atendimentos da unidade dos casos de ações itinerantes.
        </p>

        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <Field label="Origem">
            <Select value={origem} onChange={(event) => alterarOrigem(event.target.value as OrigemFiltro)}>
              <option value="todos">Todos os acompanhamentos</option>
              <option value="sede">Atendimento na unidade</option>
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

        {casos.length === 0 ? (
          <EmptyState title="Sem acompanhamentos" text="Quando a recepção gerar uma senha, o caso aparece aqui." />
        ) : (
          <ul className="grid gap-2.5">
            {casos.map((caso) => (
              <li key={caso.id}>
                <button
                  type="button"
                  className="block w-full rounded-lg border border-meta-divider bg-white p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-meta-warm-gray focus-visible:border-primary sm:p-4"
                  onClick={() => setCasoSelecionado(caso)}
                >
                  <span className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
                    <span className="block min-w-0">
                      <span className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        <strong className="text-[15px] text-meta-charcoal">{caso.cidadao_nome}</strong>
                        <Badge tone={tomDoCaso(caso.situacao)}>{rotuloSituacao(caso.situacao)}</Badge>
                        <Badge tone={tomDaPrioridade(caso.prioridade)}>{rotuloPrioridade(caso.prioridade)}</Badge>
                        {caso.acao_itinerante && <Badge tone="neutral">Ação itinerante</Badge>}
                      </span>
                      <span className="block text-sm font-medium text-meta-charcoal">{caso.servico_nome || "Serviço não informado"}</span>
                      {caso.acao_itinerante && (
                        <span className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-primary">
                          <MapPinned size={14} aria-hidden="true" className="shrink-0" />
                          {caso.acao_itinerante_titulo || "Ação itinerante"}{caso.acao_itinerante_local ? ` · ${caso.acao_itinerante_local}` : ""}
                        </span>
                      )}
                      <span className="mt-1 line-clamp-2 text-sm leading-6 text-meta-slate">
                        {caso.descricao || "Sem observação registrada."}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-xs text-meta-slate lg:flex-col lg:items-end lg:gap-y-1">
                      <span className="inline-flex items-center gap-1.5">
                        <ClipboardList size={14} aria-hidden="true" />
                        {caso.protocolo}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock size={14} aria-hidden="true" />
                        {formatarDataHora(caso.aberto_em)}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
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

              <div className="grid gap-5">
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <h3 className="min-w-0 text-lg">{casoSelecionado.cidadao_nome}</h3>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={tomDoCaso(casoSelecionado.situacao)}>{rotuloSituacao(casoSelecionado.situacao)}</Badge>
                      <Badge tone={tomDaPrioridade(casoSelecionado.prioridade)}>{rotuloPrioridade(casoSelecionado.prioridade)}</Badge>
                    </div>
                  </div>

                  <DadosEmLista
                    itens={[
                      { rotulo: "Serviço solicitado", valor: casoSelecionado.servico_nome || "Serviço não informado" },
                      { rotulo: "Unidade", valor: casoSelecionado.unidade_nome },
                      ...(casoSelecionado.acao_itinerante
                        ? [{ rotulo: "Ação itinerante", valor: [casoSelecionado.acao_itinerante_titulo, casoSelecionado.acao_itinerante_local].filter(Boolean).join(" · ") || "Ação itinerante" }]
                        : []),
                      { rotulo: "Aberto em", valor: formatarDataHora(casoSelecionado.aberto_em) },
                      { rotulo: "Atendente ou técnico", valor: casoSelecionado.tecnico_nome || "Ainda não assumido" },
                      ...(casoSelecionado.fechado_em ? [{ rotulo: "Finalizado em", valor: formatarDataHora(casoSelecionado.fechado_em) }] : []),
                    ]}
                  />
                </div>

                <div className="rounded-lg border border-meta-divider bg-meta-warm-gray p-4">
                  <p className="text-[13px] font-semibold text-meta-slate">
                    {["CONCLUIDO", "ENCAMINHADO"].includes(casoSelecionado.situacao) ? "Relato e desfecho" : "Dados da triagem"}
                  </p>
                  <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-meta-charcoal">
                    {casoSelecionado.descricao || "Sem observação registrada."}
                  </p>
                </div>

                {!["CONCLUIDO", "CANCELADO", "ENCAMINHADO"].includes(casoSelecionado.situacao) && (
                  <form className="grid gap-4 border-t border-meta-divider pt-5" onSubmit={prepararConclusao}>
                    <div>
                      <h3>Registrar finalização</h3>
                      <p className="mt-1 text-sm leading-6 text-meta-slate">
                        Use quando o atendimento técnico terminar. O relato substitui a observação inicial do caso.
                        Para enviar a pessoa a outra unidade ou serviço, use Encaminhar na tela de Atendimento:
                        é lá que se preenche a ficha que a outra unidade vai ler.
                      </p>
                    </div>
                    <input type="hidden" name="situacao" value="CONCLUIDO" />
                    <Field label="Relato do atendimento">
                      <textarea
                        className="input"
                        name="relato"
                        required
                        placeholder="Informe o que foi atendido, a orientação dada, o encaminhamento ou o retorno combinado."
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
