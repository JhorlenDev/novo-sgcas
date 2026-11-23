"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, ListChecks, Search, UserPlus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Aba, Abas, Badge, Card, PageHeader } from "@/components/ui";
import { alertasDoErro, justificativaValida, mensagemDeDuplicidade, useDuplicidade } from "@/components/duplicidade/aviso";
import { BuscaDeCidadao } from "@/components/recepcao/busca";
import { JanelaDePergunta, JanelaDeRegistro, JanelaDeResultado } from "@/components/recepcao/janelas";
import { DesfechosDoBalcao, EncaminhamentosAguardando, PainelDoCidadao } from "@/components/recepcao/painel-do-cidadao";
import { FilaSomenteLeitura, PainelResumoRecepcao, UltimosAtendimentos } from "@/components/recepcao/resumo";
import type { AcaoAtendimento, HistoricoResponse, ResultadoAtendimento } from "@/components/recepcao/tipos";
import { api, mensagemDaApi } from "@/lib/api";
import { useAvisoDeCarga } from "@/lib/use-aviso-de-carga";
import type {
  AlertaDeDuplicidade, AtendimentoRecepcao, Caso, CidadaoLista, EncaminhamentoResumo, EntradaHistorico,
  PainelRecepcao, Senha, Servico,
} from "@/types/sgcas";

// Nomes das leituras no aviso de falha; os dois da pessoa também trocam o texto do painel.
const HISTORICO_DA_PESSOA = "o histórico da pessoa";
const CASOS_DA_PESSOA = "os casos da pessoa";
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
  const { aviso: avisoDaCarga, falhou: cargaFalhou, ler } = useAvisoDeCarga();

  const carregarUltimosAtendimentos = useCallback(async () => {
    const data = await ler<AtendimentoRecepcao[]>("os atendimentos recentes", "/reception/atendimentos", []);
    setUltimosAtendimentos(data);
  }, [ler]);

  const carregarPainel = useCallback(async () => {
    const data = await ler<PainelRecepcao | null>("o resumo da recepção", "/reception/painel", null);
    setPainel(data);
    if (data?.ultimos_atendimentos) {
      setUltimosAtendimentos(data.ultimos_atendimentos);
    }
  }, [ler]);

  const carregarFila = useCallback(async () => {
    const data = await ler<Senha[]>("a fila", "/queues/", []);
    setFila(data);
  }, [ler]);

  useEffect(() => {
    // Fora do corpo do efeito, como nas outras telas: a primeira carga não encadeia renderizações.
    const timer = window.setTimeout(() => {
      void ler<Servico[]>("os serviços", "/institutional/services?unidade=todas", []).then(setServicos);
      void carregarUltimosAtendimentos();
      void carregarPainel();
      void carregarFila();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [carregarFila, carregarPainel, carregarUltimosAtendimentos, ler]);

  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) {
      return;
    }

    const timer = window.setTimeout(() => {
      void ler<CidadaoLista[]>("a busca de cidadãos", `/citizens/?busca=${encodeURIComponent(termo)}`, [])
        .then(setCidadaos);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [busca, ler]);

  function mudarBusca(termo: string) {
    setBusca(termo);
    setCidadao(null);
    setCasos([]);
    setHistorico([]);
    if (termo.trim().length < 2) {
      setCidadaos([]);
    }
  }

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
      ler<HistoricoResponse>(HISTORICO_DA_PESSOA, `/citizens/${selecionado.id}/historico`, { cidadao: selecionado, entradas: [] }),
      ler<Caso[]>(CASOS_DA_PESSOA, `/cases/?cidadao=${selecionado.id}`, []),
      ler<EncaminhamentoResumo[]>("os encaminhamentos da pessoa", `/referrals/recebidos?cidadao=${selecionado.id}`, []),
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
        action={
          <Link href="/cidadaos/novo" className="button">
            <UserPlus size={16} aria-hidden="true" />
            Novo cidadão
          </Link>
        }
      />

      {avisoDaCarga && <div className="notice mb-4" role="alert">{avisoDaCarga}</div>}

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
            <span>Buscar<span className="max-sm:hidden"> cidadão</span></span>
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
            <BuscaDeCidadao
              busca={busca}
              onBusca={mudarBusca}
              resultados={cidadaos}
              cidadao={cidadao}
              onSelecionar={(item) => void selecionarCidadao(item)}
              onTrocar={() => setCidadao(null)}
            />

            {cidadao && (
              // As ações vêm primeiro no código para aparecerem antes do histórico no celular;
              // no computador elas ficam na coluna da direita.
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
                <DesfechosDoBalcao mensagem={mensagem} onEscolher={abrirAcao} />

                <div className="grid min-w-0 gap-4 xl:col-start-1 xl:row-start-1">
                  {pendentes.length > 0 && <EncaminhamentosAguardando encaminhamentos={pendentes} nome={cidadao.nome} />}
                  <Card className="min-w-0">
                    <PainelDoCidadao
                      casos={casos}
                      historico={historico}
                      casosIndisponiveis={cargaFalhou(CASOS_DA_PESSOA)}
                      historicoIndisponivel={cargaFalhou(HISTORICO_DA_PESSOA)}
                    />
                  </Card>
                </div>
              </div>
            )}
          </>
        )}

        {aba === "recentes" && <UltimosAtendimentos atendimentos={ultimosAtendimentos} completo />}

        {aba === "fila" && <FilaSomenteLeitura fila={fila} onAtualizar={() => void carregarFila()} />}
      </div>

      <JanelaDeRegistro
        aberta={acaoOpen}
        onAbertaChange={setAcaoOpen}
        acao={acao}
        servicos={servicos}
        servicoId={servicoId}
        onServico={setServicoId}
        prioridade={prioridade}
        onPrioridade={setPrioridade}
        vinculaveis={vinculaveis}
        encaminhamentoDaVisita={encaminhamentoDaVisita}
        onEncaminhamento={(id) => {
          setEncaminhamentoEscolhido(id);
          setAlertasDoServidor([]);
        }}
        possivelDuplicidade={Boolean(servicoSelecionado) && casosParecidos.length > 0 && alertasDeDuplicidade.length === 0}
        alertasDeDuplicidade={alertasDeDuplicidade}
        justificativa={justificativa}
        onJustificativa={setJustificativa}
        observacao={observacao}
        onObservacao={setObservacao}
        motivo={motivo}
        onMotivo={setMotivo}
        mensagem={mensagem}
        registrando={registrando}
        podeRegistrar={Boolean(servicoSelecionado) && !registrando && !(acao === "ENCAMINHADO" && faltaJustificar)}
        onRegistrar={() => void registrar(acao)}
      />

      <JanelaDePergunta aberta={avisoOpen} onAbertaChange={setAvisoOpen} />

      <JanelaDeResultado aberta={successOpen} onAbertaChange={setSuccessOpen} resultado={resultado} />
    </AppShell>
  );
}

function normalizar(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}
