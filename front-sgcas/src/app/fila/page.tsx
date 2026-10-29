"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  ClipboardEdit,
  FolderOpen,
  ListChecks,
  RefreshCw,
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
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, SecondaryButton, SectionHeading, Select, Stat } from "@/components/ui";
import { DetalheDoEncaminhamento } from "@/components/encaminhamentos/detalhe";
import { CabecalhoDoEncaminhamento, FichaCompleta } from "@/components/encaminhamentos/ficha";
import {
  CamposDeEncaminhamento, FORMULARIO_VAZIO, corpoDoEncaminhamento, validarEncaminhamento,
  type FormularioDeEncaminhamento,
} from "@/components/encaminhamentos/formulario";
import { ApiError, api, mensagemDaApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { rotuloPrioridade, rotuloSituacao, tomDaPrioridade, tomDoCaso } from "@/lib/casos";
import { formatarDataCurta } from "@/lib/datas";
import type { Cidadao, EncaminhamentoDetalhe, EntradaHistorico, Caso, PainelAtendente, Senha, Unidade } from "@/types/sgcas";

const indicadores = {
  atendidos_hoje: { titulo: "Atendidos hoje", descricao: "Senhas finalizadas por você hoje nesta unidade." },
  aguardando_na_fila: { titulo: "Aguardando na fila", descricao: "Senhas aguardando nesta unidade, por prioridade e ordem de chegada." },
  finalizados_hoje: { titulo: "Finalizados", descricao: "Casos concluídos ou encaminhados por você hoje nesta unidade." },
  casos_em_acompanhamento: { titulo: "Acompanhamento", descricao: "Casos da unidade que não estão concluídos nem cancelados." },
};
type Indicador = keyof typeof indicadores;

// Ação que descarta algo (marcar não comparecimento): vermelho discreto, sem preencher o botão.
const PERIGO = "!border-red-200 !text-red-700 hover:!bg-red-50";
type DetalhesIndicador = { tipo: "senhas"; registros: Senha[] } | { tipo: "casos"; registros: Caso[] };

type SenhaAberta = Senha & { operador_nome: string | null; pode_retomar: boolean };

type AtendimentoMontado = {
  senha: Senha;
  cidadao: Cidadao;
  caso: Caso | null;
  // Quando a pessoa chegou encaminhada de outra unidade: a ficha que veio com ela.
  encaminhamento_recebido: EncaminhamentoDetalhe | null;
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
  const [formEncaminhamento, setFormEncaminhamento] = useState<FormularioDeEncaminhamento>(FORMULARIO_VAZIO);
  // Os erros só aparecem depois da primeira tentativa de enviar e acompanham o que está digitado.
  const [tentouEncaminhar, setTentouEncaminhar] = useState(false);
  const errosEncaminhamento = tentouEncaminhar ? validarEncaminhamento(formEncaminhamento) : {};
  const [fichaAberta, setFichaAberta] = useState<string | null>(null);
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
      setFormEncaminhamento(FORMULARIO_VAZIO);
      setTentouEncaminhar(false);
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
    setTentouEncaminhar(true);
    if (Object.keys(validarEncaminhamento(formEncaminhamento)).length > 0) return;

    setSalvando(true);
    setMensagem("");
    try {
      await api(`/cases/${atendimento.caso.id}/encaminhar`, {
        method: "POST",
        body: JSON.stringify(corpoDoEncaminhamento(formEncaminhamento)),
      });
      setAtendimento(null);
      setAtendimentoIniciado(false);
      setModalOpen(false);
      setMensagem("Atendimento encaminhado com a ficha. A unidade de destino foi avisada.");
      await carregar();
    } catch (error) {
      setMensagem(mensagemDaApi(error, "Não foi possível encaminhar."));
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
          // O registro guiado já foi gravado como observação ao iniciar o atendimento, e a
          // API acrescenta o relato ao histórico do caso: reenviá-lo aqui o duplicaria.
          relato: relato.trim() || "Atendimento concluído sem observações adicionais.",
        }),
      });
      setAtendimento(null);
      setAtendimentoIniciado(false);
      setModalOpen(false);
      setMensagem("Atendimento concluído e senha finalizada.");
      await carregar();
    } catch (error) {
      // 409: o caso já foi encerrado (por outra aba ou outro técnico). A API diz
      // em que situação ele está; o texto genérico esconderia o motivo.
      setMensagem(
        error instanceof ApiError && error.status === 409
          ? error.message
          : "Não foi possível concluir o atendimento.",
      );
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

      <div className="grid gap-3 empty:hidden">
        {!unidadeId && <div className="notice">Seu usuário não tem unidade de lotação definida. Solicite o vínculo a um administrador para chamar senhas.</div>}
        {user && !podeChamar && <div className="notice">Seu perfil não tem permissão para chamar senhas.</div>}
        {erroCarga && <div className="notice" role="alert">{erroCarga}</div>}
        {mensagem && <div className="notice" role="status">{mensagem}</div>}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <Stat onClick={() => void abrirIndicador("atendidos_hoje")} label="Atendidos hoje" value={(painel?.atendidos_hoje ?? 0).toLocaleString("pt-BR")} hint="Finalizados pelo atendente" icon={CheckCircle2} />
        <Stat onClick={() => void abrirIndicador("aguardando_na_fila")} label="Aguardando na fila" value={(painel?.aguardando_na_fila ?? fila.length).toLocaleString("pt-BR")} hint="Próximas chamadas" icon={ListChecks} highlight />
        <Stat onClick={() => void listarAbertos()} label="Em atendimento" value={(painel?.em_atendimento ?? 0).toLocaleString("pt-BR")} hint="Senhas já chamadas" icon={Stethoscope} />
        <Stat onClick={() => void abrirIndicador("finalizados_hoje")} label="Finalizados" value={(painel?.finalizados_hoje ?? 0).toLocaleString("pt-BR")} hint="Casos fechados hoje" icon={Clock3} />
        <Stat onClick={() => void abrirIndicador("casos_em_acompanhamento")} label="Acompanhamento" value={(painel?.casos_em_acompanhamento ?? 0).toLocaleString("pt-BR")} hint="Casos ativos na unidade" icon={FolderOpen} />
      </div>

      <div className="grid two mt-4 items-start">
        <Card>
          <SectionHeading
            title="Fila"
            count={fila.length}
            action={
              <SecondaryButton size="sm" onClick={() => void carregar()} disabled={!unidadeId}>
                <RefreshCw size={14} aria-hidden="true" />
                Atualizar fila
              </SecondaryButton>
            }
          />
          {user?.unidade?.nome && <p className="-mt-1 mb-3 text-sm text-meta-slate">{user.unidade.nome}</p>}
          {fila.length === 0 ? (
            <EmptyState title="Fila vazia" text="A recepção ainda não encaminhou atendimentos." />
          ) : (
            <ul>
              {fila.map((senha) => (
                <li className="line-row flex flex-wrap items-center gap-x-3 gap-y-2" key={senha.id}>
                  <span className="flex h-10 min-w-14 shrink-0 items-center justify-center rounded-lg bg-primary px-2.5 text-[15px] font-bold tabular-nums text-primary-foreground">
                    {senha.senha}
                  </span>
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block text-sm font-semibold text-meta-charcoal">{senha.cidadao_nome}</span>
                    <small className="block">{senha.servico}</small>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={tomDaPrioridade(senha.prioridade)}>{rotuloPrioridade(senha.prioridade)}</Badge>
                    <small className="tabular-nums">{formatarDataCurta(senha.criado_em)}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 id="atendimento-atual">Atendimento atual</h2>
          {!atendimento ? (
            <EmptyState title={recuperando && podeChamar && unidadeId ? "Recuperando atendimento..." : "Nenhum atendimento iniciado"} text="Use o botão chamar próximo para conferir a senha antes de iniciar." />
          ) : (
            <div className="grid gap-4">
              <div className="rounded-lg border border-meta-divider bg-meta-warm-gray p-4">
                <div className="row">
                  <Badge tone="info">Senha {atendimento.senha.senha}</Badge>
                  <Badge tone={tomDaPrioridade(atendimento.senha.prioridade)}>{rotuloPrioridade(atendimento.senha.prioridade)}</Badge>
                  <Badge tone={atendimentoIniciado ? "good" : "warn"}>
                    {atendimentoIniciado ? "Atendimento iniciado" : "Aguardando confirmação"}
                  </Badge>
                </div>
                <h3 className="mt-3">{atendimento.cidadao.nome}</h3>
                <p className="text-sm text-meta-slate">{atendimento.senha.servico}</p>
                {atendimento.caso && (
                  <div className="mt-3 rounded-lg border border-meta-divider bg-white p-3">
                    <p className="text-[13px] font-semibold text-meta-slate">Caso em atendimento</p>
                    <strong className="text-sm">{atendimento.caso.protocolo}</strong>
                    <p className="text-sm text-meta-slate">{atendimento.caso.descricao || rotuloSituacao(atendimento.caso.situacao)}</p>
                  </div>
                )}
                {atendimento.encaminhamento_recebido && (
                  <div className="mt-3 flex flex-col gap-3 rounded-lg border border-primary/30 bg-accent p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm">
                      <p className="text-[13px] font-semibold text-meta-slate">Encaminhamento recebido</p>
                      <strong>
                        De {atendimento.encaminhamento_recebido.unidade_origem_nome || "outra unidade"} · {atendimento.encaminhamento_recebido.categoria_rotulo}
                      </strong>
                    </div>
                    <SecondaryButton type="button" size="sm" className="shrink-0" onClick={() => setFichaAberta(atendimento.encaminhamento_recebido?.id ?? null)}>
                      Ver ficha completa
                    </SecondaryButton>
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
                    <ArrowRight size={16} aria-hidden="true" />
                  </Button>
                  <SecondaryButton type="button" className={PERIGO} onClick={() => abrirModo("naoCompareceu")}>
                    <UserX size={16} aria-hidden="true" />
                    Não compareceu
                  </SecondaryButton>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <SecondaryButton type="button" onClick={() => abrirModo("observacao")}>
                    <ClipboardEdit size={15} aria-hidden="true" />
                    Observação
                  </SecondaryButton>
                  <SecondaryButton type="button" onClick={() => abrirModo("encaminhar")}>
                    <Send size={15} aria-hidden="true" />
                    Encaminhar
                  </SecondaryButton>
                  <Button type="button" onClick={() => abrirModo("concluir")}>
                    <CheckCircle2 size={15} aria-hidden="true" />
                    Concluir
                  </Button>
                  <SecondaryButton type="button" className={PERIGO} onClick={() => abrirModo("naoCompareceu")}>
                    <UserX size={15} aria-hidden="true" />
                    Não veio
                  </SecondaryButton>
                </div>
              )}
              <h3 className="!text-base">Histórico do cidadão</h3>
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

      <Card className="mt-4">
        <SectionHeading title="Últimos atendimentos" count={painel?.ultimos_atendimentos?.length ?? 0} />
        <p className="-mt-1 mb-3 text-sm text-meta-slate">Casos mais recentes assumidos por você.</p>

        {!painel?.ultimos_atendimentos?.length ? (
          <EmptyState title="Sem atendimentos recentes" text="Quando você iniciar ou concluir casos, eles aparecem aqui." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {painel.ultimos_atendimentos.map((caso) => (
              <article className="rounded-lg border border-meta-divider bg-white p-4" key={caso.id}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-meta-charcoal">{caso.cidadao_nome}</strong>
                  <Badge tone={tomDoCaso(caso.situacao)}>{rotuloSituacao(caso.situacao)}</Badge>
                </div>
                <p className="text-sm font-medium text-meta-charcoal">{caso.servico_nome || caso.protocolo}</p>
                <p className="mt-1 line-clamp-3 text-sm leading-6 text-meta-slate">{caso.descricao || "Sem relato registrado."}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge tone={tomDaPrioridade(caso.prioridade)}>{rotuloPrioridade(caso.prioridade)}</Badge>
                  <small className="tabular-nums">{formatarDataCurta(caso.aberto_em)}</small>
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
          {erroDetalhes ? <div role="alert" className="grid gap-3"><p className="text-sm">{erroDetalhes}</p><SecondaryButton className="w-fit" onClick={() => indicador && void abrirIndicador(indicador)}>Tentar novamente</SecondaryButton></div>
            : !detalhes ? <p className="text-sm text-meta-slate" role="status">Carregando registros...</p>
            : detalhes.registros.length === 0 ? <p className="text-sm text-meta-slate">Nenhum registro neste indicador.</p>
            : <div>
              <p className="mb-1 text-sm text-meta-slate">{detalhes.registros.length} registro(s)</p>
              <ul>
                {detalhes.tipo === "senhas" ? detalhes.registros.map((senha) => (
                  <li key={senha.id} className="line-row">
                    <strong className="block">{senha.senha} · {senha.cidadao_nome}</strong>
                    <span className="block">{senha.servico || "Serviço não informado"}</span>
                    <small>{rotuloPrioridade(senha.prioridade)} · {formatarDataCurta(senha.criado_em)}</small>
                  </li>
                )) : detalhes.registros.map((caso) => (
                  <li key={caso.id} className="line-row">
                    <strong className="block">{caso.protocolo} · {caso.cidadao_nome}</strong>
                    <span className="block">{caso.servico_nome || caso.descricao || "Serviço não informado"}</span>
                    <span className="block">{rotuloSituacao(caso.situacao)}</span>
                    <small>{caso.tecnico_nome || "Sem técnico responsável"} · {caso.unidade_nome}</small>
                  </li>
                ))}
              </ul>
            </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={listaOpen} onOpenChange={setListaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Senhas em atendimento</DialogTitle>
            <DialogDescription>Selecione uma senha sua para reabrir em Atendimento atual. As demais mostram quem está atendendo.</DialogDescription>
          </DialogHeader>
          {carregandoAbertos ? <p className="text-sm text-meta-slate" role="status">Carregando atendimentos...</p> : erroAbertos ? (
            <div role="alert" className="grid gap-3"><p className="text-sm">{erroAbertos}</p><SecondaryButton className="w-fit" onClick={() => void listarAbertos()}>Tentar novamente</SecondaryButton></div>
          ) : abertos.length === 0 ? <p className="text-sm text-meta-slate">Nenhuma senha em atendimento nesta unidade.</p> : (
            <div className="grid gap-2.5">
              {abertos.map((senha) => (
                <button key={senha.id} type="button" className="rounded-lg border border-meta-divider bg-white p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-meta-warm-gray disabled:opacity-60 disabled:hover:border-meta-divider disabled:hover:bg-white" disabled={!senha.pode_retomar || retomando !== null} onClick={() => void retomar(senha.id)}>
                  <strong className="block text-sm">{senha.senha} · {senha.cidadao_nome}</strong>
                  <span className="block text-sm">{senha.servico}</span>
                  <small className="block text-meta-slate">{senha.operador_nome ?? "Sem atendente"} · {retomando === senha.id ? "Abrindo..." : senha.pode_retomar ? "Retomar atendimento" : "Com outro atendente"}</small>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <DetalheDoEncaminhamento id={fichaAberta} onClose={() => setFichaAberta(null)} onMudou={() => void carregar()} />

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-3xl">
          {atendimento && (
            <>
              <DialogHeader>
                <DialogTitle>{tituloDoModal(modoModal, atendimento.senha.senha)}</DialogTitle>
                <DialogDescription>{descricaoDoModal(modoModal)}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-4">
                <div className="rounded-lg border border-meta-divider bg-meta-warm-gray p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="mb-2 flex flex-wrap gap-2">
                        <Badge tone="info">Senha {atendimento.senha.senha}</Badge>
                        <Badge tone={tomDaPrioridade(atendimento.senha.prioridade)}>{rotuloPrioridade(atendimento.senha.prioridade)}</Badge>
                      </div>
                      <h3 className="text-lg font-semibold text-meta-charcoal">{atendimento.cidadao.nome}</h3>
                      <p className="mt-0.5 text-sm text-meta-slate">{atendimento.senha.servico || "Serviço não informado"}</p>
                    </div>
                    {atendimento.caso && (
                      <div className="text-sm md:text-right">
                        <p className="text-[13px] font-semibold text-meta-slate">Caso</p>
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

                    {atendimento.encaminhamento_recebido && (
                      <details open className="rounded-lg border border-primary/30 bg-accent p-3.5 sm:p-4">
                        <summary className="cursor-pointer text-sm font-semibold text-meta-charcoal">
                          Encaminhado de {atendimento.encaminhamento_recebido.unidade_origem_nome || "outra unidade"}: a ficha que veio com a pessoa
                        </summary>
                        <div className="mt-3 grid gap-3">
                          <CabecalhoDoEncaminhamento encaminhamento={atendimento.encaminhamento_recebido} />
                          <FichaCompleta
                            encaminhamento={atendimento.encaminhamento_recebido}
                            ficha={atendimento.encaminhamento_recebido.ficha}
                          />
                        </div>
                      </details>
                    )}

                    <ResumoHistorico historico={atendimento.historico} />

                    <DialogFooter>
                      <SecondaryButton type="button" onClick={() => setModalOpen(false)} disabled={salvando}>
                        Conferir depois
                      </SecondaryButton>
                      <SecondaryButton type="button" className={PERIGO} onClick={() => abrirModo("naoCompareceu")} disabled={salvando}>
                        <UserX size={16} aria-hidden="true" />
                        Não compareceu
                      </SecondaryButton>
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
                  <form className="grid gap-4" onSubmit={encaminhar} noValidate>
                    <CamposDeEncaminhamento
                      valor={formEncaminhamento}
                      onChange={setFormEncaminhamento}
                      unidades={unidades}
                      erros={errosEncaminhamento}
                    />
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
                        placeholder="Se quiser, escreva um resumo final. A situação, a providência e as observações já ficam registradas no caso."
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
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
                      <strong className="flex items-center gap-2 text-sm text-red-900">
                        <UserX size={16} aria-hidden="true" className="shrink-0" />
                        Confirmar não comparecimento?
                      </strong>
                      <p className="mt-1 text-sm leading-6 text-red-800">
                        A senha será marcada como desistência e o caso será encerrado como cancelado.
                      </p>
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
                      <button className="button danger" disabled={salvando}>
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
    <div className="rounded-lg border border-meta-divider bg-white p-3.5 sm:p-4">
      <SectionHeading title="Histórico rápido" count={historico.length} />
      {historico.length === 0 ? (
        <EmptyState title="Sem histórico recente" text="Pode iniciar o atendimento normalmente." />
      ) : (
        <ul>
          {historico.slice(0, 4).map((entrada, index) => (
            <li className="line-row" key={`${entrada.quando}-${index}`}>
              <strong className="block">{entrada.o_que}</strong>
              <small className="mt-0.5 block">
                {formatarDataCurta(entrada.quando)} · {entrada.unidade}{entrada.detalhe ? ` · ${entrada.detalhe}` : ""}
              </small>
            </li>
          ))}
        </ul>
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
    <div className="grid gap-4 rounded-lg border border-meta-divider bg-meta-warm-gray p-3.5 sm:p-4">
      <div>
        <h3 className="!text-base">Registro do atendimento</h3>
        <p className="mt-1 text-[13px] leading-5 text-meta-slate">
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

      <div className="grid gap-4 sm:grid-cols-2">
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

function formatarDataSimples(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
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
