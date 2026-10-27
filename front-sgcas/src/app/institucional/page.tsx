"use client";

import { FormEvent, useEffect, useState } from "react";
import { Building2, Plus, Wrench } from "lucide-react";
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
import { api, mensagemDaApi } from "@/lib/api";
import { CATEGORIA_DE_BENEFICIO, TIPOS_DE_AUXILIO } from "@/lib/auxilios";
import { useAuth } from "@/lib/auth";
import type { Coordenacao, Demanda, Servico, Unidade } from "@/types/sgcas";

const tiposDeUnidade = [
  ["CRAS", "CRAS"],
  ["CREAS", "CREAS"],
  ["CENTRO_POP", "Centro POP"],
  ["ABRIGO", "Acolhimento institucional"],
  ["SEDE", "Sede"],
  ["OUTRO", "Outro"],
] as const;

type Classificacao = { demandaId: string; tipo: string };

const SEM_CLASSIFICACAO: Classificacao = { demandaId: "", tipo: "" };

/** O que vai à API: o tipo de auxílio só existe em serviço da categoria "Benefício Eventual". */
function corpoDaClassificacao(classificacao: Classificacao, demandas: Demanda[]) {
  const ehBeneficio = demandas.find((d) => d.id === classificacao.demandaId)?.nome === CATEGORIA_DE_BENEFICIO;
  return {
    demanda_id: classificacao.demandaId || null,
    tipo_de_beneficio: ehBeneficio ? classificacao.tipo || null : null,
  };
}

/**
 * Onde o serviço se classifica: a categoria municipal e, nos auxílios, o tipo.
 * É a mesma escolha ao cadastrar e ao corrigir um serviço, por isso é um componente só.
 */
function CamposDeClassificacao({
  demandas,
  valor,
  onChange,
}: {
  demandas: Demanda[];
  valor: Classificacao;
  onChange: (proximo: Classificacao) => void;
}) {
  const ehBeneficio = demandas.find((d) => d.id === valor.demandaId)?.nome === CATEGORIA_DE_BENEFICIO;

  return (
    <>
      <Field label="Categoria municipal">
        <Select value={valor.demandaId} onChange={(event) => onChange({ demandaId: event.target.value, tipo: "" })}>
          <option value="">Sem categoria</option>
          {demandas.map((demanda) => (
            <option key={demanda.id} value={demanda.id}>{demanda.nome}</option>
          ))}
        </Select>
      </Field>
      {ehBeneficio && (
        <>
          <Field label="Tipo de auxílio">
            <Select value={valor.tipo} onChange={(event) => onChange({ ...valor, tipo: event.target.value })}>
              <option value="">Não informado</option>
              {TIPOS_DE_AUXILIO.map((tipo) => (
                <option key={tipo.valor} value={tipo.valor}>{tipo.rotulo}</option>
              ))}
            </Select>
          </Field>
          <p className="-mt-2 text-xs leading-5 text-meta-slate">
            Informe o tipo para o sistema avisar quando a mesma pessoa pedir o mesmo auxílio de novo. O auxílio de
            nascimento (o auxílio maternidade) só pode ser concedido uma vez a cada 12 meses; os demais tipos, uma vez
            por mês. Sem o tipo, o aviso na recepção só considera o mês.
          </p>
        </>
      )}
    </>
  );
}

