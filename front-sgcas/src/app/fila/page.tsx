"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  ClipboardEdit,
  FolderOpen,
  ListChecks,
  Send,
  Stethoscope,
  UserX,
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
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, SecondaryButton, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Cidadao, EntradaHistorico, Caso, PainelAtendente, Senha, Unidade } from "@/types/sgcas";

const indicadores = {
  atendidos_hoje: { titulo: "Atendidos hoje", descricao: "Senhas finalizadas por você hoje nesta unidade." },
  aguardando_na_fila: { titulo: "Aguardando na fila", descricao: "Senhas aguardando nesta unidade, por prioridade e ordem de chegada." },
  finalizados_hoje: { titulo: "Finalizados", descricao: "Casos concluídos ou encaminhados por você hoje nesta unidade." },
  casos_em_acompanhamento: { titulo: "Acompanhamento", descricao: "Casos da unidade que não estão concluídos nem cancelados." },
};
type Indicador = keyof typeof indicadores;
type DetalhesIndicador = { tipo: "senhas"; registros: Senha[] } | { tipo: "casos"; registros: Caso[] };

type SenhaAberta = Senha & { operador_nome: string | null; pode_retomar: boolean };

type AtendimentoMontado = {
  senha: Senha;
  cidadao: Cidadao;
  caso: Caso | null;
  historico: EntradaHistorico[];
};

