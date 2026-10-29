"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowLeftRight,
  IdCard,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Headset,
  ListChecks,
  MapPin,
  Search,
  Send,
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
import { Aba, Abas, Badge, Button, Card, EmptyState, Field, Input, PageHeader, SecondaryButton, SectionHeading, Select, Stat } from "@/components/ui";
import { AvisoDeDuplicidade, alertasDoErro, justificativaValida, mensagemDeDuplicidade, useDuplicidade } from "@/components/duplicidade/aviso";
import { api, mensagemDaApi } from "@/lib/api";
import { rotuloPrioridade, rotuloSituacao, rotuloSituacaoDaSenha, tomDaPrioridade, tomDoCaso } from "@/lib/casos";
import { formatarDataCurta, formatarDataHora } from "@/lib/datas";
import { formatCPF } from "@/lib/utils";
import type {
  AlertaDeDuplicidade, AtendimentoRecepcao, Caso, CidadaoLista, EncaminhamentoResumo, EntradaHistorico,
  PainelRecepcao, Senha, Servico,
} from "@/types/sgcas";

type HistoricoResponse = {
  cidadao: CidadaoLista;
  entradas: EntradaHistorico[];
};

type ResultadoAtendimento = {
  desfecho: "ENCAMINHADO" | "FINALIZADO";
  caso: Caso | null;
  senha: { senha: string; servico?: string | null } | null;
  // Presente quando a visita cumpriu um encaminhamento de outra unidade.
  encaminhamento: EncaminhamentoResumo | null;
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
  // Encaminhamentos de outras unidades para esta, ainda sem a chegada registrada.
  const [pendentes, setPendentes] = useState<EncaminhamentoResumo[]>([]);
  // `null`: o atendente não mexeu — vale o primeiro vinculável (o mais urgente).
  const [encaminhamentoEscolhido, setEncaminhamentoEscolhido] = useState<string | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [alertasDoServidor, setAlertasDoServidor] = useState<AlertaDeDuplicidade[]>([]);

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
    setEncaminhamentoEscolhido(null);
    setJustificativa("");
    setAlertasDoServidor([]);

    await carregarDadosDoCidadao(selecionado);
    setAvisoOpen(true);
  }

  async function carregarDadosDoCidadao(selecionado: CidadaoLista) {
    const [historicoData, casosData, recebidos] = await Promise.all([
      api<HistoricoResponse>(`/citizens/${selecionado.id}/historico`).catch(() => ({ cidadao: selecionado, entradas: [] })),
      api<Caso[]>(`/cases/?cidadao=${selecionado.id}`).catch(() => []),
      api<EncaminhamentoResumo[]>(`/referrals/recebidos?cidadao=${selecionado.id}`).catch(() => []),
    ]);

    setHistorico(historicoData.entradas);
    setCasos(casosData);
    // Só os que ainda esperam a pessoa: o que já teve a chegada registrada não se cumpre de novo.
    setPendentes(recebidos.filter((e) => !e.chegou_em));
  }

  const servicoSelecionado = useMemo(
    () => servicos.find((servico) => servico.id === servicoId) ?? null,
    [servicoId, servicos],
  );

  // A chegada só cumpre um encaminhamento para o serviço da unidade a que ele se destina.
  const vinculaveis = useMemo(
    () => pendentes.filter((e) => servicoSelecionado && e.unidade_destino === servicoSelecionado.unidade),
    [pendentes, servicoSelecionado],
  );
  const encaminhamentoDaVisita = acao === "ENCAMINHADO"
    ? (encaminhamentoEscolhido === null ? vinculaveis[0]?.id ?? "" : encaminhamentoEscolhido)
    : "";

  // O aviso de repetição aparece assim que o serviço é escolhido, antes de enviar.
  const consultaDeDuplicidade = acao === "ENCAMINHADO" && servicoSelecionado
    ? `servico_id=${servicoSelecionado.id}${encaminhamentoDaVisita ? `&encaminhamento_id=${encaminhamentoDaVisita}` : ""}`
    : null;
  const daPrevia = useDuplicidade(cidadao?.id ?? null, consultaDeDuplicidade);
  const alertasDeDuplicidade = acao === "ENCAMINHADO" ? (daPrevia.length > 0 ? daPrevia : alertasDoServidor) : [];
  const faltaJustificar = alertasDeDuplicidade.length > 0 && !justificativaValida(justificativa);

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
    if (desfecho === "ENCAMINHADO" && faltaJustificar) {
      setMensagem("Escreva a justificativa para repetir este auxílio.");
      return;
    }

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
          encaminhamento_id: desfecho === "ENCAMINHADO" && encaminhamentoDaVisita ? encaminhamentoDaVisita : null,
          justificativa_duplicidade: desfecho === "ENCAMINHADO" && alertasDeDuplicidade.length > 0 ? justificativa.trim() : null,
        }),
      });

      setResultado(data);
      setSuccessOpen(true);
      setAcaoOpen(false);
      setServicoId("");
      setPrioridade("NORMAL");
      setObservacao("");
      setMotivo("");
      setEncaminhamentoEscolhido(null);
      setJustificativa("");
      setAlertasDoServidor([]);
      await carregarUltimosAtendimentos();
      await carregarPainel();
      await carregarFila();
      await carregarDadosDoCidadao(cidadao);
    } catch (error) {
      const repetidos = alertasDoErro(error);
      if (repetidos) setAlertasDoServidor(repetidos);
      setMensagem(
        repetidos
          ? mensagemDeDuplicidade(repetidos)
          : mensagemDaApi(error, "Não foi possível registrar o atendimento."),
      );
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Recepção"
        description="Busque a pessoa, confira o histórico e registre a chegada ou o encaminhamento para o atendimento."
      />

      <PainelResumoRecepcao painel={painel} />

      <div className="mt-5">
        <Abas rotulo="Seções da recepção">
          <Aba
            ativa={aba === "nova"}
            onClick={() => {
              setAba("nova");
              window.requestAnimationFrame(() => {
                const input = document.getElementById("busca-cidadao-recepcao");
                input?.focus({ preventScroll: true });
                input?.scrollIntoView({ behavior: "smooth", block: "center" });
              });
            }}
          >
            <Search size={16} aria-hidden="true" />
            Buscar<span className="max-sm:hidden">&nbsp;cidadão</span>
          </Aba>
          <Aba ativa={aba === "recentes"} onClick={() => setAba("recentes")}>
            <Clock3 size={16} aria-hidden="true" />
            <span className="sm:hidden">Recentes</span>
            <span className="max-sm:hidden">Atendimentos recentes</span>
            <Badge tone="neutral">{ultimosAtendimentos.length}</Badge>
          </Aba>
          <Aba
            ativa={aba === "fila"}
            onClick={() => {
              setAba("fila");
              void carregarFila();
            }}
          >
            <ListChecks size={16} aria-hidden="true" />
            Fila
            <Badge tone={fila.length ? "warn" : "neutral"}>{fila.length}</Badge>
          </Aba>
        </Abas>
      </div>

      <div className="grid gap-4">
        {aba === "nova" && (
          <>
            <Card>
              <h2 className="!mb-1">Quem você vai atender?</h2>
              <p className="mb-4 text-sm text-meta-slate">Primeiro, encontre o cidadão. Depois, confira o histórico e escolha como registrar a recepção.</p>
              <label htmlFor="busca-cidadao-recepcao" className="mb-1.5 block text-[13px] font-semibold text-meta-charcoal">Buscar por nome, CPF, NIS ou e-mail</label>
              <div className="relative mb-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta-slate" aria-hidden="true" />
                <Input
                  id="busca-cidadao-recepcao"
                  className="pl-10"
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
                  autoComplete="off"
                />
              </div>

              {!cidadao && busca.trim().length < 2 && (
                <p className="mb-4 text-sm text-meta-slate">Digite pelo menos 2 caracteres e selecione o cidadão nos resultados.</p>
              )}

              {!cidadao && cidadaos.length > 0 && (
                <ul className="grid gap-2.5">
                  {cidadaos.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="group flex w-full flex-col gap-2 rounded-lg border border-meta-divider bg-white p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-meta-warm-gray sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                        onClick={() => void selecionarCidadao(item)}
                        aria-label={`Selecionar ${item.nome}`}
                      >
                        <span className="min-w-0">
                          <strong className="block text-[15px] font-semibold text-meta-charcoal">{item.nome}</strong>
                          <DadosCidadao cidadao={item} />
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary">
                          Selecionar <ArrowRight size={16} aria-hidden="true" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {!cidadao && (
                <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-meta-divider pt-4 text-sm text-meta-slate">
                  Não encontrou o cidadão?
                  <Link href="/cidadaos/novo" className="inline-flex min-h-10 items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline">
                    <UserPlus size={16} aria-hidden="true" /> Cadastrar cidadão
                  </Link>
                </p>
              )}

              {cidadao && <CidadaoSelecionado cidadao={cidadao} onTrocar={() => setCidadao(null)} />}
            </Card>

            {cidadao && (
              // As ações vêm primeiro no código para aparecerem antes do histórico no celular;
              // no computador elas ficam na coluna da direita.
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
                <Card className="h-fit xl:col-start-2 xl:row-start-1">
                  <h2 className="!mb-0.5 !text-base">Atendimento</h2>
                  <p className="mb-3 text-[13px] leading-5 text-meta-slate">Escolha o desfecho da recepção.</p>
                  <div className="grid gap-2.5">
                    {mensagem && <div className="notice" role="alert">{mensagem}</div>}

                    <button
                      type="button"
                      className="flex items-start gap-3 rounded-lg bg-primary p-3.5 text-left text-primary-foreground transition-colors hover:bg-primary-hover"
                      onClick={() => abrirAcao("ENCAMINHADO")}
                    >
                      <Send size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0">
                        <strong className="block text-sm font-semibold">Iniciar atendimento</strong>
                        <small className="block text-[13px] leading-5 text-primary-foreground/85">Cria o caso e gera a senha.</small>
                      </span>
                    </button>

                    <button
                      type="button"
                      className="flex items-start gap-3 rounded-lg border border-meta-divider bg-white p-3.5 text-left text-meta-charcoal transition-colors hover:bg-meta-soft-gray"
                      onClick={() => abrirAcao("FINALIZADO")}
                    >
                      <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-meta-slate" aria-hidden="true" />
                      <span className="min-w-0">
                        <strong className="block text-sm font-semibold">Finalizar na recepção</strong>
                        <small className="block text-[13px] leading-5 text-meta-slate">Registra a orientação dada no balcão.</small>
                      </span>
                    </button>
                  </div>
                </Card>

                <div className="grid min-w-0 gap-4 xl:col-start-1 xl:row-start-1">
                  {pendentes.length > 0 && <EncaminhamentosAguardando encaminhamentos={pendentes} nome={cidadao.nome} />}
                  <Card className="min-w-0">
                    <PainelDoCidadao casos={casos} historico={historico} />
                  </Card>
                </div>
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

            {acao === "ENCAMINHADO" && vinculaveis.length > 0 && (
              <Field label="Esta pessoa chegou encaminhada de outra unidade?">
                <Select
                  value={encaminhamentoDaVisita}
                  onChange={(event) => {
                    setEncaminhamentoEscolhido(event.target.value);
                    setAlertasDoServidor([]);
                  }}
                >
                  {vinculaveis.map((e) => (
                    <option key={e.id} value={e.id}>
                      Sim, de {e.unidade_origem_nome || "outra unidade"} · {e.categoria_rotulo} · urgência {e.urgencia_rotulo.toLowerCase()} ({formatarDataHora(e.criado_em)})
                    </option>
                  ))}
                  <option value="">Não, é um pedido novo</option>
                </Select>
              </Field>
            )}

            {servicoSelecionado && casosParecidos.length > 0 && alertasDeDuplicidade.length === 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-amber-950 sm:p-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={18} aria-hidden="true" className="shrink-0" />
                  <strong>Possível duplicidade</strong>
                </div>
                <p className="mt-1.5 text-sm leading-6">
                  Há caso ou atendimento recente. Se for a mesma demanda, finalize na recepção.
                </p>
              </div>
            )}

            {acao === "ENCAMINHADO" && (
              <AvisoDeDuplicidade alertas={alertasDeDuplicidade} justificativa={justificativa} onChange={setJustificativa} />
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

            {mensagem && <div className="notice" role="alert">{mensagem}</div>}
          </div>

          <DialogFooter>
            <SecondaryButton type="button" onClick={() => setAcaoOpen(false)} disabled={registrando}>
              Cancelar
            </SecondaryButton>
            <Button type="button" disabled={!servicoSelecionado || registrando || (acao === "ENCAMINHADO" && faltaJustificar)} onClick={() => void registrar(acao)}>
              {acao === "ENCAMINHADO" ? (
                <>
                  <Send size={16} aria-hidden="true" />
                  {registrando ? "Gerando..." : "Criar caso e gerar senha"}
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} aria-hidden="true" />
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
            <DialogTitle>{resultado?.desfecho === "ENCAMINHADO" ? "Caso enviado para a fila" : "Atendimento finalizado"}</DialogTitle>
            <DialogDescription>
              {resultado?.senha
                ? `Senha gerada: ${resultado.senha.senha}. O cidadão já aparece na fila da unidade.`
                : "O atendimento foi registrado no histórico do cidadão."}
              {resultado?.encaminhamento
                ? ` A chegada cumpriu o encaminhamento de ${resultado.encaminhamento.unidade_origem_nome ?? "outra unidade"}, que foi avisada.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {resultado?.senha && (
              <Link href="/fila" className="button secondary">
                Ver fila
              </Link>
            )}
            <Button onClick={() => setSuccessOpen(false)}>Entendi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function PainelResumoRecepcao({ painel }: { painel: PainelRecepcao | null }) {
  return (
    <section aria-label="Resumo da recepção" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <Stat label="Atendidos hoje" value={(painel?.atendimentos_hoje ?? 0).toLocaleString("pt-BR")} hint="Passagens registradas no balcão" icon={Headset} />
      <Stat label="Aguardando" value={(painel?.aguardando_na_fila ?? 0).toLocaleString("pt-BR")} hint="Senhas esperando chamada" icon={ListChecks} highlight />
      <Stat label="Em atendimento" value={(painel?.em_atendimento ?? 0).toLocaleString("pt-BR")} hint="Já chamados pela equipe" icon={Stethoscope} />
      <Stat label="Finalizados" value={(painel?.finalizados_no_balcao ?? 0).toLocaleString("pt-BR")} hint="Resolvidos na recepção" icon={CheckCircle2} />
      <Stat label="Geraram senha" value={(painel?.encaminhados_para_fila ?? 0).toLocaleString("pt-BR")} hint="Encaminhados hoje" icon={Send} />
    </section>
  );
}

/**
 * A pessoa foi encaminhada para esta unidade e ainda não chegou ao balcão. A
 * recepção vê só o resumo — de onde, quando, a categoria e a urgência; o relato
 * é da equipe técnica.
 */
function EncaminhamentosAguardando({ encaminhamentos, nome }: { encaminhamentos: EncaminhamentoResumo[]; nome: string }) {
  return (
    <div role="status" className="rounded-card border border-primary/30 bg-accent p-3.5 sm:p-4">
      <div className="flex items-start gap-2 text-meta-charcoal">
        <ArrowLeftRight size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
        <strong>{nome} foi encaminhado(a) para esta unidade</strong>
      </div>
      <ul className="mt-2 grid gap-1 text-sm leading-6 text-meta-charcoal">
        {encaminhamentos.map((e) => (
          <li key={e.id}>
            De <strong>{e.unidade_origem_nome || "outra unidade"}</strong> em {formatarDataHora(e.criado_em)} ·{" "}
            {e.categoria_rotulo} · urgência {e.urgencia_rotulo.toLowerCase()}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] leading-5 text-meta-slate">
        Ao iniciar o atendimento, vincule a visita ao encaminhamento: a ficha e a urgência seguem com a pessoa e a unidade
        de origem é avisada da chegada.
      </p>
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
          <h2 className="!mb-1 !text-base">Histórico para decisão</h2>
          <p className="text-[13px] leading-5 text-meta-slate">
            Confira se já existe atendimento parecido antes de criar uma nova senha.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={casosAbertos.length ? "warn" : "good"}>
            {casosAbertos.length ? `${casosAbertos.length} caso(s) aberto(s)` : "Sem caso aberto"}
          </Badge>
          <Badge tone="neutral">
            {ultimoContato ? `Último contato ${formatarDataCurta(ultimoContato)}` : "Sem histórico recente"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2 xl:gap-8">
        <CasosRecentes casos={casos} />
        <HistoricoAtendimentos historico={historico} />
      </div>
    </div>
  );
}

function CasosRecentes({ casos }: { casos: Caso[] }) {
  return (
    <div className="min-w-0">
      <SectionHeading icon={ClipboardList} title="Casos recentes" count={casos.length} />

      {casos.length === 0 ? (
        <EmptyState title="Nenhum caso recente" text="Se a demanda for nova, inicie o atendimento e gere a senha." />
      ) : (
        <ul>
          {casos.slice(0, 6).map((caso) => (
            <li className="line-row" key={caso.id}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                <div className="min-w-0">
                  <small className="block">Caso {caso.protocolo}</small>
                  <strong className="block">{caso.servico_nome || "Serviço não informado"}</strong>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={tomDoCaso(caso.situacao)}>{rotuloSituacao(caso.situacao)}</Badge>
                  <Badge tone={tomDaPrioridade(caso.prioridade)}>{rotuloPrioridade(caso.prioridade)}</Badge>
                </div>
              </div>

              <p className="mt-1.5 line-clamp-3 text-[13px] leading-5 text-meta-charcoal">{caso.descricao || "Sem observação registrada."}</p>

              <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-meta-slate">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={13} aria-hidden="true" />
                  {caso.unidade_nome}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={13} aria-hidden="true" />
                  Aberto em {formatarDataHora(caso.aberto_em)}
                </span>
                {caso.tecnico_nome && (
                  <span className="inline-flex items-center gap-1.5">
                    <Stethoscope size={13} aria-hidden="true" />
                    Em atendimento com {caso.tecnico_nome}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoricoAtendimentos({ historico }: { historico: EntradaHistorico[] }) {
  return (
    <div className="min-w-0">
      <SectionHeading icon={Clock3} title="Histórico de atendimentos" count={historico.length} />

      {historico.length === 0 ? (
        <EmptyState title="Sem atendimentos recentes" text="Nada nos últimos meses que indique duplicidade." />
      ) : (
        <ul>
          {historico.slice(0, 8).map((entrada, index) => (
            <li className="line-row" key={`${entrada.quando}-${index}`}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                <strong>{entrada.o_que}</strong>
                <Badge tone={entrada.e_de_outra_unidade ? "warn" : "neutral"}>
                  {entrada.e_de_outra_unidade ? "Outra unidade" : "Mesma unidade"}
                </Badge>
              </div>
              <p className="mt-1 text-[13px] leading-5 text-meta-charcoal">{entrada.detalhe || "Sem observação registrada."}</p>
              <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-meta-slate">
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={13} aria-hidden="true" />
                  {formatarDataHora(entrada.quando)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={13} aria-hidden="true" />
                  {entrada.unidade}
                </span>
                {entrada.quem_atendeu && (
                  <span className="inline-flex items-center gap-1.5">
                    <Stethoscope size={13} aria-hidden="true" />
                    {entrada.quem_atendeu}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UltimosAtendimentos({ atendimentos, completo = false }: { atendimentos: AtendimentoRecepcao[]; completo?: boolean }) {
  return (
    <Card>
      <SectionHeading title={completo ? "Atendimentos recentes" : "Meus últimos atendimentos"} count={atendimentos.length} />
      {completo && (
        <p className="-mt-1 mb-3 text-sm leading-6 text-meta-slate">
          Tudo que a recepção finalizou no balcão ou encaminhou para a fila.
        </p>
      )}

      {atendimentos.length === 0 ? (
        <EmptyState title="Nenhum registro ainda" text="Quando você finalizar ou enviar alguém para a fila, aparece aqui." />
      ) : (
        <ul>
          {atendimentos.slice(0, completo ? 20 : 6).map((atendimento) => (
            <li className="line-row" key={atendimento.id}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                <strong>{atendimento.cidadao_nome}</strong>
                <Badge tone={atendimento.desfecho === "ENCAMINHADO" ? "warn" : "good"}>
                  {atendimento.desfecho === "ENCAMINHADO" ? "Enviado para a fila" : "Finalizado no balcão"}
                </Badge>
              </div>
              <p className="mt-0.5 text-[13px] font-medium text-meta-charcoal">{atendimento.demanda}</p>
              <p className="mt-0.5 text-[13px] leading-5 text-meta-slate">
                {atendimento.observacao || atendimento.motivo || "Sem observação registrada."}
              </p>
              <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-meta-slate">
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={13} aria-hidden="true" />
                  {formatarDataHora(atendimento.criado_em)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={13} aria-hidden="true" />
                  {atendimento.local_do_atendimento || atendimento.unidade_nome}
                </span>
                {atendimento.caso_protocolo && (
                  <span className="inline-flex items-center gap-1.5">
                    <ClipboardList size={13} aria-hidden="true" />
                    Caso {atendimento.caso_protocolo}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FilaSomenteLeitura({ fila, onAtualizar }: { fila: Senha[]; onAtualizar: () => void }) {
  return (
    <Card>
      <SectionHeading
        title="Fila de atendimento"
        count={fila.length}
        action={
          <SecondaryButton type="button" size="sm" onClick={onAtualizar}>
            Atualizar
          </SecondaryButton>
        }
      />
      <p className="-mt-1 mb-3 text-sm leading-6 text-meta-slate">
        Consulta da recepção. Quem inicia o atendimento é o atendente, na tela de Atendimento.
      </p>

      {fila.length === 0 ? (
        <EmptyState title="Fila vazia" text="Nenhuma senha aguardando atendimento agora." />
      ) : (
        <ul>
          {fila.map((senha) => (
            <li className="line-row flex flex-wrap items-center gap-x-3 gap-y-2" key={senha.id}>
              <span className="flex h-10 min-w-14 shrink-0 items-center justify-center rounded-lg bg-primary px-2.5 text-[15px] font-bold tabular-nums text-primary-foreground">
                {senha.senha}
              </span>
              <span className="min-w-0 flex-1 basis-40">
                <span className="block text-sm font-semibold text-meta-charcoal">{senha.cidadao_nome}</span>
                <small className="block">{senha.servico || "Serviço não informado"}</small>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={tomDaPrioridade(senha.prioridade)}>{rotuloPrioridade(senha.prioridade)}</Badge>
                <Badge tone="neutral">{rotuloSituacaoDaSenha(senha.situacao)}</Badge>
                <small className="tabular-nums">{formatarDataHora(senha.criado_em)}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DadosCidadao({ cidadao }: { cidadao: CidadaoLista }) {
  const local = [cidadao.bairro, cidadao.cidade].filter(Boolean).join(" · ");
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-meta-slate">
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        <IdCard size={14} className="shrink-0" aria-hidden="true" />
        {cidadao.cpf ? `CPF ${formatCPF(cidadao.cpf)}` : "CPF não informado"}
      </span>
      {local && <span className="inline-flex items-center gap-1.5"><MapPin size={14} className="shrink-0" aria-hidden="true" />{local}</span>}
    </span>
  );
}

function CidadaoSelecionado({ cidadao, onTrocar }: { cidadao: CidadaoLista; onTrocar: () => void }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-accent p-3.5 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-primary">
            <UserRoundCheck size={15} aria-hidden="true" />
            Cidadão selecionado
          </p>
          <h3 className="mt-0.5 text-base font-semibold text-meta-charcoal">{cidadao.nome}</h3>
          <DadosCidadao cidadao={cidadao} />
        </div>
        <SecondaryButton type="button" size="sm" className="shrink-0 self-start sm:self-center" onClick={onTrocar}>
          <ArrowLeftRight size={14} aria-hidden="true" />
          Trocar cidadão
        </SecondaryButton>
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
