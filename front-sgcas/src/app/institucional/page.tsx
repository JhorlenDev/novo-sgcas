"use client";

import { FormEvent, useEffect, useState } from "react";
import { Building2, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, SecondaryButton, SectionHeading, Select } from "@/components/ui";
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

function rotuloDoTipoDeUnidade(tipo?: string | null) {
  return tiposDeUnidade.find(([valor]) => valor === tipo)?.[1] ?? tipo ?? "—";
}

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
  // A rede tem dezenas de serviços: filtrar por unidade e por nome evita rolar a lista inteira.
  const [filtroDeUnidade, setFiltroDeUnidade] = useState("");
  const [busca, setBusca] = useState("");

  const servicosVisiveis = servicos.filter((servico) => {
    if (filtroDeUnidade && servico.unidade !== filtroDeUnidade) return false;
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return !termo || servico.nome.toLocaleLowerCase("pt-BR").includes(termo);
  });

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
        description="Gerencie as unidades da rede e os serviços disponíveis para atendimento."
        action={
          <>
            <SecondaryButton type="button" onClick={() => setModalUnidade(true)}>
              <Building2 size={16} aria-hidden="true" />
              Nova unidade
            </SecondaryButton>
            <Button type="button" onClick={() => setModalServico(true)} disabled={unidades.length === 0}>
              <Plus size={16} aria-hidden="true" />
              Novo serviço
            </Button>
          </>
        }
      />

      {mensagem && <div className="notice mb-4" role="status">{mensagem}</div>}

      <div className="grid gap-4">
        <Card>
          <SectionHeading title="Unidades" count={unidades.length} />

          {unidades.length === 0 ? (
            <EmptyState title="Nenhuma unidade" text="Cadastre a primeira unidade para vincular serviços e operadores." />
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Sigla</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {unidades.map((unidade) => (
                    <tr key={unidade.id}>
                      <td data-label="Nome">
                        <strong>{unidade.nome}</strong>
                        {unidade.coordenacao && <small className="block text-meta-slate">{unidade.coordenacao}</small>}
                      </td>
                      <td data-label="Tipo">{rotuloDoTipoDeUnidade(unidade.tipo)}</td>
                      <td data-label="Sigla">{unidade.sigla ?? "—"}</td>
                      <td data-label="Situação">
                        <Badge tone={unidade.ativa === false ? "bad" : "good"}>
                          {unidade.ativa === false ? "Inativa" : "Ativa"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <SectionHeading
            title="Serviços"
            count={servicosVisiveis.length === servicos.length ? `${servicos.length} ativos` : `${servicosVisiveis.length} de ${servicos.length}`}
          />

          {servicos.length > 0 && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
              <Field label="Unidade">
                <Select value={filtroDeUnidade} onChange={(event) => setFiltroDeUnidade(event.target.value)}>
                  <option value="">Todas as unidades</option>
                  {unidades.map((unidade) => (
                    <option key={unidade.id} value={unidade.id}>{unidade.nome}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Buscar serviço">
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta-slate" aria-hidden="true" />
                  <Input className="pl-9" type="search" value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Nome do serviço" />
                </span>
              </Field>
            </div>
          )}

          {servicos.length === 0 ? (
            <EmptyState title="Nenhum serviço" text="Cadastre os serviços que aparecem na recepção e no encaminhamento." />
          ) : servicosVisiveis.length === 0 ? (
            <EmptyState title="Nenhum serviço encontrado" text="Mude a unidade ou o termo da busca." />
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th>Serviço</th>
                    <th>Unidade</th>
                    <th>Categoria</th>
                    <th><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {servicosVisiveis.map((servico) => (
                    <tr key={servico.id}>
                      <td data-label="Serviço">
                        <strong>{servico.nome}</strong>
                        {servico.descricao && <small className="mt-0.5 block text-meta-slate">{servico.descricao}</small>}
                      </td>
                      <td data-label="Unidade">{servico.unidade_nome}</td>
                      <td data-label="Categoria">
                        {servico.demanda_nome ?? <span className="text-meta-slate">Sem categoria</span>}
                        {servico.demanda_nome === CATEGORIA_DE_BENEFICIO && (
                          <small className="block text-meta-slate">
                            {servico.tipo_de_beneficio_rotulo ?? "Tipo de auxílio não informado"}
                          </small>
                        )}
                      </td>
                      <td className="md:w-px md:whitespace-nowrap md:text-right">
                        {podeClassificar(servico) && (
                          <SecondaryButton type="button" size="sm" onClick={() => abrirClassificacao(servico)}>
                            Classificar
                          </SecondaryButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              <Input name="nome" placeholder="Ex.: Cesta básica" required />
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
              <Button disabled={salvando}>{salvando ? "Salvando..." : "Cadastrar serviço"}</Button>
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
