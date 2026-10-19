"use client";

import {
  CalendarDays,
  CheckCircle,
  Clock,
  FileText,
  MapPinned,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { FormEvent, startTransition, useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, SecondaryButton } from "@/components/ui";
import { api } from "@/lib/api";
import type {
  AcaoItinerante,
  BalancoAcaoItinerante,
  ResumoAcoesItinerantes,
} from "@/types/sgcas";

type Ordenacao = "mais-proximas" | "mais-recentes";

export default function AcoesItinerantesPage() {
  const [acoes, setAcoes] = useState<AcaoItinerante[]>([]);
  const [resumo, setResumo] = useState<ResumoAcoesItinerantes | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("mais-proximas");

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

  const carregarDados = useCallback(async () => {
    setCarregando(true);
    const [acoesData, resumoData] = await Promise.all([
      api<AcaoItinerante[]>("/itinerant-actions/").catch(() => []),
      api<ResumoAcoesItinerantes>("/itinerant-actions/resumo").catch(() => null),
    ]);
    setAcoes(acoesData);
    setResumo(resumoData);
    setCarregando(false);
  }, []);

  useEffect(() => {
    startTransition(() => {
      void carregarDados();
    });
  }, [carregarDados]);

  async function salvarAcao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErroCadastro("");
    setSalvando(true);

    const form = new FormData(event.currentTarget);
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
      event.currentTarget.reset();
      const [novasAcoes, novoResumo] = await Promise.all([
        api<AcaoItinerante[]>("/itinerant-actions/").catch(() => []),
        api<ResumoAcoesItinerantes>("/itinerant-actions/resumo").catch(() => null),
      ]);
      setAcoes(novasAcoes);
      setResumo(novoResumo);
    } catch (erro: unknown) {
      const msg =
        erro instanceof Error ? erro.message : "Não foi possível salvar. Verifique os dados informados.";
      setErroCadastro(msg);
    } finally {
      setSalvando(false);
    }
  }

  async function excluirAcao(acao: AcaoItinerante) {
    if (!confirm(`Excluir a ação "${acao.titulo}"?`)) return;

    try {
      await api(`/itinerant-actions/${acao.id}/excluir`, { method: "DELETE" });
      const [novasAcoes, novoResumo] = await Promise.all([
        api<AcaoItinerante[]>("/itinerant-actions/").catch(() => []),
        api<ResumoAcoesItinerantes>("/itinerant-actions/resumo").catch(() => null),
      ]);
      setAcoes(novasAcoes);
      setResumo(novoResumo);
    } catch {
      alert("Erro ao excluir ação.");
    }
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
      setCidadaosInput("");
      setParticipantesInput("");
      setBeneficiosInput("");
      setCasosInput("");
      const [novasAcoes, novoResumo] = await Promise.all([
        api<AcaoItinerante[]>("/itinerant-actions/").catch(() => []),
        api<ResumoAcoesItinerantes>("/itinerant-actions/resumo").catch(() => null),
      ]);
      setAcoes(novasAcoes);
      setResumo(novoResumo);
    } catch (erro: unknown) {
      const msg = erro instanceof Error ? erro.message : "Erro ao concluir ação.";
      setErroConclusao(msg);
    } finally {
      setSalvandoConclusao(false);
    }
  }

  async function abrirBalanco(acao: AcaoItinerante) {
    setCarregandoBalanco(true);
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

  function formatarData(data: string) {
    return new Date(data).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  function formatarDataCompleta(data: string) {
    return new Date(data).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const agora = new Date();

  const acoesFuturas = acoes
    .filter((a) => new Date(a.data) >= agora && !a.concluida)
    .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());

  const proximaAcao = acoesFuturas[0] ?? null;

  const acoesOrdenadas = [...acoes].sort((a, b) => {
    const da = new Date(a.data).getTime();
    const db = new Date(b.data).getTime();
    return ordenacao === "mais-proximas" ? da - db : db - da;
  });

  return (
    <AppShell>
      <PageHeader
        title="Ações itinerantes"
        description="Área reservada para atendimentos fora da sede, em comunidades, distritos e ações externas."
        action={
          <Button type="button" onClick={() => setModalNovaAberto(true)}>
            <Plus size={18} />
            Nova ação
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        {/* Card Planejamento - próximas 3 ações */}
        <Card className="!p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">Planejamento</p>
              <strong className="mt-2 block text-xl text-meta-charcoal">
                {acoesFuturas.length} {acoesFuturas.length === 1 ? "ação" : "ações"}
              </strong>
              <small className="mt-1 block text-meta-slate">
                {acoesFuturas.length === 0
                  ? "Nenhuma ação programada."
                  : "Próximas ações agendadas."}
              </small>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-pill bg-primary/10 text-primary">
              <CalendarDays size={18} />
            </span>
          </div>
          {acoesFuturas.slice(0, 3).length > 0 && (
            <div className="mt-3 space-y-2">
              {acoesFuturas.slice(0, 3).map((acao) => (
                <div key={acao.id} className="rounded-lg bg-meta-soft-gray p-3">
                  <p className="text-xs font-semibold text-meta-charcoal">{acao.titulo}</p>
                  <p className="text-xs text-meta-slate">
                    {formatarDataCompleta(acao.data)} — {acao.local}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Card Campo - próximo atendimento externo (aviso chamativo) */}
        <div className={`relative overflow-hidden rounded-card border-2 bg-gradient-to-br from-warning/5 to-warning/10 p-5 shadow-lift transition-all ${proximaAcao ? "border-warning" : "border-meta-divider"}`}>
          {proximaAcao && (
            <div className="pointer-events-none absolute -inset-[3px] rounded-card border-2 border-warning animate-[pulse_2s_ease-in-out_infinite] opacity-70" />
          )}
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a5a00]">Campo</p>
                <strong className="mt-2 block text-2xl font-extrabold text-meta-charcoal">
                  {proximaAcao ? "Próxima ação!" : "Atendimento externo"}
                </strong>
              </div>
              <span className="flex h-12 w-12 items-center justify-center rounded-pill bg-warning/20 text-[#8a5a00]">
                <MapPinned size={22} />
              </span>
            </div>
            {proximaAcao && (
              <div className="mt-3 rounded-lg border border-warning/30 bg-white p-4">
                <p className="text-base font-bold text-meta-charcoal">{proximaAcao.titulo}</p>
                <p className="mt-1 text-sm text-meta-slate">
                  {formatarDataCompleta(proximaAcao.data)}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-[#8a5a00]">{proximaAcao.local}</p>
              </div>
            )}
            {!proximaAcao && (
              <p className="mt-2 text-sm text-meta-slate">
                Cadastros, casos e benefícios na ação.
              </p>
            )}
          </div>
        </div>

        {/* Card Balanço */}
        <Card className="!p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">Balanço</p>
              <strong className="mt-2 block text-xl text-meta-charcoal">
                {resumo?.total_cidadaos ?? 0} cidadãos
              </strong>
              <small className="mt-1 block text-meta-slate">
                {resumo ? `${resumo.total_concluidas} de ${resumo.total_acoes} ações concluídas` : "Carregando..."}
              </small>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-pill bg-success/10 text-success">
              <Users size={18} />
            </span>
          </div>
          {resumo && (resumo.total_casos > 0 || resumo.total_beneficios > 0) && (
            <div className="mt-3 flex gap-3">
              {resumo.total_casos > 0 && (
                <div className="rounded-lg bg-meta-soft-gray px-3 py-2 text-center">
                  <strong className="block text-lg font-bold text-meta-charcoal">{resumo.total_casos}</strong>
                  <span className="text-xs text-meta-slate">casos</span>
                </div>
              )}
              {resumo.total_beneficios > 0 && (
                <div className="rounded-lg bg-meta-soft-gray px-3 py-2 text-center">
                  <strong className="block text-lg font-bold text-meta-charcoal">{resumo.total_beneficios}</strong>
                  <span className="text-xs text-meta-slate">benefícios</span>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <div style={{ height: 16 }} />

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="!mb-0">Histórico de ações</h2>
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-meta-slate" />
            <select
              className="input !h-9 !w-auto !py-1 text-xs"
              value={ordenacao}
              onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
            >
              <option value="mais-proximas">Mais próximas primeiro</option>
              <option value="mais-recentes">Mais recentes primeiro</option>
            </select>
          </div>
        </div>

        {carregando && <span className="text-sm text-meta-slate">Carregando...</span>}

        {!carregando && acoesOrdenadas.length === 0 && (
          <EmptyState
            title="Nenhuma ação cadastrada"
            text="Clique em 'Nova ação' para criar a primeira itinerante."
          />
        )}

        {!carregando && acoesOrdenadas.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Local</th>
                <th>Data</th>
                <th>Responsável</th>
                <th>Unidade</th>
                <th>Situação</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {acoesOrdenadas.map((acao) => (
                <tr className="clickable-row group" key={acao.id}>
                  <td>
                    <strong>{acao.titulo}</strong>
                  </td>
                  <td>{acao.local}</td>
                  <td>{formatarData(acao.data)}</td>
                  <td>{acao.responsavel_nome}</td>
                  <td>{acao.unidade_nome}</td>
                  <td>
                    {acao.concluida ? (
                      <Badge tone="good">Concluída</Badge>
                    ) : new Date(acao.data) < agora ? (
                      <Badge tone="warn">Em andamento</Badge>
                    ) : (
                      <Badge>Agendada</Badge>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      {acao.concluida ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-pill bg-success/10 px-3 py-1.5 text-xs font-semibold text-success transition-colors hover:bg-success/20"
                          onClick={() => void abrirBalanco(acao)}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Balanço
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-pill bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors group-hover:bg-primary-hover"
                          onClick={() => {
                            setAcaoConcluir(acao);
                            setCidadaosInput("");
                            setParticipantesInput("");
                            setBeneficiosInput("");
                            setCasosInput("");
                            setErroConclusao("");
                            setModalConcluirAberto(true);
                          }}
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          Concluir
                        </button>
                      )}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-pill border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100"
                        onClick={() => void excluirAcao(acao)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Modal Nova Ação */}
      <Dialog open={modalNovaAberto} onOpenChange={setModalNovaAberto}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova ação itinerante</DialogTitle>
            <DialogDescription>
              Registre uma ação fora da sede. O responsável e a unidade serão preenchidos automaticamente.
            </DialogDescription>
          </DialogHeader>

          <form className="grid gap-4" onSubmit={salvarAcao}>
            <Field label="Título">
              <Input name="titulo" placeholder="Ex: Mutirão Caiambe" required />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Local">
                <Input name="local" placeholder="Ex: Comunidade Caiambe" required />
              </Field>
              <Field label="Data">
                <Input name="data" type="datetime-local" required />
              </Field>
            </div>

            <Field label="Descrição">
              <Input name="descricao" placeholder="Descreva o objetivo da ação (opcional)" />
            </Field>

            <Field label="Observações">
              <Input name="observacoes" placeholder="Informações adicionais (opcional)" />
            </Field>

            {erroCadastro && <div className="notice">{erroCadastro}</div>}

            <DialogFooter>
              <SecondaryButton type="button" onClick={() => setModalNovaAberto(false)} disabled={salvando}>
                Cancelar
              </SecondaryButton>
              <Button disabled={salvando}>{salvando ? "Salvando..." : "Salvar ação"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Concluir Ação */}
      <Dialog open={modalConcluirAberto} onOpenChange={setModalConcluirAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
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
                min={0}
                placeholder="Quantas pessoas foram atendidas?"
                value={cidadaosInput}
                onChange={(e) => setCidadaosInput(e.target.value)}
                required
              />
            </Field>

            <Field label="Participantes">
              <Input
                type="number"
                min={0}
                placeholder="funcionários públicos que integraram esta ação"
                value={participantesInput}
                onChange={(e) => setParticipantesInput(e.target.value)}
              />
              <small className="text-xs text-meta-slate">funcionários públicos que integraram esta ação</small>
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Benefícios concedidos">
                <Input
                  type="number"
                  min={0}
                  placeholder="quantidade"
                  value={beneficiosInput}
                  onChange={(e) => setBeneficiosInput(e.target.value)}
                />
              </Field>

              <Field label="Casos abertos">
                <Input
                  type="number"
                  min={0}
                  placeholder="quantidade"
                  value={casosInput}
                  onChange={(e) => setCasosInput(e.target.value)}
                />
              </Field>
            </div>

            {erroConclusao && <div className="notice">{erroConclusao}</div>}

            <DialogFooter>
              <SecondaryButton
                type="button"
                onClick={() => setModalConcluirAberto(false)}
                disabled={salvandoConclusao}
              >
                Cancelar
              </SecondaryButton>
              <Button disabled={salvandoConclusao || !cidadaosInput} onClick={concluirAcao}>
                {salvandoConclusao ? "Salvando..." : "Concluir ação"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Balanço / Dashboard da Ação */}
      <Dialog open={modalBalancoAberto} onOpenChange={setModalBalancoAberto}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Balanço da ação</DialogTitle>
            {balancoDetalhe && (
              <DialogDescription>
                {balancoDetalhe.titulo} — {balancoDetalhe.local}
              </DialogDescription>
            )}
          </DialogHeader>

          {carregandoBalanco && <span className="text-sm text-meta-slate">Carregando...</span>}

          {balancoDetalhe && !carregandoBalanco && (
            <div className="grid gap-4">
              <div className="rounded-lg bg-meta-soft-gray p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">Data</p>
                <p className="mt-1 text-sm font-semibold text-meta-charcoal">
                  {formatarDataCompleta(balancoDetalhe.data)}
                </p>
              </div>

              {balancoDetalhe.descricao && (
                <div className="rounded-lg bg-meta-soft-gray p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">Descrição</p>
                  <p className="mt-1 text-sm text-meta-charcoal">{balancoDetalhe.descricao}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-lg bg-primary/5 p-4 text-center">
                  <Users className="mx-auto mb-2 h-6 w-6 text-primary" />
                  <strong className="block text-2xl font-bold text-primary">
                    {balancoDetalhe.balanco.cidadaos_atendidos}
                  </strong>
                  <small className="text-xs text-meta-slate">Cidadãos atendidos</small>
                </div>

                <div className="rounded-lg bg-primary/5 p-4 text-center">
                  <Users className="mx-auto mb-2 h-6 w-6 text-primary" />
                  <strong className="block text-2xl font-bold text-primary">
                    {balancoDetalhe.balanco.participantes}
                  </strong>
                  <small className="text-xs text-meta-slate">Participantes</small>
                </div>

                <div className="rounded-lg bg-primary/5 p-4 text-center">
                  <CheckCircle className="mx-auto mb-2 h-6 w-6 text-success" />
                  <strong className="block text-2xl font-bold text-success">
                    {balancoDetalhe.balanco.beneficios_concedidos}
                  </strong>
                  <small className="text-xs text-meta-slate">Benefícios</small>
                </div>

                <div className="rounded-lg bg-primary/5 p-4 text-center">
                  <FileText className="mx-auto mb-2 h-6 w-6 text-primary" />
                  <strong className="block text-2xl font-bold text-primary">
                    {balancoDetalhe.balanco.casos_abertos}
                  </strong>
                  <small className="text-xs text-meta-slate">Casos</small>
                </div>
              </div>

              <div className="rounded-lg bg-meta-soft-gray p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">Responsável</p>
                <p className="mt-1 text-sm text-meta-charcoal">{balancoDetalhe.responsavel_nome}</p>
              </div>

              <div className="rounded-lg bg-meta-soft-gray p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">Unidade</p>
                <p className="mt-1 text-sm text-meta-charcoal">{balancoDetalhe.unidade_nome}</p>
              </div>

              {balancoDetalhe.observacoes && (
                <div className="rounded-lg bg-meta-soft-gray p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">Observações</p>
                  <p className="mt-1 text-sm text-meta-charcoal">{balancoDetalhe.observacoes}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <SecondaryButton type="button" onClick={() => setModalBalancoAberto(false)}>
              Fechar
            </SecondaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