export default function FilaPage() {
  const { user } = useAuth();
  const unidadeId = user?.unidade?.id;
  const podeChamar = Boolean(user && ["ADMIN", "COORDENADOR", "ASSISTENTE_SOCIAL", "TECNICO", "GESTOR_ACOES_ITINERANTES"].includes(user.papel));
  const [indicador, setIndicador] = useState<Indicador | null>(null);
  const [detalhes, setDetalhes] = useState<DetalhesIndicador | null>(null);
  const [erroDetalhes, setErroDetalhes] = useState("");
  const detalheVersao = useRef(0);
  const [listaOpen, setListaOpen] = useState(false);
  const [abertos, setAbertos] = useState<SenhaAberta[]>([]);
  const [carregandoAbertos, setCarregandoAbertos] = useState(false);
  const [erroAbertos, setErroAbertos] = useState("");
  const [retomando, setRetomando] = useState<string | null>(null);
  const recuperacaoVersao = useRef(0);
  const [recuperando, setRecuperando] = useState(true);
  const [chamando, setChamando] = useState(false);
  const chamadaEmCurso = useRef(false);
  const [erroCarga, setErroCarga] = useState("");
  const [fila, setFila] = useState<Senha[]>([]);
  const [painel, setPainel] = useState<PainelAtendente | null>(null);
  const [atendimento, setAtendimento] = useState<AtendimentoMontado | null>(null);
  const [atendimentoIniciado, setAtendimentoIniciado] = useState(false);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modoModal, setModoModal] = useState<"inicio" | "observacao" | "encaminhar" | "concluir" | "naoCompareceu">("inicio");
  const [observacao, setObservacao] = useState("");
  const [relato, setRelato] = useState("");
  const [situacaoIdentificada, setSituacaoIdentificada] = useState("");
  const [providencia, setProvidencia] = useState("");
  const [retornoNecessario, setRetornoNecessario] = useState("");
  const [dataRetorno, setDataRetorno] = useState("");
  const [unidadeDestinoId, setUnidadeDestinoId] = useState("");
  const [destinoExterno, setDestinoExterno] = useState("");
  const [motivoEncaminhamento, setMotivoEncaminhamento] = useState("");
  const [observacaoEncaminhamento, setObservacaoEncaminhamento] = useState("");
  const [motivoNaoCompareceu, setMotivoNaoCompareceu] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState("");

  const carregar = useCallback(async () => {
    if (!unidadeId) return;
    const [filaResult, painelResult] = await Promise.allSettled([
      api<Senha[]>(`/queues/?unidade=${encodeURIComponent(unidadeId)}`),
      api<PainelAtendente>("/queues/painel"),
    ]);
    setFila(filaResult.status === "fulfilled" ? filaResult.value : []);
    setPainel(painelResult.status === "fulfilled" ? painelResult.value : null);
    setErroCarga(filaResult.status === "rejected" || painelResult.status === "rejected"
      ? "Não foi possível atualizar a fila ou o painel. Tente atualizar novamente."
      : "");
  }, [unidadeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void carregar();
      void api<Unidade[]>("/institutional/units").then(setUnidades).catch(() => setUnidades([]));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [carregar]);

  useEffect(() => {
    if (!user || !unidadeId || !podeChamar) return;
    let cancelado = false;
    const versao = ++recuperacaoVersao.current;
    const recuperar = async () => {
      try {
        const atual = await api<AtendimentoMontado | null>("/queues/atendimento-atual");
        if (cancelado || versao !== recuperacaoVersao.current) return;
        setAtendimento(atual);
        setAtendimentoIniciado(false);
        setRecuperando(false);
      } catch {
        if (!cancelado && versao === recuperacaoVersao.current) {
          setMensagem("Não foi possível recuperar seu atendimento atual. Recarregue a página para tentar novamente.");
        }
      }
    };
    void recuperar();
    return () => { cancelado = true; };
  }, [user, unidadeId, podeChamar]);

  async function abrirIndicador(grupo: Indicador) {
    const versao = ++detalheVersao.current;
    setIndicador(grupo);
    setDetalhes(null);
    setErroDetalhes("");
    try {
      const dados = await api<DetalhesIndicador>(`/queues/painel/${grupo}`);
      if (versao === detalheVersao.current) setDetalhes(dados);
    } catch (error) {
      if (versao === detalheVersao.current) setErroDetalhes(error instanceof Error ? error.message : "Não foi possível carregar os registros.");
    }
  }

  async function listarAbertos() {
    setListaOpen(true);
    setCarregandoAbertos(true);
    setErroAbertos("");
    try {
      setAbertos(await api<SenhaAberta[]>("/queues/em-atendimento"));
    } catch (error) {
      setErroAbertos(error instanceof Error ? error.message : "Não foi possível listar os atendimentos.");
    } finally {
      setCarregandoAbertos(false);
    }
  }

  async function retomar(senhaId: string) {
    if (retomando) return;
    setRetomando(senhaId);
    setErroAbertos("");
    try {
      const atual = await api<AtendimentoMontado>(`/queues/${encodeURIComponent(senhaId)}/retomar`);
      recuperacaoVersao.current++;
      setAtendimento(atual);
      setAtendimentoIniciado(false);
      setRecuperando(false);
      setObservacao("");
      setRelato("");
      setSituacaoIdentificada("");
      setProvidencia("");
      setRetornoNecessario("");
      setDataRetorno("");
      setModoModal("inicio");
      setListaOpen(false);
      setModalOpen(false);
      setMensagem(`Senha ${atual.senha.senha} recuperada em Atendimento atual.`);
      window.requestAnimationFrame(() => document.getElementById("atendimento-atual")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      await carregar();
    } catch (error) {
      setErroAbertos(error instanceof Error ? error.message : "Não foi possível retomar este atendimento.");
    } finally {
      setRetomando(null);
    }
  }

  async function chamar() {
    if (recuperando || chamadaEmCurso.current || atendimento || !unidadeId || !podeChamar) return;
    chamadaEmCurso.current = true;
    setChamando(true);
    setMensagem("");
    try {
      const data = await api<AtendimentoMontado>("/queues/chamar-proximo", { method: "POST" });
      setAtendimento(data);
      setAtendimentoIniciado(false);
      setModoModal("inicio");
      setObservacao("");
      setRelato("");
      setSituacaoIdentificada("");
      setProvidencia("");
      setRetornoNecessario("");
      setDataRetorno("");
      setUnidadeDestinoId("");
      setDestinoExterno("");
      setMotivoEncaminhamento("");
      setObservacaoEncaminhamento("");
      setMotivoNaoCompareceu("");
      setModalOpen(true);
      await carregar();
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : "Não foi possível chamar o próximo. Tente novamente.");
      await carregar();
    } finally {
      chamadaEmCurso.current = false;
      setChamando(false);
    }
  }

  function montarRegistroGuiado() {
    const partes = [
      situacaoIdentificada ? `Situação identificada: ${situacaoIdentificada}.` : null,
      providencia ? `Providência tomada: ${providencia}.` : null,
      retornoNecessario === "SIM"
        ? `Retorno necessário: sim${dataRetorno ? `, previsto para ${formatarDataSimples(dataRetorno)}` : ""}.`
        : retornoNecessario === "NAO"
          ? "Retorno necessário: não."
          : null,
      observacao.trim() ? `Observação: ${observacao.trim()}` : null,
    ].filter(Boolean);

    return partes.join("\n");
  }

  async function salvarObservacaoAtual(texto?: string) {
    const conteudo = (texto ?? observacao).trim();
    if (!atendimento?.caso || !conteudo) return atendimento?.caso ?? null;
    const casoAtualizado = await api<Caso>(`/cases/${atendimento.caso.id}/observacao`, {
      method: "POST",
      body: JSON.stringify({ observacao: conteudo }),
    });
    setAtendimento((atual) => (atual ? { ...atual, caso: casoAtualizado } : atual));
    setObservacao("");
    return casoAtualizado;
  }

  async function iniciarAtendimento() {
    if (!atendimento) return;
    setSalvando(true);
    setMensagem("");
    try {
      await salvarObservacaoAtual(montarRegistroGuiado());
      setAtendimentoIniciado(true);
      setModalOpen(false);
      setMensagem(`Senha ${atendimento.senha.senha} em atendimento.`);
      await carregar();
    } catch {
      setMensagem("Não foi possível iniciar o atendimento.");
    } finally {
      setSalvando(false);
    }
  }

  function abrirModo(modo: "observacao" | "encaminhar" | "concluir" | "naoCompareceu") {
    setModoModal(modo);
    setMensagem("");
    setModalOpen(true);
  }

  async function salvarObservacao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!atendimento?.caso) return;
    setSalvando(true);
    try {
      await salvarObservacaoAtual(montarRegistroGuiado());
      setModalOpen(false);
      setMensagem("Observação registrada no acompanhamento.");
      await carregar();
    } catch {
      setMensagem("Não foi possível registrar a observação.");
    } finally {
      setSalvando(false);
    }
  }

  async function encaminhar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!atendimento?.caso) return;
    setSalvando(true);
    setMensagem("");
    try {
      await api(`/cases/${atendimento.caso.id}/encaminhar`, {
        method: "POST",
        body: JSON.stringify({
          unidade_destino_id: unidadeDestinoId || null,
          destino_externo: unidadeDestinoId ? null : destinoExterno.trim(),
          motivo: motivoEncaminhamento.trim(),
          observacoes: observacaoEncaminhamento.trim() || null,
        }),
      });
      setAtendimento(null);
      setAtendimentoIniciado(false);
      setModalOpen(false);
      setMensagem("Atendimento encaminhado e senha finalizada.");
      await carregar();
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : "Não foi possível encaminhar.");
    } finally {
      setSalvando(false);
    }
  }

  async function concluir(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!atendimento?.caso) return;
    setSalvando(true);
    setMensagem("");
    try {
      await api(`/cases/${atendimento.caso.id}/concluir`, {
        method: "POST",
        body: JSON.stringify({
          situacao: "CONCLUIDO",
          relato: relato.trim() || montarRegistroGuiado() || "Atendimento concluído sem observações adicionais.",
        }),
      });
      setAtendimento(null);
      setAtendimentoIniciado(false);
      setModalOpen(false);
      setMensagem("Atendimento concluído e senha finalizada.");
      await carregar();
    } catch {
      setMensagem("Não foi possível concluir o atendimento.");
    } finally {
      setSalvando(false);
    }
  }

  async function marcarNaoCompareceu(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!atendimento) return;
    setSalvando(true);
    setMensagem("");
    try {
      await api(`/queues/${atendimento.senha.id}/nao-compareceu`, {
        method: "POST",
        body: JSON.stringify({
          motivo: motivoNaoCompareceu.trim() || null,
        }),
      });
      setAtendimento(null);
      setAtendimentoIniciado(false);
      setModalOpen(false);
      setMotivoNaoCompareceu("");
      setMensagem("Senha marcada como não compareceu.");
      await carregar();
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : "Não foi possível marcar não comparecimento.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Atendimento"
        description="Painel do atendente: acompanhe a fila, inicie o próximo caso e registre a conclusão."
        action={<Button onClick={chamar} disabled={recuperando || chamando || Boolean(atendimento) || !unidadeId || !podeChamar}>{chamando ? "Chamando..." : "Chamar próximo"}</Button>}
      />

      {!unidadeId && <div className="notice">Seu usuário não tem unidade de lotação definida. Solicite o vínculo a um administrador para chamar senhas.</div>}
      {user && !podeChamar && <div className="notice">Seu perfil não tem permissão para chamar senhas.</div>}
      {erroCarga && <div className="notice" role="alert">{erroCarga}</div>}
      {mensagem && <div className="notice" role="status">{mensagem}</div>}
      <div style={{ height: 16 }} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MiniStat onClick={() => void abrirIndicador("atendidos_hoje")} title="Atendidos hoje" value={painel?.atendidos_hoje ?? 0} detail="Finalizados pelo atendente" icon={CheckCircle2} tone="good" />
        <MiniStat onClick={() => void abrirIndicador("aguardando_na_fila")} title="Aguardando na fila" value={painel?.aguardando_na_fila ?? fila.length} detail="Próximas chamadas" icon={ListChecks} tone="warn" />
        <MiniStat onClick={() => void listarAbertos()} title="Em atendimento" value={painel?.em_atendimento ?? 0} detail="Senhas já chamadas" icon={Stethoscope} tone="primary" />
        <MiniStat onClick={() => void abrirIndicador("finalizados_hoje")} title="Finalizados" value={painel?.finalizados_hoje ?? 0} detail="Casos fechados hoje" icon={Clock3} tone="neutral" />
        <MiniStat onClick={() => void abrirIndicador("casos_em_acompanhamento")} title="Acompanhamento" value={painel?.casos_em_acompanhamento ?? 0} detail="Casos ativos na unidade" icon={FolderOpen} tone="bad" />
      </div>

      <div style={{ height: 16 }} />

      <div className="grid two">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><h2 className="!mb-0">Fila</h2><small>{user?.unidade?.nome}</small></div>
            <SecondaryButton onClick={() => void carregar()} disabled={!unidadeId}>Atualizar fila</SecondaryButton>
            <Badge tone={fila.length ? "warn" : "good"}>{fila.length}</Badge>
          </div>
          {fila.length === 0 ? (
            <EmptyState title="Fila vazia" text="A recepcao ainda nao encaminhou atendimentos." />
          ) : (
            fila.map((senha) => (
              <div className="rounded-feature border border-meta-divider bg-meta-warm-gray p-4 transition-all hover:bg-white hover:shadow-lift" key={senha.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <strong className="flex h-11 min-w-14 items-center justify-center rounded-feature bg-primary px-3 text-lg text-primary-foreground">
                      {senha.senha}
                    </strong>
                    <div>
                      <span className="font-semibold text-meta-charcoal">{senha.cidadao_nome}</span>
                      <small className="block text-meta-slate">{senha.servico}</small>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={tomDaPrioridade(senha.prioridade)}>{rotuloPrioridade(senha.prioridade)}</Badge>
                    <Badge tone="neutral">{formatarDataHora(senha.criado_em)}</Badge>
                  </div>
                </div>
              </div>
            ))
          )}
        </Card>

        <Card>
          <h2 id="atendimento-atual">Atendimento atual</h2>
          {!atendimento ? (
            <EmptyState title={recuperando && podeChamar && unidadeId ? "Recuperando atendimento..." : "Nenhum atendimento iniciado"} text="Use o botão chamar próximo para conferir a senha antes de iniciar." />
          ) : (
            <div className="grid">
              <div className="rounded-feature border border-meta-divider bg-meta-warm-gray p-5">
                <div className="row">
                  <Badge tone="good">{atendimento.senha.senha}</Badge>
                  <Badge tone="warn">{atendimento.senha.prioridade}</Badge>
                  <Badge tone={atendimentoIniciado ? "good" : "warn"}>
                    {atendimentoIniciado ? "Atendimento iniciado" : "Aguardando confirmação"}
                  </Badge>
                </div>
                <h3 className="mt-3">{atendimento.cidadao.nome}</h3>
                <p className="text-sm text-meta-slate">{atendimento.senha.servico}</p>
                {atendimento.caso && (
                  <div className="mt-4 rounded-lg bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">Caso em atendimento</p>
                    <strong>{atendimento.caso.protocolo}</strong>
                    <p className="text-sm text-meta-slate">{atendimento.caso.descricao || atendimento.caso.situacao}</p>
                  </div>
                )}
              </div>
              {!atendimentoIniciado ? (
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Button type="button" onClick={() => {
                    setModoModal("inicio");
                    setModalOpen(true);
                  }}>
                    Abrir conferência
                    <ArrowRight size={16} />
                  </Button>
                  <button
                    type="button"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-pill border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 transition-all hover:bg-red-100"
                    onClick={() => abrirModo("naoCompareceu")}
                  >
                    <UserX size={16} />
                    Não compareceu
                  </button>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <SecondaryButton type="button" className="h-10 px-3 text-xs" onClick={() => abrirModo("observacao")}>
                    <ClipboardEdit size={15} />
                    Observação
                  </SecondaryButton>
                  <SecondaryButton type="button" className="h-10 px-3 text-xs" onClick={() => abrirModo("encaminhar")}>
                    <Send size={15} />
                    Encaminhar
                  </SecondaryButton>
                  <Button type="button" className="h-10 px-3 text-xs" onClick={() => abrirModo("concluir")}>
                    <CheckCircle2 size={15} />
                    Concluir
                  </Button>
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-pill border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 transition-all hover:bg-red-100"
                    onClick={() => abrirModo("naoCompareceu")}
                  >
                    <UserX size={15} />
                    Não veio
                  </button>
                </div>
              )}
              <h3>Histórico do cidadão</h3>
              {atendimento.historico.length === 0 ? (
                <EmptyState title="Sem histórico recente" text="Não há registros recentes para este cidadão." />
              ) : (
                atendimento.historico.map((entrada, index) => (
                  <div className="line-row" key={`${entrada.quando}-${index}`}>
                    <strong>{entrada.o_que}</strong>
                    <small>{entrada.unidade}{entrada.detalhe ? ` · ${entrada.detalhe}` : ""}</small>
                  </div>
                ))
              )}
            </div>
          )}
        </Card>
      </div>

      <div style={{ height: 16 }} />

      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="!mb-1">Últimos atendimentos</h2>
            <p className="text-sm leading-6 text-meta-slate">Casos mais recentes assumidos por você.</p>
          </div>
          <Badge tone="neutral">{painel?.ultimos_atendimentos?.length ?? 0}</Badge>
        </div>

        {!painel?.ultimos_atendimentos?.length ? (
          <EmptyState title="Sem atendimentos recentes" text="Quando você iniciar/concluir casos, eles aparecem aqui." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {painel.ultimos_atendimentos.map((caso) => (
              <article className="rounded-feature border border-meta-divider bg-white p-4 shadow-lift" key={caso.id}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-meta-charcoal">{caso.cidadao_nome}</strong>
                  <Badge tone={tomDoCaso(caso.situacao)}>{rotuloSituacao(caso.situacao)}</Badge>
                </div>
                <p className="text-sm font-medium text-meta-charcoal">{caso.servico_nome || caso.protocolo}</p>
                <p className="mt-1 text-sm leading-6 text-meta-slate">{caso.descricao || "Sem relato registrado."}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone={tomDaPrioridade(caso.prioridade)}>{rotuloPrioridade(caso.prioridade)}</Badge>
                  <Badge tone="neutral">{formatarDataHora(caso.aberto_em)}</Badge>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={indicador !== null} onOpenChange={(open) => { if (!open) { detalheVersao.current++; setIndicador(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{indicador ? indicadores[indicador].titulo : "Registros"}</DialogTitle>
            <DialogDescription>{indicador ? indicadores[indicador].descricao : ""}</DialogDescription>
          </DialogHeader>
          {erroDetalhes ? <div role="alert"><p>{erroDetalhes}</p><SecondaryButton onClick={() => indicador && void abrirIndicador(indicador)}>Tentar novamente</SecondaryButton></div>
            : !detalhes ? <p>Carregando registros...</p>
            : detalhes.registros.length === 0 ? <p>Nenhum registro neste indicador.</p>
            : <div className="grid gap-3 max-h-[60vh] overflow-y-auto">
              <p className="text-sm text-meta-slate">{detalhes.registros.length} registro(s)</p>
              {detalhes.tipo === "senhas" ? detalhes.registros.map((senha) => (
                <article key={senha.id} className="rounded-card border p-4">
                  <strong>{senha.senha} · {senha.cidadao_nome}</strong>
                  <p>{senha.servico || "Serviço não informado"}</p>
                  <small>{rotuloPrioridade(senha.prioridade)} · {formatarDataHora(senha.criado_em)}</small>
                </article>
              )) : detalhes.registros.map((caso) => (
                <article key={caso.id} className="rounded-card border p-4">
                  <strong>{caso.protocolo} · {caso.cidadao_nome}</strong>
                  <p>{caso.servico_nome || caso.descricao || "Serviço não informado"}</p>
                  <p>{rotuloSituacao(caso.situacao)}</p>
                  <small>{caso.tecnico_nome || "Sem técnico responsável"} · {caso.unidade_nome}</small>
                </article>
              ))}
            </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={listaOpen} onOpenChange={setListaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Senhas em atendimento</DialogTitle>
            <DialogDescription>Selecione uma senha sua para reabrir em Atendimento atual. As demais mostram quem está atendendo.</DialogDescription>
          </DialogHeader>
          {carregandoAbertos ? <p>Carregando atendimentos...</p> : erroAbertos ? (
            <div role="alert"><p>{erroAbertos}</p><SecondaryButton onClick={() => void listarAbertos()}>Tentar novamente</SecondaryButton></div>
          ) : abertos.length === 0 ? <p>Nenhuma senha em atendimento nesta unidade.</p> : (
            <div className="grid gap-3 max-h-[60vh] overflow-y-auto">
              {abertos.map((senha) => (
                <button key={senha.id} type="button" className="rounded-card border p-4 text-left disabled:opacity-60 hover:bg-meta-soft-gray" disabled={!senha.pode_retomar || retomando !== null} onClick={() => void retomar(senha.id)}>
                  <strong>{senha.senha} · {senha.cidadao_nome}</strong>
                  <p>{senha.servico}</p>
                  <small>{senha.operador_nome ?? "Sem atendente"} · {retomando === senha.id ? "Abrindo..." : senha.pode_retomar ? "Retomar atendimento" : "Com outro atendente"}</small>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          {atendimento && (
            <>
              <DialogHeader>
                <DialogTitle>{tituloDoModal(modoModal, atendimento.senha.senha)}</DialogTitle>
                <DialogDescription>{descricaoDoModal(modoModal)}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-4">
                <div className="rounded-feature border border-meta-divider bg-meta-warm-gray p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="mb-2 flex flex-wrap gap-2">
                        <Badge tone="good">{atendimento.senha.senha}</Badge>
                        <Badge tone={tomDaPrioridade(atendimento.senha.prioridade)}>{rotuloPrioridade(atendimento.senha.prioridade)}</Badge>
                      </div>
                      <h3 className="text-xl font-semibold text-meta-charcoal">{atendimento.cidadao.nome}</h3>
                      <p className="mt-1 text-sm text-meta-slate">{atendimento.senha.servico || "Serviço não informado"}</p>
                    </div>
                    {atendimento.caso && (
                      <div className="rounded-card bg-white px-4 py-3 text-sm shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">Caso</p>
                        <strong className="text-meta-charcoal">{atendimento.caso.protocolo}</strong>
                      </div>
                    )}
                  </div>
                </div>

                {modoModal === "inicio" && (
                  <div className="grid gap-4">
                    <RegistroGuiado
                      observacao={observacao}
                      setObservacao={setObservacao}
                      situacaoIdentificada={situacaoIdentificada}
                      setSituacaoIdentificada={setSituacaoIdentificada}
                      providencia={providencia}
                      setProvidencia={setProvidencia}
                      retornoNecessario={retornoNecessario}
                      setRetornoNecessario={setRetornoNecessario}
                      dataRetorno={dataRetorno}
                      setDataRetorno={setDataRetorno}
                      compacto
                    />

                    <ResumoHistorico historico={atendimento.historico} />

                    <DialogFooter>
                      <SecondaryButton type="button" onClick={() => setModalOpen(false)} disabled={salvando}>
                        Conferir depois
                      </SecondaryButton>
                      <button
                        type="button"
                        className="button border border-red-200 !bg-red-50 !text-red-700 shadow-none hover:!bg-red-100"
                        onClick={() => abrirModo("naoCompareceu")}
                        disabled={salvando}
                      >
                        <UserX size={16} />
                        Não compareceu
                      </button>
                      <Button type="button" onClick={() => void iniciarAtendimento()} disabled={salvando}>
                        {salvando ? "Iniciando..." : "Iniciar atendimento"}
                      </Button>
                    </DialogFooter>
                  </div>
                )}

                {modoModal === "observacao" && (
                  <form className="grid gap-4" onSubmit={salvarObservacao}>
                    <RegistroGuiado
                      observacao={observacao}
                      setObservacao={setObservacao}
                      situacaoIdentificada={situacaoIdentificada}
                      setSituacaoIdentificada={setSituacaoIdentificada}
                      providencia={providencia}
                      setProvidencia={setProvidencia}
                      retornoNecessario={retornoNecessario}
                      setRetornoNecessario={setRetornoNecessario}
                      dataRetorno={dataRetorno}
                      setDataRetorno={setDataRetorno}
                    />
                    <DialogFooter>
                      <SecondaryButton type="button" onClick={() => setModalOpen(false)} disabled={salvando}>
                        Cancelar
                      </SecondaryButton>
                      <Button disabled={salvando}>{salvando ? "Salvando..." : "Salvar observação"}</Button>
                    </DialogFooter>
                  </form>
                )}

                {modoModal === "encaminhar" && (
                  <form className="grid gap-4" onSubmit={encaminhar}>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Unidade da rede">
                        <Select value={unidadeDestinoId} onChange={(event) => {
                          setUnidadeDestinoId(event.target.value);
                          if (event.target.value) setDestinoExterno("");
                        }}>
                          <option value="">Encaminhamento externo</option>
                          {unidades.map((unidade) => (
                            <option key={unidade.id} value={unidade.id}>
                              {unidade.nome}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Destino externo">
                        <Input
                          value={destinoExterno}
                          onChange={(event) => setDestinoExterno(event.target.value)}
                          disabled={Boolean(unidadeDestinoId)}
                          placeholder="Ex.: Conselho Tutelar, Saúde, Defensoria"
                        />
                      </Field>
                    </div>
                    <Field label="Motivo">
                      <textarea
                        className="input"
                        value={motivoEncaminhamento}
                        onChange={(event) => setMotivoEncaminhamento(event.target.value)}
                        required
                        placeholder="Explique por que este atendimento precisa seguir para outro setor."
                      />
                    </Field>
                    <Field label="Observações, opcional">
                      <textarea
                        className="input"
                        value={observacaoEncaminhamento}
                        onChange={(event) => setObservacaoEncaminhamento(event.target.value)}
                        placeholder="Documentos entregues, orientação dada, prazo combinado..."
                      />
                    </Field>
                    <DialogFooter>
                      <SecondaryButton type="button" onClick={() => setModalOpen(false)} disabled={salvando}>
                        Cancelar
                      </SecondaryButton>
                      <Button disabled={salvando}>{salvando ? "Encaminhando..." : "Encaminhar atendimento"}</Button>
                    </DialogFooter>
                  </form>
                )}

                {modoModal === "concluir" && (
                  <form className="grid gap-4" onSubmit={concluir}>
                    <Field label="Relato final">
                      <textarea
                        className="input"
                        value={relato}
                        onChange={(event) => setRelato(event.target.value)}
                        placeholder="Se quiser, escreva um resumo final. Se deixar vazio, os campos guiados viram o relato."
                      />
                    </Field>
                    <DialogFooter>
                      <SecondaryButton type="button" onClick={() => setModalOpen(false)} disabled={salvando}>
                        Cancelar
                      </SecondaryButton>
                      <Button disabled={salvando}>{salvando ? "Concluindo..." : "Concluir atendimento"}</Button>
                    </DialogFooter>
                  </form>
                )}

                {modoModal === "naoCompareceu" && (
                  <form className="grid gap-4" onSubmit={marcarNaoCompareceu}>
                    <div className="rounded-feature border border-red-200 bg-red-50 p-4">
                      <div className="flex gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-white text-red-700 shadow-sm">
                          <UserX size={18} />
                        </span>
                        <div>
                          <strong className="block text-sm text-red-900">Confirmar não comparecimento?</strong>
                          <p className="mt-1 text-sm leading-6 text-red-800">
                            A senha será marcada como desistência e o caso será encerrado como cancelado.
                          </p>
                        </div>
                      </div>
                    </div>
                    <Field label="Motivo, opcional">
                      <textarea
                        className="input"
                        value={motivoNaoCompareceu}
                        onChange={(event) => setMotivoNaoCompareceu(event.target.value)}
                        placeholder="Ex.: chamado três vezes, cidadão saiu da unidade, não respondeu..."
                      />
                    </Field>
                    <DialogFooter>
                      <SecondaryButton type="button" onClick={() => setModalOpen(false)} disabled={salvando}>
                        Cancelar
                      </SecondaryButton>
                      <button
                        className="button border border-red-200 !bg-red-600 !text-white hover:!bg-red-700"
                        disabled={salvando}
                      >
                        {salvando ? "Marcando..." : "Confirmar não compareceu"}
                      </button>
                    </DialogFooter>
                  </form>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function ResumoHistorico({ historico }: { historico: EntradaHistorico[] }) {
  return (
    <div className="rounded-feature border border-meta-divider bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="!text-base">Histórico rápido</h3>
        <Badge tone="neutral">{historico.length}</Badge>
      </div>
      {historico.length === 0 ? (
        <EmptyState title="Sem histórico recente" text="Pode iniciar o atendimento normalmente." />
      ) : (
        <div className="grid gap-2">
          {historico.slice(0, 4).map((entrada, index) => (
            <div className="rounded-card bg-meta-soft-gray p-3" key={`${entrada.quando}-${index}`}>
              <strong className="block text-sm text-meta-charcoal">{entrada.o_que}</strong>
              <small className="mt-1 block text-xs leading-5 text-meta-slate">
                {formatarDataHora(entrada.quando)} · {entrada.unidade}{entrada.detalhe ? ` · ${entrada.detalhe}` : ""}
              </small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RegistroGuiado({
  observacao,
  setObservacao,
  situacaoIdentificada,
  setSituacaoIdentificada,
  providencia,
  setProvidencia,
  retornoNecessario,
  setRetornoNecessario,
  dataRetorno,
  setDataRetorno,
  compacto = false,
}: {
  observacao: string;
  setObservacao: (value: string) => void;
  situacaoIdentificada: string;
  setSituacaoIdentificada: (value: string) => void;
  providencia: string;
  setProvidencia: (value: string) => void;
  retornoNecessario: string;
  setRetornoNecessario: (value: string) => void;
  dataRetorno: string;
  setDataRetorno: (value: string) => void;
  compacto?: boolean;
}) {
  return (
    <div className="grid gap-4 rounded-feature border border-meta-divider bg-meta-soft-gray p-4">
      <div>
        <h3 className="!text-base">Registro do atendimento</h3>
        <p className="mt-1 text-xs leading-5 text-meta-slate">
          Preencha só o que fizer sentido. O sistema organiza isso no histórico do caso.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Situação identificada">
          <Select value={situacaoIdentificada} onChange={(event) => setSituacaoIdentificada(event.target.value)}>
            <option value="">Selecione, se aplicável</option>
            <option value="Atualização cadastral ou orientação simples">Atualização/orientação</option>
            <option value="Vulnerabilidade social relatada">Vulnerabilidade social</option>
            <option value="Solicitação de benefício eventual">Benefício eventual</option>
            <option value="Acompanhamento familiar em andamento">Acompanhamento familiar</option>
            <option value="Violação de direitos ou risco social">Risco/violação de direitos</option>
            <option value="Encaminhamento solicitado por outro órgão">Encaminhamento de outro órgão</option>
          </Select>
        </Field>

        <Field label="Providência">
          <Select value={providencia} onChange={(event) => setProvidencia(event.target.value)}>
            <option value="">Selecione, se aplicável</option>
            <option value="Orientação registrada">Orientação registrada</option>
            <option value="Documentos conferidos">Documentos conferidos</option>
            <option value="Benefício avaliado ou solicitado">Benefício avaliado/solicitado</option>
            <option value="Encaminhamento preparado">Encaminhamento preparado</option>
            <option value="Retorno combinado com o cidadão">Retorno combinado</option>
            <option value="Atendimento concluído no setor">Concluído no setor</option>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-[0.8fr_1fr]">
        <Field label="Retorno necessário?">
          <Select value={retornoNecessario} onChange={(event) => setRetornoNecessario(event.target.value)}>
            <option value="">Definir depois</option>
            <option value="NAO">Não</option>
            <option value="SIM">Sim</option>
          </Select>
        </Field>

        {retornoNecessario === "SIM" && (
          <Field label="Data prevista">
            <Input type="date" value={dataRetorno} onChange={(event) => setDataRetorno(event.target.value)} />
          </Field>
        )}
      </div>

      <Field label={compacto ? "Observação inicial" : "Observação/evolução"}>
        <textarea
          className="input"
          value={observacao}
          onChange={(event) => setObservacao(event.target.value)}
          placeholder="Ex.: cidadão trouxe documentos, orientação dada, pendência, combinado de retorno..."
        />
      </Field>
    </div>
  );
}

function MiniStat({
  title,
  value,
  detail,
  icon: Icon,
  tone,
  onClick,
}: {
  onClick?: () => void;
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

  const content = (
    <Card className="h-full !p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">{title}</p>
          <strong className="mt-2 block text-3xl text-meta-charcoal">{value.toLocaleString("pt-BR")}</strong>
          <small className="mt-1 block text-meta-slate">{detail}</small>
          {onClick && <span className="mt-2 block text-xs font-semibold text-primary">Ver registros →</span>}
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-pill ${toneClass}`}>
          <Icon size={18} />
        </span>
      </div>
    </Card>
  );
  return onClick ? <button type="button" onClick={onClick} aria-label={`Ver ${title.toLowerCase()}`} className="h-full text-left rounded-card transition-shadow hover:shadow-lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{content}</button> : content;
}

function formatarDataHora(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatarDataSimples(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
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

function tituloDoModal(modo: "inicio" | "observacao" | "encaminhar" | "concluir" | "naoCompareceu", senha: string) {
  const titulos = {
    inicio: `Conferir senha ${senha}`,
    observacao: "Registrar observação",
    encaminhar: "Encaminhar atendimento",
    concluir: "Concluir atendimento",
    naoCompareceu: "Não compareceu",
  };
  return titulos[modo];
}

function descricaoDoModal(modo: "inicio" | "observacao" | "encaminhar" | "concluir" | "naoCompareceu") {
  const descricoes = {
    inicio: "Confira cidadão, serviço e histórico antes de assumir o atendimento.",
    observacao: "Adicione uma evolução sem encerrar o caso.",
    encaminhar: "Envie o caso para outra unidade da rede ou registre um destino externo.",
    concluir: "Finalize o atendimento e libere a senha da fila.",
    naoCompareceu: "Use quando a senha foi chamada e o cidadão não se apresentou.",
  };
  return descricoes[modo];
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
  if (value === "EM_ATENDIMENTO") return "warn";
  return "bad";
}
