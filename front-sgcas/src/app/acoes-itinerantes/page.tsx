"use client";

import { CalendarDays, CheckCircle, FileText, MapPinned, Plus, Trash2, Users } from "lucide-react";
import { FormEvent, startTransition, useCallback, useEffect, useState } from "react";
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
import { Badge, Button, Card, DadosEmLista, EmptyState, Field, Input, PageHeader, SecondaryButton, SectionHeading, Select, Stat } from "@/components/ui";
import { api, mensagemDaApi } from "@/lib/api";
import { formatarData } from "@/lib/datas";
import type {
  AcaoItinerante,
  BalancoAcaoItinerante,
  ResumoAcoesItinerantes,
} from "@/types/sgcas";

type Ordenacao = "mais-proximas" | "mais-recentes";

function formatarDataCompleta(data: string) {
  return new Date(data).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AcoesItinerantesPage() {
  const [acoes, setAcoes] = useState<AcaoItinerante[]>([]);
  const [resumo, setResumo] = useState<ResumoAcoesItinerantes | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("mais-proximas");
  const [mensagem, setMensagem] = useState("");

  const [modalNovaAberto, setModalNovaAberto] = useState(false);
  const [erroCadastro, setErroCadastro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [modalConcluirAberto, setModalConcluirAberto] = useState(false);
  const [acaoConcluir, setAcaoConcluir] = useState<AcaoItinerante | null>(null);
  const [cidadaosInput, setCidadaosInput] = useState("");
  const [participantesInput, setParticipantesInput] = useState("");
  const [beneficiosInput, setBeneficiosInput] = useState("");
  const [casosInput, setCasosInput] = useState("");
  const [salvandoConclusao, setSalvandoConclusao] = useState(false);
  const [erroConclusao, setErroConclusao] = useState("");

  const [modalBalancoAberto, setModalBalancoAberto] = useState(false);
  const [balancoDetalhe, setBalancoDetalhe] = useState<BalancoAcaoItinerante | null>(null);
  const [carregandoBalanco, setCarregandoBalanco] = useState(false);

  const [acaoParaExcluir, setAcaoParaExcluir] = useState<AcaoItinerante | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const atualizar = useCallback(async () => {
    const [acoesData, resumoData] = await Promise.all([
      api<AcaoItinerante[]>("/itinerant-actions/").catch(() => []),
      api<ResumoAcoesItinerantes>("/itinerant-actions/resumo").catch(() => null),
    ]);
    setAcoes(acoesData);
    setResumo(resumoData);
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
    setCidadaosInput("");
    setParticipantesInput("");
    setBeneficiosInput("");
    setCasosInput("");
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
          cidadaos_atendidos: Number(cidadaosInput) || 0,
          participantes: Number(participantesInput) || 0,
          beneficios_concedidos: Number(beneficiosInput) || 0,
          casos_abertos: Number(casosInput) || 0,
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

      {acoesFuturas.length > 0 && (
        <Card className="mt-4">
          <SectionHeading icon={CalendarDays} title="Próximas ações" count={acoesFuturas.length} />
          <ul>
            {acoesFuturas.slice(0, 3).map((acao, indice) => (
              <li key={acao.id} className="line-row">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <strong>{acao.titulo}</strong>
                  {indice === 0 && <Badge tone="info">Próxima</Badge>}
                </div>
                <small className="mt-0.5 block">
                  {formatarDataCompleta(acao.data)} · {acao.local}
                </small>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-4">
        <SectionHeading
          title="Histórico de ações"
          count={acoes.length}
          action={
            acoes.length > 1 ? (
              <label className="flex items-center gap-2 text-sm text-meta-slate">
                <span className="max-sm:sr-only">Ordem</span>
                <Select className="!w-auto" value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}>
                  <option value="mais-proximas">Mais próximas primeiro</option>
                  <option value="mais-recentes">Mais recentes primeiro</option>
                </Select>
              </label>
            ) : undefined
          }
        />

        {carregando && <p className="text-sm text-meta-slate" role="status">Carregando...</p>}

        {!carregando && acoesOrdenadas.length === 0 && (
          <EmptyState title="Nenhuma ação cadastrada" text="Use “Nova ação” para cadastrar a primeira ação itinerante." />
        )}

        {!carregando && acoesOrdenadas.length > 0 && (
          <div className="table-wrap">
            <table className="table table-stack-lg">
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Local</th>
                  <th>Data</th>
                  <th>Responsável</th>
                  <th>Unidade</th>
                  <th>Situação</th>
                  <th><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {acoesOrdenadas.map((acao) => (
                  <tr key={acao.id}>
                    <td data-label="Título">
                      <strong>{acao.titulo}</strong>
                    </td>
                    <td data-label="Local">{acao.local}</td>
                    <td data-label="Data" className="lg:whitespace-nowrap">{formatarData(acao.data)}</td>
                    <td data-label="Responsável">{acao.responsavel_nome}</td>
                    <td data-label="Unidade">{acao.unidade_nome}</td>
                    <td data-label="Situação">
                      {acao.concluida ? (
                        <Badge tone="good">Concluída</Badge>
                      ) : new Date(acao.data) < agora ? (
                        <Badge tone="warn">Em andamento</Badge>
                      ) : (
                        <Badge tone="info">Agendada</Badge>
                      )}
                    </td>
                    <td className="lg:w-px lg:whitespace-nowrap">
                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        {acao.concluida ? (
                          <SecondaryButton type="button" size="sm" onClick={() => void abrirBalanco(acao)}>
                            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                            Balanço
                          </SecondaryButton>
                        ) : (
                          <Button type="button" size="sm" onClick={() => abrirConclusao(acao)}>
                            <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            Concluir
                          </Button>
                        )}
                        <SecondaryButton
                          type="button"
                          size="sm"
                          className="!px-2.5 text-red-700 hover:!bg-red-50"
                          onClick={() => setAcaoParaExcluir(acao)}
                          aria-label={`Excluir a ação ${acao.titulo}`}
                          title="Excluir"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </SecondaryButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={modalNovaAberto} onOpenChange={setModalNovaAberto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nova ação itinerante</DialogTitle>
            <DialogDescription>
              Registre uma ação fora da sede. O responsável e a unidade são preenchidos automaticamente.
            </DialogDescription>
          </DialogHeader>

          <form className="grid gap-4" onSubmit={salvarAcao}>
            <Field label="Título">
              <Input name="titulo" placeholder="Ex.: Mutirão Caiambé" required />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Local">
                <Input name="local" placeholder="Ex.: Comunidade Caiambé" required />
              </Field>
              <Field label="Data e hora">
                <Input name="data" type="datetime-local" required />
              </Field>
            </div>

            <Field label="Descrição (opcional)">
              <Input name="descricao" placeholder="Objetivo da ação" />
            </Field>

            <Field label="Observações (opcional)">
              <Input name="observacoes" placeholder="Informações adicionais" />
            </Field>

            {erroCadastro && <div className="notice" role="alert">{erroCadastro}</div>}

            <DialogFooter>
              <SecondaryButton type="button" onClick={() => setModalNovaAberto(false)} disabled={salvando}>
                Cancelar
              </SecondaryButton>
              <Button disabled={salvando}>{salvando ? "Salvando..." : "Salvar ação"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={modalConcluirAberto} onOpenChange={setModalConcluirAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Concluir ação</DialogTitle>
            <DialogDescription>
              Registre os resultados da ação <strong>{acaoConcluir?.titulo}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <Field label="Cidadãos atendidos">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="Quantas pessoas foram atendidas?"
                value={cidadaosInput}
                onChange={(e) => setCidadaosInput(e.target.value)}
                required
              />
            </Field>

            <Field label="Participantes" hint="Servidores públicos que integraram esta ação.">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={participantesInput}
                onChange={(e) => setParticipantesInput(e.target.value)}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Benefícios concedidos">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={beneficiosInput}
                  onChange={(e) => setBeneficiosInput(e.target.value)}
                />
              </Field>

              <Field label="Casos abertos">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={casosInput}
                  onChange={(e) => setCasosInput(e.target.value)}
                />
              </Field>
            </div>

            {erroConclusao && <div className="notice" role="alert">{erroConclusao}</div>}

            <DialogFooter>
              <SecondaryButton
                type="button"
                onClick={() => setModalConcluirAberto(false)}
                disabled={salvandoConclusao}
              >
                Cancelar
              </SecondaryButton>
              <Button type="button" disabled={salvandoConclusao || !cidadaosInput} onClick={concluirAcao}>
                {salvandoConclusao ? "Salvando..." : "Concluir ação"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={modalBalancoAberto} onOpenChange={setModalBalancoAberto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Balanço da ação</DialogTitle>
            <DialogDescription>
              {balancoDetalhe ? `${balancoDetalhe.titulo} — ${balancoDetalhe.local}` : "Resultados registrados ao concluir a ação."}
            </DialogDescription>
          </DialogHeader>

          {carregandoBalanco && <p className="text-sm text-meta-slate" role="status">Carregando...</p>}

          {!carregandoBalanco && !balancoDetalhe && (
            <div className="notice" role="alert">Não foi possível carregar o balanço desta ação.</div>
          )}

          {balancoDetalhe && !carregandoBalanco && (
            <div className="grid gap-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Cidadãos atendidos" vertical value={balancoDetalhe.balanco.cidadaos_atendidos} />
                <Stat label="Participantes" vertical value={balancoDetalhe.balanco.participantes} />
                <Stat label="Benefícios" vertical value={balancoDetalhe.balanco.beneficios_concedidos} />
                <Stat label="Casos abertos" vertical value={balancoDetalhe.balanco.casos_abertos} />
              </div>

              <DadosEmLista
                itens={[
                  { rotulo: "Data", valor: formatarDataCompleta(balancoDetalhe.data) },
                  { rotulo: "Responsável", valor: balancoDetalhe.responsavel_nome },
                  { rotulo: "Unidade", valor: balancoDetalhe.unidade_nome },
                  ...(balancoDetalhe.descricao ? [{ rotulo: "Descrição", valor: balancoDetalhe.descricao }] : []),
                  ...(balancoDetalhe.observacoes ? [{ rotulo: "Observações", valor: balancoDetalhe.observacoes }] : []),
                ]}
              />
            </div>
          )}

          <DialogFooter>
            <SecondaryButton type="button" onClick={() => setModalBalancoAberto(false)}>
              Fechar
            </SecondaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
