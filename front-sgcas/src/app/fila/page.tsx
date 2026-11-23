"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3, FolderOpen, ListChecks, Stethoscope } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button, PageHeader, Stat } from "@/components/ui";
import { DetalheDoEncaminhamento } from "@/components/encaminhamentos/detalhe";
import {
  FORMULARIO_VAZIO, corpoDoEncaminhamento, validarEncaminhamento, type FormularioDeEncaminhamento,
} from "@/components/encaminhamentos/formulario";
import { AtendimentoAtual } from "@/components/fila/atendimento-atual";
import { DetalhesDoIndicador, SenhasEmAtendimento } from "@/components/fila/indicadores";
import { JanelaDoAtendimento } from "@/components/fila/janela-do-atendimento";
import { FilaDaUnidade, UltimosAtendimentos } from "@/components/fila/listas";
import { REGISTRO_VAZIO, textoDoRegistro, type RegistroDoAtendimento } from "@/components/fila/registro-guiado";
import type { AtendimentoMontado, DetalhesIndicador, Indicador, ModoDaJanela, SenhaAberta } from "@/components/fila/tipos";
import { api, ApiError, avisoDeCarga, lerOuPadrao, mensagemDaApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Caso, PainelAtendente, Senha, Unidade } from "@/types/sgcas";

const PODEM_CHAMAR = ["ADMIN", "COORDENADOR", "ASSISTENTE_SOCIAL", "TECNICO", "GESTOR_ACOES_ITINERANTES"];

export default function FilaPage() {
  const { user } = useAuth();
  const unidadeId = user?.unidade?.id;
  const podeChamar = Boolean(user && PODEM_CHAMAR.includes(user.papel));

  const [fila, setFila] = useState<Senha[]>([]);
  const [painel, setPainel] = useState<PainelAtendente | null>(null);
  const [erroCarga, setErroCarga] = useState("");
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [erroUnidades, setErroUnidades] = useState("");
  const [mensagem, setMensagem] = useState("");

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
  const [atendimento, setAtendimento] = useState<AtendimentoMontado | null>(null);
  const [atendimentoIniciado, setAtendimentoIniciado] = useState(false);
  const [fichaAberta, setFichaAberta] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modoModal, setModoModal] = useState<ModoDaJanela>("inicio");
  const [registro, setRegistro] = useState<RegistroDoAtendimento>(REGISTRO_VAZIO);
  const [relato, setRelato] = useState("");
  const [formEncaminhamento, setFormEncaminhamento] = useState<FormularioDeEncaminhamento>(FORMULARIO_VAZIO);
  // Os erros só aparecem depois da primeira tentativa de enviar e acompanham o que está digitado.
  const [tentouEncaminhar, setTentouEncaminhar] = useState(false);
  const errosEncaminhamento = tentouEncaminhar ? validarEncaminhamento(formEncaminhamento) : {};
  const [motivoNaoCompareceu, setMotivoNaoCompareceu] = useState("");
  const [salvando, setSalvando] = useState(false);

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
    }, 0);
    return () => window.clearTimeout(timer);
  }, [carregar]);

  // As unidades (destinos do encaminhamento) não mudam com a fila: carregam uma vez.
  useEffect(() => {
    const falhas: string[] = [];
    void lerOuPadrao<Unidade[]>("/institutional/units", [], () => falhas.push("as unidades de destino do encaminhamento"))
      .then((lista) => {
        setUnidades(lista);
        setErroUnidades(avisoDeCarga(falhas));
      });
  }, []);

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
      setRegistro(REGISTRO_VAZIO);
      setRelato("");
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
      setRegistro(REGISTRO_VAZIO);
      setRelato("");
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

  async function salvarObservacaoAtual(texto: string) {
    const conteudo = texto.trim();
    if (!atendimento?.caso || !conteudo) return atendimento?.caso ?? null;
    const casoAtualizado = await api<Caso>(`/cases/${atendimento.caso.id}/observacao`, {
      method: "POST",
      body: JSON.stringify({ observacao: conteudo }),
    });
    setAtendimento((atual) => (atual ? { ...atual, caso: casoAtualizado } : atual));
    setRegistro((atual) => ({ ...atual, observacao: "" }));
    return casoAtualizado;
  }

  async function iniciarAtendimento() {
    if (!atendimento) return;
    setSalvando(true);
    setMensagem("");
    try {
      await salvarObservacaoAtual(textoDoRegistro(registro));
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

  function abrirConferencia() {
    setModoModal("inicio");
    setModalOpen(true);
  }

  function abrirModo(modo: Exclude<ModoDaJanela, "inicio">) {
    setModoModal(modo);
    setMensagem("");
    setModalOpen(true);
  }

  async function salvarObservacao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!atendimento?.caso) return;
    setSalvando(true);
    try {
      await salvarObservacaoAtual(textoDoRegistro(registro));
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
        {erroUnidades && <div className="notice" role="alert">{erroUnidades}</div>}
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
        <FilaDaUnidade fila={fila} unidadeNome={user?.unidade?.nome} podeAtualizar={Boolean(unidadeId)} onAtualizar={() => void carregar()} />
        <AtendimentoAtual
          atendimento={atendimento}
          iniciado={atendimentoIniciado}
          recuperando={recuperando && podeChamar && Boolean(unidadeId)}
          onConferir={abrirConferencia}
          onModo={abrirModo}
          onVerFicha={setFichaAberta}
        />
      </div>

      <UltimosAtendimentos casos={painel?.ultimos_atendimentos ?? []} />

      <DetalhesDoIndicador
        indicador={indicador}
        detalhes={detalhes}
        erro={erroDetalhes}
        onFechar={() => { detalheVersao.current++; setIndicador(null); }}
        onTentarDeNovo={(grupo) => void abrirIndicador(grupo)}
      />

      <SenhasEmAtendimento
        aberta={listaOpen}
        onAbertaChange={setListaOpen}
        carregando={carregandoAbertos}
        erro={erroAbertos}
        senhas={abertos}
        retomando={retomando}
        onListar={() => void listarAbertos()}
        onRetomar={(senhaId) => void retomar(senhaId)}
      />

      <DetalheDoEncaminhamento id={fichaAberta} onClose={() => setFichaAberta(null)} onMudou={() => void carregar()} />

      <JanelaDoAtendimento
        aberta={modalOpen}
        onAbertaChange={setModalOpen}
        atendimento={atendimento}
        modo={modoModal}
        onModo={abrirModo}
        mensagem={mensagem}
        salvando={salvando}
        registro={registro}
        onRegistro={setRegistro}
        relato={relato}
        onRelato={setRelato}
        encaminhamento={formEncaminhamento}
        onEncaminhamento={setFormEncaminhamento}
        errosDoEncaminhamento={errosEncaminhamento}
        unidades={unidades}
        motivoNaoCompareceu={motivoNaoCompareceu}
        onMotivoNaoCompareceu={setMotivoNaoCompareceu}
        onIniciar={() => void iniciarAtendimento()}
        onSalvarObservacao={salvarObservacao}
        onEncaminhar={encaminhar}
        onConcluir={concluir}
        onNaoCompareceu={marcarNaoCompareceu}
      />
    </AppShell>
  );
}
