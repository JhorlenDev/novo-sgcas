"use client";

import { CalendarDays, MapPinned, Plus, Users } from "lucide-react";
import { FormEvent, startTransition, useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button, PageHeader, Stat } from "@/components/ui";
import {
  JanelaBalanco, JanelaConcluirAcao, JanelaNovaAcao, RESULTADOS_VAZIOS, type ResultadosDaAcao,
} from "@/components/acoes-itinerantes/janelas";
import { HistoricoDeAcoes, ProximasAcoes, type Ordenacao } from "@/components/acoes-itinerantes/listas";
import { api, avisoDeCarga, lerOuPadrao, mensagemDaApi } from "@/lib/api";
import type { AcaoItinerante, BalancoAcaoItinerante, ResumoAcoesItinerantes } from "@/types/sgcas";

export default function AcoesItinerantesPage() {
  const [acoes, setAcoes] = useState<AcaoItinerante[]>([]);
  const [resumo, setResumo] = useState<ResumoAcoesItinerantes | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("mais-proximas");
  const [mensagem, setMensagem] = useState("");
  const [erroCarga, setErroCarga] = useState("");

  const [modalNovaAberto, setModalNovaAberto] = useState(false);
  const [erroCadastro, setErroCadastro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [modalConcluirAberto, setModalConcluirAberto] = useState(false);
  const [acaoConcluir, setAcaoConcluir] = useState<AcaoItinerante | null>(null);
  const [resultados, setResultados] = useState<ResultadosDaAcao>(RESULTADOS_VAZIOS);
  const [salvandoConclusao, setSalvandoConclusao] = useState(false);
  const [erroConclusao, setErroConclusao] = useState("");

  const [modalBalancoAberto, setModalBalancoAberto] = useState(false);
  const [balancoDetalhe, setBalancoDetalhe] = useState<BalancoAcaoItinerante | null>(null);
  const [carregandoBalanco, setCarregandoBalanco] = useState(false);

  const [acaoParaExcluir, setAcaoParaExcluir] = useState<AcaoItinerante | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const atualizar = useCallback(async () => {
    const falhas: string[] = [];
    const [acoesData, resumoData] = await Promise.all([
      lerOuPadrao<AcaoItinerante[]>("/itinerant-actions/", [], () => falhas.push("as ações")),
      lerOuPadrao<ResumoAcoesItinerantes | null>("/itinerant-actions/resumo", null, () => falhas.push("o resumo")),
    ]);
    setAcoes(acoesData);
    setResumo(resumoData);
    setErroCarga(avisoDeCarga(falhas));
  }, []);

  useEffect(() => {
    startTransition(() => {
      void atualizar().finally(() => setCarregando(false));
    });
  }, [atualizar]);

  async function salvarAcao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErroCadastro("");
    setSalvando(true);

    // Depois de um `await` o React já soltou o evento: o formulário precisa ser guardado antes.
    const formulario = event.currentTarget;
    const form = new FormData(formulario);
    const body = {
      titulo: form.get("titulo") as string,
      local: form.get("local") as string,
      data: form.get("data") as string,
      descricao: (form.get("descricao") as string) || null,
      observacoes: (form.get("observacoes") as string) || null,
    };

    try {
      await api<AcaoItinerante>("/itinerant-actions/", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setModalNovaAberto(false);
      formulario.reset();
      setMensagem(`Ação "${body.titulo}" cadastrada.`);
      await atualizar();
    } catch (erro: unknown) {
      setErroCadastro(mensagemDaApi(erro, "Não foi possível salvar. Verifique os dados informados."));
    } finally {
      setSalvando(false);
    }
  }

  async function excluirAcao() {
    if (!acaoParaExcluir) return;
    setExcluindo(true);
    try {
      await api(`/itinerant-actions/${acaoParaExcluir.id}/excluir`, { method: "DELETE" });
      setMensagem(`Ação "${acaoParaExcluir.titulo}" excluída.`);
      setAcaoParaExcluir(null);
      await atualizar();
    } catch (erro: unknown) {
      setAcaoParaExcluir(null);
      setMensagem(mensagemDaApi(erro, "Não foi possível excluir a ação."));
    } finally {
      setExcluindo(false);
    }
  }

  function abrirConclusao(acao: AcaoItinerante) {
    setAcaoConcluir(acao);
    setResultados(RESULTADOS_VAZIOS);
    setErroConclusao("");
    setModalConcluirAberto(true);
  }

  async function concluirAcao() {
    if (!acaoConcluir) return;
    setErroConclusao("");
    setSalvandoConclusao(true);

    try {
      await api(`/itinerant-actions/${acaoConcluir.id}/concluir`, {
        method: "PATCH",
        body: JSON.stringify({
          cidadaos_atendidos: Number(resultados.cidadaos) || 0,
          participantes: Number(resultados.participantes) || 0,
          beneficios_concedidos: Number(resultados.beneficios) || 0,
          casos_abertos: Number(resultados.casos) || 0,
        }),
      });
      setModalConcluirAberto(false);
      setAcaoConcluir(null);
      setMensagem(`Ação "${acaoConcluir.titulo}" concluída.`);
      await atualizar();
    } catch (erro: unknown) {
      setErroConclusao(mensagemDaApi(erro, "Não foi possível concluir a ação."));
    } finally {
      setSalvandoConclusao(false);
    }
  }

  async function abrirBalanco(acao: AcaoItinerante) {
    setCarregandoBalanco(true);
    setBalancoDetalhe(null);
    setModalBalancoAberto(true);
    try {
      const dados = await api<BalancoAcaoItinerante>(`/itinerant-actions/${acao.id}/balanco`);
      setBalancoDetalhe(dados);
    } catch {
      setBalancoDetalhe(null);
    } finally {
      setCarregandoBalanco(false);
    }
  }

  const agora = new Date();

  const acoesFuturas = acoes
    .filter((a) => new Date(a.data) >= agora && !a.concluida)
    .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());

  const acoesOrdenadas = [...acoes].sort((a, b) => {
    const da = new Date(a.data).getTime();
    const db = new Date(b.data).getTime();
    return ordenacao === "mais-proximas" ? da - db : db - da;
  });

  return (
    <AppShell>
      <PageHeader
        title="Ações itinerantes"
        description="Atendimentos fora da sede: comunidades, distritos e ações externas."
        action={
          <Button type="button" onClick={() => setModalNovaAberto(true)}>
            <Plus size={16} aria-hidden="true" />
            Nova ação
          </Button>
        }
      />

      {erroCarga && <div className="notice mb-4" role="alert">{erroCarga}</div>}
      {mensagem && <div className="notice mb-4" role="status">{mensagem}</div>}

      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        <Stat
          label="Ações planejadas"
          value={acoesFuturas.length.toLocaleString("pt-BR")}
          hint={acoesFuturas.length === 0 ? "Nenhuma ação programada." : "Agendadas e ainda não concluídas."}
          icon={CalendarDays}
        />
        <Stat
          label="Cidadãos atendidos"
          value={(resumo?.total_cidadaos ?? 0).toLocaleString("pt-BR")}
          hint={resumo ? `${resumo.total_concluidas} de ${resumo.total_acoes} ações concluídas` : "Carregando..."}
          icon={Users}
        />
        <Stat
          label="Casos abertos"
          value={(resumo?.total_casos ?? 0).toLocaleString("pt-BR")}
          hint={resumo ? `${resumo.total_beneficios} benefícios concedidos` : "Carregando..."}
          icon={MapPinned}
        />
      </div>

      <ProximasAcoes acoes={acoesFuturas} />

      <HistoricoDeAcoes
        acoes={acoesOrdenadas}
        carregando={carregando}
        ordenacao={ordenacao}
        onOrdenacao={setOrdenacao}
        agora={agora}
        onBalanco={(acao) => void abrirBalanco(acao)}
        onConcluir={abrirConclusao}
        onExcluir={setAcaoParaExcluir}
      />

      <JanelaNovaAcao
        aberta={modalNovaAberto}
        onAbertaChange={setModalNovaAberto}
        erro={erroCadastro}
        salvando={salvando}
        onSalvar={salvarAcao}
      />

      <JanelaConcluirAcao
        aberta={modalConcluirAberto}
        onAbertaChange={setModalConcluirAberto}
        acao={acaoConcluir}
        resultados={resultados}
        onResultados={setResultados}
        erro={erroConclusao}
        salvando={salvandoConclusao}
        onConcluir={() => void concluirAcao()}
      />

      <JanelaBalanco
        aberta={modalBalancoAberto}
        onAbertaChange={setModalBalancoAberto}
        carregando={carregandoBalanco}
        balanco={balancoDetalhe}
      />

      <ConfirmDialog
        open={acaoParaExcluir !== null}
        onOpenChange={(aberto) => { if (!aberto && !excluindo) setAcaoParaExcluir(null); }}
        title="Excluir ação"
        description={`A ação "${acaoParaExcluir?.titulo ?? ""}" será excluída. Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        variant="destructive"
        onConfirm={() => void excluirAcao()}
        isLoading={excluindo}
      />
    </AppShell>
  );
}