export default function InstitucionalPage() {
  const { user } = useAuth();
  const [classificacao, setClassificacao] = useState<Classificacao>(SEM_CLASSIFICACAO);
  const [editando, setEditando] = useState<Servico | null>(null);
  const [edicao, setEdicao] = useState<Classificacao>(SEM_CLASSIFICACAO);
  const [erroDaEdicao, setErroDaEdicao] = useState("");
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [coordenacoes, setCoordenacoes] = useState<Coordenacao[]>([]);
  const [demandas, setDemandas] = useState<Demanda[]>([]);
  const [mensagem, setMensagem] = useState("");
  const [modalUnidade, setModalUnidade] = useState(false);
  const [modalServico, setModalServico] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    const [units, services, coords, demands] = await Promise.all([
      api<Unidade[]>("/institutional/units").catch(() => []),
      api<Servico[]>("/institutional/services?unidade=todas").catch(() => []),
      api<Coordenacao[]>("/institutional/coordinations").catch(() => []),
      api<Demanda[]>("/institutional/demands").catch(() => []),
    ]);

    setUnidades(units);
    setServicos(services);
    setCoordenacoes(coords);
    setDemandas(demands);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void carregar();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function criarUnidade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMensagem("");
    setSalvando(true);

    const form = new FormData(event.currentTarget);
    try {
      await api("/institutional/units", {
        method: "POST",
        body: JSON.stringify({
          nome: form.get("nome"),
          sigla: form.get("sigla"),
          tipo: form.get("tipo"),
          endereco: form.get("endereco") || null,
          telefone: form.get("telefone") || null,
          coordenacao_id: form.get("coordenacao_id") || null,
        }),
      });
      setMensagem("Unidade cadastrada.");
      setModalUnidade(false);
      event.currentTarget.reset();
      await carregar();
    } catch {
      setMensagem("Não foi possível cadastrar a unidade. Confira sigla e campos obrigatórios.");
    } finally {
      setSalvando(false);
    }
  }

  // O administrador classifica os serviços de qualquer unidade; o coordenador, os da sua.
  function podeClassificar(servico: Servico) {
    return user?.papel === "ADMIN" || (user?.papel === "COORDENADOR" && servico.unidade === user.unidade?.id);
  }

  function abrirClassificacao(servico: Servico) {
    setEdicao({ demandaId: servico.demanda_id ?? "", tipo: servico.tipo_de_beneficio ?? "" });
    setErroDaEdicao("");
    setEditando(servico);
  }

  async function salvarClassificacao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editando) return;
    setErroDaEdicao("");
    setSalvando(true);
    try {
      await api(`/institutional/services/${editando.id}`, {
        method: "PATCH",
        body: JSON.stringify(corpoDaClassificacao(edicao, demandas)),
      });
      setEditando(null);
      await carregar();
      setMensagem("Classificação do serviço atualizada.");
    } catch (error) {
      setErroDaEdicao(mensagemDaApi(error, "Não foi possível atualizar o serviço."));
    } finally {
      setSalvando(false);
    }
  }

  async function criarServico(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMensagem("");
    setSalvando(true);

    const formulario = event.currentTarget;
    const form = new FormData(formulario);
    try {
      await api("/institutional/services", {
        method: "POST",
        body: JSON.stringify({
          nome: form.get("nome"),
          descricao: form.get("descricao") || null,
          unidade_id: form.get("unidade_id"),
          ...corpoDaClassificacao(classificacao, demandas),
        }),
      });
      setMensagem("Serviço cadastrado.");
      setModalServico(false);
      formulario.reset();
      setClassificacao(SEM_CLASSIFICACAO);
      await carregar();
    } catch (error) {
      setMensagem(mensagemDaApi(error, "Não foi possível cadastrar o serviço. Confira unidade e nome."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Institucional"
        description="Gerencie unidades da rede e serviços disponíveis para atendimento."
        action={
          <div className="row">
            <SecondaryButton type="button" onClick={() => setModalUnidade(true)}>
              <Building2 size={18} />
              Nova unidade
            </SecondaryButton>
            <Button type="button" onClick={() => setModalServico(true)} disabled={unidades.length === 0}>
              <Plus size={18} />
              Novo serviço
            </Button>
          </div>
        }
      />

      {mensagem && <div className="notice mb-5">{mensagem}</div>}

      <div className="grid two">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="!mb-0">Unidades</h2>
            <Badge tone="neutral">{unidades.length} cadastradas</Badge>
          </div>

          {unidades.length === 0 ? (
            <EmptyState title="Nenhuma unidade" text="Cadastre a primeira unidade para vincular serviços e operadores." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Tipo</th>
                  <th>Sigla</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {unidades.map((unidade) => (
                  <tr key={unidade.id}>
                    <td>
                      <strong>{unidade.nome}</strong>
                      {unidade.coordenacao && <small className="block text-meta-slate">{unidade.coordenacao}</small>}
                    </td>
                    <td>{unidade.tipo ?? "-"}</td>
                    <td>{unidade.sigla ?? "-"}</td>
                    <td>
                      <Badge tone={unidade.ativa === false ? "bad" : "good"}>
                        {unidade.ativa === false ? "Inativa" : "Ativa"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="!mb-0">Serviços</h2>
            <Badge tone="neutral">{servicos.length} ativos</Badge>
          </div>

          {servicos.length === 0 ? (
            <EmptyState title="Nenhum serviço" text="Cadastre os serviços que aparecem na recepção e no encaminhamento." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th>Unidade</th>
                  <th>Categoria</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {servicos.map((servico) => (
                  <tr key={servico.id}>
                    <td>
                      <strong>{servico.nome}</strong>
                      {servico.descricao && <small className="block text-meta-slate">{servico.descricao}</small>}
                    </td>
                    <td>{servico.unidade_nome}</td>
                    <td>
                      {servico.demanda_nome ?? "Sem categoria"}
                      {servico.demanda_nome === CATEGORIA_DE_BENEFICIO && (
                        <small className="block text-meta-slate">
                          {servico.tipo_de_beneficio_rotulo ?? "Tipo de auxílio não informado"}
                        </small>
                      )}
                    </td>
                    <td>
                      {podeClassificar(servico) && (
                        <SecondaryButton type="button" className="h-9 px-3 text-xs" onClick={() => abrirClassificacao(servico)}>
                          Classificar
                        </SecondaryButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Dialog open={modalUnidade} onOpenChange={setModalUnidade}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova unidade</DialogTitle>
            <DialogDescription>Cadastre uma unidade da rede para receber operadores, serviços e atendimentos.</DialogDescription>
          </DialogHeader>

          <form className="grid gap-4" onSubmit={criarUnidade}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nome">
                <Input name="nome" placeholder="CRAS Centro" required />
              </Field>
              <Field label="Sigla">
                <Input name="sigla" placeholder="CRAS-CENTRO" required />
              </Field>
              <Field label="Tipo">
                <Select name="tipo" defaultValue="CRAS" required>
                  {tiposDeUnidade.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </Field>
              {coordenacoes.length > 0 ? (
                <Field label="Coordenação (opcional)">
                  <Select name="coordenacao_id">
                    <option value="">Sem coordenação</option>
                    {coordenacoes.map((coordenacao) => (
                      <option key={coordenacao.id} value={coordenacao.id}>{coordenacao.nome}</option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <input name="coordenacao_id" type="hidden" value="" />
              )}
              <Field label="Telefone">
                <Input name="telefone" placeholder="(92) 99999-9999" />
              </Field>
              <Field label="Endereço">
                <Input name="endereco" />
              </Field>
            </div>

            {coordenacoes.length === 0 && (
              <div className="rounded-lg bg-meta-soft-gray px-4 py-3 text-sm leading-6 text-meta-slate">
                Coordenação é opcional. Como não há coordenações cadastradas, a unidade será criada sem vínculo.
              </div>
            )}

            <DialogFooter>
              <SecondaryButton type="button" onClick={() => setModalUnidade(false)} disabled={salvando}>
                Cancelar
              </SecondaryButton>
              <Button disabled={salvando}>{salvando ? "Salvando..." : "Cadastrar unidade"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={modalServico} onOpenChange={setModalServico}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo serviço</DialogTitle>
            <DialogDescription>Cadastre um serviço ofertado por uma unidade. Ele aparecerá na recepção.</DialogDescription>
          </DialogHeader>

          <form className="grid gap-4" onSubmit={criarServico}>
            <Field label="Nome do serviço">
              <Input name="nome" placeholder="Benefício eventual" required />
            </Field>
            <Field label="Unidade">
              <Select name="unidade_id" required>
                <option value="">Selecione</option>
                {unidades.map((unidade) => (
                  <option key={unidade.id} value={unidade.id}>{unidade.nome}</option>
                ))}
              </Select>
            </Field>
            <CamposDeClassificacao demandas={demandas} valor={classificacao} onChange={setClassificacao} />
            <Field label="Descrição">
              <textarea className="input" name="descricao" placeholder="Descrição curta do serviço" />
            </Field>

            <DialogFooter>
              <SecondaryButton type="button" onClick={() => setModalServico(false)} disabled={salvando}>
                Cancelar
              </SecondaryButton>
              <Button disabled={salvando}>
                <Wrench size={18} />
                {salvando ? "Salvando..." : "Cadastrar serviço"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editando !== null} onOpenChange={(aberto) => { if (!aberto) setEditando(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Classificar serviço</DialogTitle>
            <DialogDescription>
              {editando ? `${editando.nome} — ${editando.unidade_nome}. ` : ""}
              A categoria liga o serviço ao controle de repetição de auxílio.
            </DialogDescription>
          </DialogHeader>

          <form className="grid gap-4" onSubmit={salvarClassificacao}>
            {erroDaEdicao && <div className="notice" role="alert">{erroDaEdicao}</div>}
            <CamposDeClassificacao demandas={demandas} valor={edicao} onChange={setEdicao} />

            <DialogFooter>
              <SecondaryButton type="button" onClick={() => setEditando(null)} disabled={salvando}>
                Cancelar
              </SecondaryButton>
              <Button disabled={salvando}>{salvando ? "Salvando..." : "Salvar classificação"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
