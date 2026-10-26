"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowLeftRight,
  IdCard,
  UserRound,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Headset,
  ListChecks,
  MapPin,
  Search,
  Send,
  ShieldAlert,
  Stethoscope,
  UserPlus,
  UserRoundCheck,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge, Button, Card, EmptyState, Field, Input, SecondaryButton, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { formatCPF } from "@/lib/utils";
import type { AtendimentoRecepcao, Caso, CidadaoLista, EntradaHistorico, PainelRecepcao, Senha, Servico } from "@/types/sgcas";

type HistoricoResponse = {
  cidadao: CidadaoLista;
  entradas: EntradaHistorico[];
};

type ResultadoAtendimento = {
  desfecho: "ENCAMINHADO" | "FINALIZADO";
  caso: Caso | null;
  senha: { senha: string; servico?: string | null } | null;
};

type AcaoAtendimento = "FINALIZADO" | "ENCAMINHADO";
type AbaRecepcao = "nova" | "recentes" | "fila";

export default function RecepcaoPage() {
  const [aba, setAba] = useState<AbaRecepcao>("nova");
  const [busca, setBusca] = useState("");
  const [cidadaos, setCidadaos] = useState<CidadaoLista[]>([]);
  const [cidadao, setCidadao] = useState<CidadaoLista | null>(null);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [casos, setCasos] = useState<Caso[]>([]);
  const [historico, setHistorico] = useState<EntradaHistorico[]>([]);
  const [ultimosAtendimentos, setUltimosAtendimentos] = useState<AtendimentoRecepcao[]>([]);
  const [painel, setPainel] = useState<PainelRecepcao | null>(null);
  const [fila, setFila] = useState<Senha[]>([]);
  const [servicoId, setServicoId] = useState("");
  const [prioridade, setPrioridade] = useState("NORMAL");
  const [observacao, setObservacao] = useState("");
  const [motivo, setMotivo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [avisoOpen, setAvisoOpen] = useState(false);
  const [acaoOpen, setAcaoOpen] = useState(false);
  const [acao, setAcao] = useState<AcaoAtendimento>("ENCAMINHADO");
  const [successOpen, setSuccessOpen] = useState(false);
  const [resultado, setResultado] = useState<ResultadoAtendimento | null>(null);

  useEffect(() => {
    void api<Servico[]>("/institutional/services?unidade=todas").then(setServicos).catch(() => setServicos([]));
    void carregarUltimosAtendimentos();
    void carregarPainel();
    void carregarFila();
  }, []);

  async function carregarUltimosAtendimentos() {
    const data = await api<AtendimentoRecepcao[]>("/reception/atendimentos").catch(() => []);
    setUltimosAtendimentos(data);
  }

  async function carregarPainel() {
    const data = await api<PainelRecepcao>("/reception/painel").catch(() => null);
    setPainel(data);
    if (data?.ultimos_atendimentos) {
      setUltimosAtendimentos(data.ultimos_atendimentos);
    }
  }

  async function carregarFila() {
    const data = await api<Senha[]>("/queues/").catch(() => []);
    setFila(data);
  }

  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) {
      return;
    }

    const timer = window.setTimeout(() => {
      void api<CidadaoLista[]>(`/citizens/?busca=${encodeURIComponent(termo)}`)
        .then(setCidadaos)
        .catch(() => setCidadaos([]));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [busca]);

  async function selecionarCidadao(selecionado: CidadaoLista) {
    setCidadao(selecionado);
    setBusca(selecionado.nome);
    setCidadaos([]);
    setMensagem("");
    setServicoId("");
    setPrioridade("NORMAL");
    setObservacao("");
    setMotivo("");

    await carregarDadosDoCidadao(selecionado);
    setAvisoOpen(true);
  }

  async function carregarDadosDoCidadao(selecionado: CidadaoLista) {
    const [historicoData, casosData] = await Promise.all([
      api<HistoricoResponse>(`/citizens/${selecionado.id}/historico`).catch(() => ({ cidadao: selecionado, entradas: [] })),
      api<Caso[]>(`/cases/?cidadao=${selecionado.id}`).catch(() => []),
    ]);

    setHistorico(historicoData.entradas);
    setCasos(casosData);
  }

  const servicoSelecionado = useMemo(
    () => servicos.find((servico) => servico.id === servicoId) ?? null,
    [servicoId, servicos],
  );

  const casosParecidos = useMemo(() => {
    if (!servicoSelecionado) return casos.filter((caso) => caso.situacao !== "CONCLUIDO");

    const termoServico = normalizar(servicoSelecionado.nome);
    const termoCategoria = normalizar(servicoSelecionado.demanda_nome ?? "");

    return casos.filter((caso) => {
      if (caso.situacao !== "CONCLUIDO") return true;
      const texto = normalizar(`${caso.descricao ?? ""} ${caso.situacao}`);
      return Boolean(termoServico && texto.includes(termoServico)) || Boolean(termoCategoria && texto.includes(termoCategoria));
    });
  }, [casos, servicoSelecionado]);

  function abrirAcao(proximaAcao: AcaoAtendimento) {
    setAcao(proximaAcao);
    setMensagem("");
    setAcaoOpen(true);
  }

  async function registrar(desfecho: AcaoAtendimento) {
    if (!cidadao || !servicoSelecionado) return;

    setRegistrando(true);
    setMensagem("");

    const motivoLimpo = motivo.trim();
    const observacaoLimpa = observacao.trim();

    try {
      const data = await api<ResultadoAtendimento>("/reception/atendimento", {
        method: "POST",
        body: JSON.stringify({
          cidadao_id: cidadao.id,
          servico_id: servicoSelecionado.id,
          unidade_destino_id: servicoSelecionado.unidade,
          desfecho,
          prioridade,
          motivo: motivoLimpo || (desfecho === "FINALIZADO" ? "Atendimento encerrado na recepção após verificação de caso/histórico existente." : ""),
          observacao: observacaoLimpa || `Solicitação registrada pela recepção: ${servicoSelecionado.nome}.`,
        }),
      });

      setResultado(data);
      setSuccessOpen(true);
      setAcaoOpen(false);
      setServicoId("");
      setPrioridade("NORMAL");
      setObservacao("");
      setMotivo("");
      await carregarUltimosAtendimentos();
      await carregarPainel();
      await carregarFila();
      await carregarDadosDoCidadao(cidadao);
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : "Não foi possível registrar o atendimento.");
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-5">
        <PainelResumoRecepcao painel={painel} />
      </div>

      <div className="mb-5 flex flex-wrap gap-2 rounded-card border border-meta-divider bg-white p-2 shadow-lift">
        <AbaButton active={aba === "nova"} onClick={() => {
          setAba("nova");
          window.requestAnimationFrame(() => {
            const input = document.getElementById("busca-cidadao-recepcao");
            input?.focus({ preventScroll: true });
            input?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        }}>
          <Search size={17} />
          Buscar cidadão
        </AbaButton>
        <AbaButton active={aba === "recentes"} onClick={() => setAba("recentes")}>
          <Clock3 size={17} />
          Atendimentos recentes
          <Badge tone="neutral">{ultimosAtendimentos.length}</Badge>
        </AbaButton>
        <AbaButton active={aba === "fila"} onClick={() => {
          setAba("fila");
          void carregarFila();
        }}>
          <ListChecks size={17} />
          Fila
          <Badge tone={fila.length ? "warn" : "good"}>{fila.length}</Badge>
        </AbaButton>
      </div>

      <div className="grid gap-5">
        {aba === "nova" && (
          <>
            <Card className="border-primary/25">
              <div className="mb-4 flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-primary/10 text-primary"><Search size={22} /></span>
                <div>
                  <h2 className="!mb-1">Quem você vai atender?</h2>
                  <p className="text-sm text-meta-slate">Primeiro, encontre o cidadão. Depois, confira o histórico e escolha como registrar a recepção.</p>
                </div>
              </div>
              <label htmlFor="busca-cidadao-recepcao" className="mb-2 block text-sm font-semibold text-meta-charcoal">Buscar por nome, CPF, NIS ou e-mail</label>
              <div className="relative mb-5">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta-slate" />
                <Input
                  id="busca-cidadao-recepcao"
                  className="!h-12 pl-10"
                  value={busca}
                  onChange={(event) => {
                    const value = event.target.value;
                    setBusca(value);
                    setCidadao(null);
                    setCasos([]);
                    setHistorico([]);
                    if (value.trim().length < 2) {
                      setCidadaos([]);
                    }
                  }}
                  placeholder="Nome, CPF, NIS ou e-mail"
                />
              </div>

              {!cidadao && busca.trim().length < 2 && (
                <p className="mb-4 text-sm text-meta-slate">Digite pelo menos 2 caracteres e selecione o cidadão nos resultados.</p>
              )}

              {!cidadao && cidadaos.map((item) => (
                <button type="button" className="group mb-3 flex w-full flex-col gap-3 rounded-card border border-meta-divider bg-white p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:flex-row sm:items-center sm:justify-between" key={item.id} onClick={() => void selecionarCidadao(item)} aria-label={`Selecionar ${item.nome}`}>
                  <span className="flex min-w-0 items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound size={22} aria-hidden="true" /></span>
                    <span className="min-w-0">
                      <strong className="block break-words text-base font-semibold text-meta-charcoal">{item.nome}</strong>
                      <DadosCidadao cidadao={item} />
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center justify-center gap-2 self-end rounded-pill bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-colors group-hover:bg-primary group-hover:text-white sm:self-center">
                    Selecionar <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </button>
              ))}

              {!cidadao && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-meta-divider pt-4 text-sm text-meta-slate">
                  <span>Não encontrou o cidadão?</span>
                  <Link href="/cidadaos/novo" className="inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline">
                    <UserPlus size={16} /> Cadastrar cidadão
                  </Link>
                </div>
              )}

              {cidadao && <CidadaoSelecionado cidadao={cidadao} onTrocar={() => setCidadao(null)} />}
            </Card>

            {cidadao && (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
                <Card className="min-w-0">
                  <PainelDoCidadao casos={casos} historico={historico} />
                </Card>

                <Card className="h-fit !p-4">
                  <div className="mb-3">
                    <h2 className="!mb-1 !text-base">Atendimento</h2>
                    <p className="text-xs leading-5 text-meta-slate">Escolha o desfecho da recepção.</p>
                  </div>
                  <div className="grid gap-2.5">
                    {mensagem && <div className="notice">{mensagem}</div>}

                    <button
                      type="button"
                      className="rounded-2xl border border-primary/15 bg-primary/5 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:shadow-lift"
                      onClick={() => abrirAcao("ENCAMINHADO")}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-primary text-white shadow-sm">
                          <Send size={15} />
                        </span>
                        <div className="min-w-0">
                          <strong className="block text-[13px] font-semibold text-meta-charcoal">Iniciar atendimento</strong>
                          <small className="block text-[11px] leading-4 text-meta-slate">Cria caso e senha.</small>
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="rounded-2xl border border-meta-divider bg-white p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:bg-meta-soft-gray"
                      onClick={() => abrirAcao("FINALIZADO")}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-primary/10 text-primary">
                          <CheckCircle2 size={15} />
                        </span>
                        <div className="min-w-0">
                          <strong className="block text-[13px] font-semibold text-meta-charcoal">Finalizar na recepção</strong>
                          <small className="block text-[11px] leading-4 text-meta-slate">Registra orientação.</small>
                        </div>
                      </div>
                    </button>
                  </div>
                </Card>
              </div>
            )}
          </>
        )}

        {aba === "recentes" && <UltimosAtendimentos atendimentos={ultimosAtendimentos} completo />}

        {aba === "fila" && <FilaSomenteLeitura fila={fila} onAtualizar={() => void carregarFila()} />}

      </div>

      <Dialog open={acaoOpen} onOpenChange={setAcaoOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{acao === "ENCAMINHADO" ? "Iniciar atendimento" : "Finalizar na recepção"}</DialogTitle>
            <DialogDescription>
              {acao === "ENCAMINHADO"
                ? "Selecione o serviço e registre a solicitação. O sistema cria o caso e gera a senha."
                : "Use quando a orientação no balcão resolve a demanda ou já existe caso em acompanhamento."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <Field label="Serviço solicitado">
              <Select value={servicoId} onChange={(event) => setServicoId(event.target.value)} required>
                <option value="">Selecione o serviço</option>
                {servicos.map((servico) => (
                  <option key={servico.id} value={servico.id}>
                    {servico.nome} — {servico.unidade_nome}
                  </option>
                ))}
              </Select>
            </Field>

            {acao === "ENCAMINHADO" && (
              <Field label="Prioridade na fila">
                <Select value={prioridade} onChange={(event) => setPrioridade(event.target.value)} required>
                  <option value="BAIXA">Baixa</option>
                  <option value="NORMAL">Normal</option>
                  <option value="ALTA">Alta</option>
                  <option value="URGENTE">Urgente</option>
                </Select>
              </Field>
            )}

            {servicoSelecionado && casosParecidos.length > 0 && (
              <div className="rounded-feature border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <div className="row">
                  <AlertTriangle size={18} />
                  <strong>Possível duplicidade</strong>
                </div>
                <p className="mt-2 text-sm leading-6">
                  Há caso ou atendimento recente. Se for a mesma demanda, finalize na recepção.
                </p>
              </div>
            )}

            <Field label={acao === "ENCAMINHADO" ? "Observação para o atendimento" : "Observação"}>
              <textarea
                className="input"
                value={observacao}
                onChange={(event) => setObservacao(event.target.value)}
                placeholder="Resumo do que o cidadão solicitou"
              />
            </Field>

            {acao === "FINALIZADO" && (
              <Field label="Motivo da finalização">
                <textarea
                  className="input"
                  value={motivo}
                  onChange={(event) => setMotivo(event.target.value)}
                  placeholder="Ex.: já existe caso aberto, orientação resolvida no balcão..."
                />
              </Field>
            )}

            {mensagem && <div className="notice">{mensagem}</div>}
          </div>

          <DialogFooter>
            <SecondaryButton type="button" onClick={() => setAcaoOpen(false)} disabled={registrando}>
              Cancelar
            </SecondaryButton>
            <Button type="button" disabled={!servicoSelecionado || registrando} onClick={() => void registrar(acao)}>
              {acao === "ENCAMINHADO" ? (
                <>
                  <Send size={18} />
                  {registrando ? "Gerando..." : "Criar caso e gerar senha"}
                </>
              ) : (
                <>
                  <CheckCircle2 size={18} />
                  {registrando ? "Salvando..." : "Finalizar atendimento"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={avisoOpen} onOpenChange={setAvisoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pergunte o que o cidadão deseja</DialogTitle>
            <DialogDescription>
              Confira casos e atendimentos recentes. Se for uma nova demanda, inicie atendimento; se já existir acompanhamento, finalize na recepção.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAvisoOpen(false)}>Começar atendimento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{resultado?.desfecho === "ENCAMINHADO" ? "Caso enviado para fila" : "Atendimento finalizado"}</DialogTitle>
            <DialogDescription>
              {resultado?.senha
                ? `Senha gerada: ${resultado.senha.senha}. O cidadão já aparece na fila da unidade.`
                : "O atendimento foi registrado no histórico do cidadão."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {resultado?.senha && (
              <Link href="/fila">
                <SecondaryButton>Ver fila</SecondaryButton>
              </Link>
            )}
            <Button onClick={() => setSuccessOpen(false)}>Entendi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function AbaButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-2 rounded-pill px-4 py-2 text-sm font-semibold transition-all ${
        active
          ? "bg-primary text-primary-foreground shadow-lift"
          : "bg-meta-soft-gray text-meta-charcoal hover:bg-meta-warm-gray"
      }`}
    >
      {children}
    </button>
  );
}

function PainelResumoRecepcao({ painel }: { painel: PainelRecepcao | null }) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-card border border-meta-divider bg-white p-2 sm:grid-cols-5" aria-label="Resumo da recepção">
      <MiniStat
        title="Atendidos hoje"
        value={painel?.atendimentos_hoje ?? 0}
        detail="Passagens registradas no balcão"
        icon={Headset}
        tone="primary"
      />
      <MiniStat
        title="Aguardando"
        value={painel?.aguardando_na_fila ?? 0}
        detail="Senhas esperando chamada"
        icon={ListChecks}
        tone="warn"
      />
      <MiniStat
        title="Em atendimento"
        value={painel?.em_atendimento ?? 0}
        detail="Já chamados pela equipe"
        icon={Stethoscope}
        tone="neutral"
      />
      <MiniStat
        title="Finalizados"
        value={painel?.finalizados_no_balcao ?? 0}
        detail="Resolvidos na recepção"
        icon={CheckCircle2}
        tone="good"
      />
      <MiniStat
        title="Geraram senha"
        value={painel?.encaminhados_para_fila ?? 0}
        detail="Encaminhados hoje"
        icon={Send}
        tone="bad"
      />
    </div>
  );
}

function MiniStat({
  title,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number;
  detail: string;
  icon: React.ElementType;
  tone: "primary" | "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    neutral: "bg-meta-soft-gray text-meta-charcoal",
    good: "bg-success/10 text-success",
    warn: "bg-warning/20 text-[#8a5a00]",
    bad: "bg-destructive/10 text-destructive",
  }[tone];

  return (
    <div className="min-w-0 rounded-lg bg-meta-soft-gray/60 px-3 py-3" title={detail}>
      <div className="mb-2 flex items-center gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toneClass}`}>
          <Icon size={20} aria-hidden="true" />
        </span>
        <strong className="text-3xl leading-none tabular-nums text-meta-charcoal">{value.toLocaleString("pt-BR")}</strong>
      </div>
      <p className="text-sm font-semibold leading-5 text-meta-slate">{title}</p>
      <span className="sr-only">{detail}</span>
    </div>
  );
}

function PainelDoCidadao({ casos, historico }: { casos: Caso[]; historico: EntradaHistorico[] }) {
  const casosAbertos = casos.filter((caso) => !["CONCLUIDO", "CANCELADO"].includes(caso.situacao));
  const ultimoContato = historico[0]?.quando;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="!mb-1 !text-lg">Histórico para decisão</h2>
          <p className="text-xs leading-5 text-meta-slate">
            Confira se já existe atendimento parecido antes de criar nova senha.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={casosAbertos.length ? "warn" : "good"}>
            {casosAbertos.length ? `${casosAbertos.length} caso(s) aberto(s)` : "Sem caso aberto"}
          </Badge>
          <Badge tone={ultimoContato ? "neutral" : "good"}>
            {ultimoContato ? `Último contato ${formatarDataCurta(ultimoContato)}` : "Sem histórico recente"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.05fr]">
        <CasosRecentes casos={casos} />
        <HistoricoAtendimentos historico={historico} />
      </div>
    </div>
  );
}

function CasosRecentes({ casos }: { casos: Caso[] }) {
  return (
    <div className="rounded-card border border-meta-divider bg-white p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="row !justify-start">
          <span className="flex h-9 w-9 items-center justify-center rounded-pill bg-primary/10 text-primary">
            <ClipboardList size={17} />
          </span>
          <h3 className="text-sm font-semibold text-meta-charcoal">Casos recentes</h3>
        </div>
        <Badge tone="neutral">{casos.length}</Badge>
      </div>

      {casos.length === 0 ? (
        <EmptyState title="Nenhum caso recente" text="Se a demanda for nova, inicie atendimento e gere a senha." />
      ) : (
        <div className="space-y-2.5">
          {casos.slice(0, 6).map((caso) => (
            <article
              className="rounded-card border border-meta-divider bg-meta-warm-gray p-3.5 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-white hover:shadow-lift"
              key={caso.id}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-meta-slate">Caso {caso.protocolo}</p>
                  <strong className="mt-1 block text-sm text-meta-charcoal">{caso.servico_nome || "Serviço não informado"}</strong>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={tomDoCaso(caso.situacao)}>{rotuloSituacao(caso.situacao)}</Badge>
                  <Badge tone={tomDaPrioridade(caso.prioridade)}>{rotuloPrioridade(caso.prioridade)}</Badge>
                </div>
              </div>

              <p className="text-xs leading-5 text-meta-charcoal">{caso.descricao || "Sem observação registrada."}</p>

              <div className="mt-3 grid gap-2 text-xs text-meta-slate sm:grid-cols-2">
                <span className="inline-flex items-center gap-2">
                  <MapPin size={14} />
                  {caso.unidade_nome}
                </span>
                <span className="inline-flex items-center gap-2">
                  <Clock3 size={14} />
                  Aberto em {formatarDataHora(caso.aberto_em)}
                </span>
                {caso.tecnico_nome && (
                  <span className="inline-flex items-center gap-2 sm:col-span-2">
                    <Stethoscope size={14} />
                    Em atendimento com {caso.tecnico_nome}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoricoAtendimentos({ historico }: { historico: EntradaHistorico[] }) {
  return (
    <div className="rounded-card border border-meta-divider bg-white p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="row !justify-start">
          <span className="flex h-9 w-9 items-center justify-center rounded-pill bg-primary/10 text-primary">
            <Clock3 size={17} />
          </span>
          <h3 className="text-sm font-semibold text-meta-charcoal">Histórico de atendimentos</h3>
        </div>
        <Badge tone="neutral">{historico.length}</Badge>
      </div>

      {historico.length === 0 ? (
        <EmptyState title="Sem atendimentos recentes" text="Nada nos últimos meses que indique duplicidade." />
      ) : (
        <div className="relative space-y-2.5 before:absolute before:left-4 before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-meta-divider">
          {historico.slice(0, 8).map((entrada, index) => (
            <article className="relative pl-10" key={`${entrada.quando}-${index}`}>
              <span className={`absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-pill border-4 border-white ${
                entrada.o_que.toLowerCase().includes("finalizado") ? "bg-success/15 text-success" : "bg-warning/20 text-[#8a5a00]"
              }`}>
                {entrada.o_que.toLowerCase().includes("finalizado") ? <CheckCircle2 size={15} /> : <ShieldAlert size={15} />}
              </span>

              <div className="rounded-card border border-meta-divider bg-meta-soft-gray p-3.5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm text-meta-charcoal">{entrada.o_que}</strong>
                  <Badge tone={entrada.e_de_outra_unidade ? "warn" : "neutral"}>
                    {entrada.e_de_outra_unidade ? "Outra unidade" : "Mesma unidade"}
                  </Badge>
                </div>
                <p className="text-xs leading-5 text-meta-charcoal">
                  {entrada.detalhe || "Sem observação registrada."}
                </p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-meta-slate">
                  <span className="inline-flex items-center gap-2">
                    <Clock3 size={14} />
                    {formatarDataHora(entrada.quando)}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <MapPin size={14} />
                    {entrada.unidade}
                  </span>
                  {entrada.quem_atendeu && (
                    <span className="inline-flex items-center gap-2">
                      <Stethoscope size={14} />
                      {entrada.quem_atendeu}
                    </span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function UltimosAtendimentos({ atendimentos, completo = false }: { atendimentos: AtendimentoRecepcao[]; completo?: boolean }) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="!mb-1">{completo ? "Atendimentos recentes" : "Meus últimos atendimentos"}</h2>
          {completo && (
            <p className="text-sm leading-6 text-meta-slate">
              Tudo que a recepção finalizou no balcão ou encaminhou para a fila.
            </p>
          )}
        </div>
        <Badge tone="neutral">{atendimentos.length}</Badge>
      </div>

      {atendimentos.length === 0 ? (
        <EmptyState title="Nenhum registro ainda" text="Quando você finalizar ou enviar alguém para a fila, aparece aqui." />
      ) : (
        <div className="space-y-2.5">
          {atendimentos.slice(0, completo ? 20 : 6).map((atendimento) => (
            <article className="rounded-card border border-meta-divider bg-white p-3.5 shadow-lift" key={atendimento.id}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm text-meta-charcoal">{atendimento.cidadao_nome}</strong>
                <Badge tone={atendimento.desfecho === "ENCAMINHADO" ? "warn" : "good"}>
                  {atendimento.desfecho === "ENCAMINHADO" ? "Enviado para fila" : "Finalizado no balcão"}
                </Badge>
              </div>
              <p className="text-xs font-medium text-meta-charcoal">{atendimento.demanda}</p>
              <p className="mt-1 text-xs leading-5 text-meta-slate">
                {atendimento.observacao || atendimento.motivo || "Sem observação registrada."}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-meta-slate">
                <span className="inline-flex items-center gap-2">
                  <Clock3 size={14} />
                  {formatarDataHora(atendimento.criado_em)}
                </span>
                <span className="inline-flex items-center gap-2">
                  <MapPin size={14} />
                  {atendimento.local_do_atendimento || atendimento.unidade_nome}
                </span>
                {atendimento.caso_protocolo && (
                  <span className="inline-flex items-center gap-2">
                    <ClipboardList size={14} />
                    Caso {atendimento.caso_protocolo}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

function FilaSomenteLeitura({ fila, onAtualizar }: { fila: Senha[]; onAtualizar: () => void }) {
  return (
    <Card>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="!mb-1">Fila de atendimento</h2>
          <p className="text-sm leading-6 text-meta-slate">
            Consulta da recepção. Quem inicia o atendimento é o atendente na tela de fila.
          </p>
        </div>
        <SecondaryButton type="button" onClick={onAtualizar}>
          Atualizar
        </SecondaryButton>
      </div>

      {fila.length === 0 ? (
        <EmptyState title="Fila vazia" text="Nenhuma senha aguardando atendimento agora." />
      ) : (
        <div className="grid gap-3">
          {fila.map((senha) => (
            <article
              className="rounded-feature border border-meta-divider bg-meta-warm-gray p-4 transition-all hover:bg-white hover:shadow-lift"
              key={senha.id}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex h-12 min-w-16 items-center justify-center rounded-feature bg-primary px-4 text-lg font-bold text-primary-foreground shadow-lift">
                    {senha.senha}
                  </span>
                  <div>
                    <strong className="block text-meta-charcoal">{senha.cidadao_nome}</strong>
                    <p className="mt-1 text-sm text-meta-slate">{senha.servico || "Serviço não informado"}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge tone={tomDaPrioridade(senha.prioridade)}>{rotuloPrioridade(senha.prioridade)}</Badge>
                  <Badge tone="neutral">{rotuloSituacaoFila(senha.situacao)}</Badge>
                  <Badge tone="neutral">{formatarDataHora(senha.criado_em)}</Badge>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

function DadosCidadao({ cidadao }: { cidadao: CidadaoLista }) {
  const local = [cidadao.bairro, cidadao.cidade].filter(Boolean).join(" · ");
  return (
    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-meta-slate">
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-meta-divider bg-meta-soft-gray/70 px-2 py-1 tabular-nums">
        <IdCard size={16} className="shrink-0" aria-hidden="true" />
        {cidadao.cpf ? `CPF ${formatCPF(cidadao.cpf)}` : "CPF não informado"}
      </span>
      {local && <span className="inline-flex items-center gap-1.5"><MapPin size={16} className="shrink-0" aria-hidden="true" />{local}</span>}
    </span>
  );
}

function CidadaoSelecionado({ cidadao, onTrocar }: { cidadao: CidadaoLista; onTrocar: () => void }) {
  return (
    <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-white to-meta-warm-gray px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-lift">
            <UserRoundCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary/75">Selecionado</p>
            <h3 className="mt-0.5 break-words text-base font-semibold text-meta-charcoal">{cidadao.nome}</h3>
            <DadosCidadao cidadao={cidadao} />
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center justify-center rounded-pill border border-meta-divider bg-white px-3 text-xs font-semibold text-meta-charcoal shadow-sm transition-all hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
          onClick={onTrocar}
        >
          <ArrowLeftRight size={14} className="mr-1.5" aria-hidden="true" />
          Trocar cidadão
        </button>
      </div>
    </div>
  );
}

function normalizar(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
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

function formatarDataCurta(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function rotuloSituacao(value: string) {
  const labels: Record<string, string> = {
    EM_TRIAGEM: "Na fila/triagem",
    EM_ATENDIMENTO: "Em atendimento",
    CONCLUIDO: "Concluído",
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

function rotuloSituacaoFila(value: string) {
  const labels: Record<string, string> = {
    AGUARDANDO: "Aguardando",
    CHAMADO: "Chamado",
    EM_ATENDIMENTO: "Em atendimento",
    ATENDIDO: "Atendido",
    DESISTIU: "Desistiu",
  };
  return labels[value] ?? value;
}

function tomDoCaso(value: string): "neutral" | "good" | "warn" | "bad" {
  if (value === "CONCLUIDO") return "good";
  if (value === "CANCELADO") return "neutral";
  if (value === "EM_ATENDIMENTO") return "warn";
  return "bad";
}

function tomDaPrioridade(value: string): "neutral" | "good" | "warn" | "bad" {
  if (value === "URGENTE") return "bad";
  if (value === "ALTA") return "warn";
  if (value === "BAIXA") return "good";
  return "neutral";
}
