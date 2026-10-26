"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, ClipboardList, FileArchive, Gift, Home, Plus, Send, ShieldCheck, Stethoscope, UsersRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, SecondaryButton, Select } from "@/components/ui";
import { api } from "@/lib/api";
import type { AtendimentoRecepcao, BeneficioEventual, Caso, Cidadao, Encaminhamento, EntradaHistorico, ProntuarioCidadao, Senha, Unidade } from "@/types/sgcas";

export default function ProntuarioPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [prontuario, setProntuario] = useState<ProntuarioCidadao | null>(null);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const carregarProntuario = useCallback(async () => {
    const data = await api<ProntuarioCidadao>(`/citizens/${params.id}/prontuario`);
    setProntuario(data);
    setErro("");
  }, [params.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCarregando(true);
      void carregarProntuario()
        .catch(() => setErro("Não foi possível carregar o prontuário."))
        .finally(() => setCarregando(false));

      void api<Unidade[]>("/institutional/units")
        .then(setUnidades)
        .catch(() => setUnidades([]));
    }, 0);

    return () => window.clearTimeout(timer);
  }, [carregarProntuario]);

  const cidadao = prontuario?.cidadao;
  const resumo = useMemo(() => {
    if (!prontuario) return null;
    return {
      casosAbertos: prontuario.casos.filter((caso) => !["CONCLUIDO", "CANCELADO", "ENCAMINHADO"].includes(caso.situacao)).length,
      beneficios: prontuario.beneficios_eventuais.length,
      encaminhamentos: prontuario.encaminhamentos.length,
      familia: prontuario.membros_da_familia.length,
    };
  }, [prontuario]);

  return (
    <AppShell>
      <div className="mb-4">
        <SecondaryButton type="button" className="h-9 px-3 text-xs" onClick={() => router.back()}>
          <ArrowLeft size={15} />
          Voltar
        </SecondaryButton>
      </div>

      <PageHeader
        title={cidadao?.nome ?? "Prontuário do cidadão"}
        description={cidadao ? [cidadao.cpf, cidadao.email, cidadao.telefone].filter(Boolean).join(" · ") || "Cadastro sem documento principal" : "Carregando..."}
        action={cidadao ? <Link href="/recepcao"><Button type="button">Nova recepção</Button></Link> : null}
      />

      {erro && <div className="notice">{erro}</div>}
      {carregando && <Card><EmptyState title="Carregando prontuário" text="Buscando cadastro, histórico e registros vinculados." /></Card>}

      {prontuario && cidadao && resumo && (
        <div className="grid gap-5">
          <div className="grid gap-3 md:grid-cols-4">
            <Resumo title="Casos ativos" value={resumo.casosAbertos} icon={ClipboardList} tone={resumo.casosAbertos ? "warn" : "good"} />
            <Resumo title="Benefícios" value={resumo.beneficios} icon={Gift} tone="primary" />
            <Resumo title="Encaminhamentos" value={resumo.encaminhamentos} icon={Send} tone="neutral" />
            <Resumo title="Família" value={resumo.familia} icon={UsersRound} tone="neutral" />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <DadosCadastrais cidadao={cidadao} />
            <DadosEndereco cidadao={cidadao} enderecoDetalhado={prontuario.endereco_detalhado} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <DadosSocioeconomicos dados={prontuario.socioeconomico} />
            <MembrosFamilia membros={prontuario.membros_da_familia} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <AtendimentosPanel atendimentos={prontuario.atendimentos_recepcao} senhas={prontuario.senhas} />
            <CasosPanel casos={prontuario.casos} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <BeneficiosPanel cidadao={cidadao} beneficios={prontuario.beneficios_eventuais} onSaved={carregarProntuario} />
            <EncaminhamentosPanel cidadao={cidadao} casos={prontuario.casos} encaminhamentos={prontuario.encaminhamentos} unidades={unidades} onSaved={carregarProntuario} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <AnexosPanel anexos={prontuario.anexos} />
            <HistoricoPanel historico={prontuario.historico} />
          </div>

          <PrivacidadePanel cidadao={cidadao} />
        </div>
      )}
    </AppShell>
  );
}

function DadosCadastrais({ cidadao }: { cidadao: Cidadao }) {
  return (
    <Card>
      <Titulo icon={ShieldCheck} title="Dados pessoais" count={null} />
      <InfoGrid rows={[
        ["CPF", cidadao.cpf],
        ["NIS", cidadao.nis],
        ["RG", cidadao.rg],
        ["Nascimento", cidadao.nascimento ? formatarData(cidadao.nascimento) : null],
        ["E-mail", cidadao.email],
        ["Telefone", cidadao.telefone],
        ["Consentiu Tefé Cidadão", cidadao.consentiu_tefe_cidadao_em ? formatarDataHora(cidadao.consentiu_tefe_cidadao_em) : null],
        ["Uso de imagem", cidadao.autoriza_imagem === true ? "Autorizado" : cidadao.autoriza_imagem === false ? "Não autorizado" : null],
        ["Observações", cidadao.observacoes],
      ]} />
    </Card>
  );
}

function DadosEndereco({ cidadao, enderecoDetalhado }: { cidadao: Cidadao; enderecoDetalhado: Record<string, unknown> }) {
  return (
    <Card>
      <Titulo icon={Home} title="Endereço e moradia" count={null} />
      <InfoGrid rows={[
        ["Endereço", [cidadao.endereco, cidadao.bairro, cidadao.cidade, cidadao.uf].filter(Boolean).join(", ")],
        ["CEP", cidadao.cep],
        ["Tipo de localização", valor(enderecoDetalhado.tipo_localizacao)],
        ["Situação do imóvel", valor(enderecoDetalhado.situacao_imovel)],
        ["Abastecimento de água", valor(enderecoDetalhado.abastecimento_agua)],
        ["Saneamento", booleano(enderecoDetalhado.possui_saneamento)],
      ]} />
    </Card>
  );
}

function DadosSocioeconomicos({ dados }: { dados: Record<string, unknown> }) {
  const beneficiosRecebidos = Array.isArray(dados.beneficios_recebidos) ? dados.beneficios_recebidos as Record<string, unknown>[] : [];
  const servicosSociais = Array.isArray(dados.servicos_sociais) ? dados.servicos_sociais as string[] : [];

  return (
    <Card>
      <Titulo icon={ClipboardList} title="Socioeconômico" count={null} />
      <InfoGrid rows={[
        ["Renda total", valor(dados.renda_total)],
        ["Origem da renda", valor(dados.precedencia_rendimento)],
        ["Pessoas na residência", valor(dados.quantidade_pessoas_residencia)],
        ["Recebe benefício", booleano(dados.recebe_beneficio)],
        ["Gestante no grupo", booleano(dados.ha_gestante)],
        ["Pessoa com deficiência", booleano(dados.ha_pessoa_com_deficiencia)],
        ["Observações", valor(dados.observacoes_gerais)],
      ]} />
      {beneficiosRecebidos.length > 0 && <ListaSimples titulo="Benefícios recebidos no cadastro" itens={beneficiosRecebidos.map((item, index) => ({ id: String(index), title: valor(item.beneficio_nome) || valor(item.beneficio_tipo) || `Benefício ${index + 1}`, detail: valor(item.beneficio_valor) }))} />}
      {servicosSociais.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{servicosSociais.map((servico) => <Badge key={servico} tone="neutral">{servico}</Badge>)}</div>}
    </Card>
  );
}

function MembrosFamilia({ membros }: { membros: Record<string, unknown>[] }) {
  return (
    <Card>
      <Titulo icon={UsersRound} title="Composição familiar" count={membros.length} />
      {membros.length === 0 ? <EmptyState title="Sem membros cadastrados" text="A composição familiar aparece aqui quando informada no cadastro." /> : (
        <div className="grid gap-2">
          {membros.map((membro, index) => (
            <div className="rounded-card border border-meta-divider bg-meta-warm-gray p-3" key={index}>
              <strong className="block text-sm text-meta-charcoal">{valor(membro.nome_membro) || `Membro ${index + 1}`}</strong>
              <div className="mt-2 grid gap-2 text-xs text-meta-slate sm:grid-cols-2">
                <span>Parentesco: {valor(membro.parentesco) || "-"}</span>
                <span>CPF: {membro.nao_possui_cpf ? "Não possui" : valor(membro.cpf_membro) || "-"}</span>
                <span>Nascimento: {valor(membro.data_nascimento) || "-"}</span>
                <span>Escolaridade: {valor(membro.escolaridade) || "-"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AtendimentosPanel({ atendimentos, senhas }: { atendimentos: AtendimentoRecepcao[]; senhas: Senha[] }) {
  const itens = [
    ...atendimentos.slice(0, 8).map((item) => ({ id: `a-${item.id}`, title: `${rotuloDesfecho(item.desfecho)} · ${item.demanda}`, detail: `${item.unidade_nome} · ${formatarDataHora(item.criado_em)}${item.observacao ? ` · ${item.observacao}` : ""}` })),
    ...senhas.slice(0, 8).map((senha) => ({ id: `s-${senha.id}`, title: `Senha ${senha.senha} · ${rotuloSituacaoFila(senha.situacao)}`, detail: `${senha.servico || "Serviço não informado"} · ${rotuloPrioridade(senha.prioridade)} · ${formatarDataHora(senha.criado_em)}` })),
  ];
  return <Card><Titulo icon={Stethoscope} title="Atendimentos e fila" count={itens.length} /><ListaOuVazio itens={itens} vazio="Passagens pela recepção e senhas aparecem aqui." /></Card>;
}

function CasosPanel({ casos }: { casos: Caso[] }) {
  return (
    <Card>
      <Titulo icon={ClipboardList} title="Casos" count={casos.length} />
      {casos.length === 0 ? <EmptyState title="Sem casos" text="Casos abertos pela recepção ou atendimento aparecem aqui." /> : (
        <div className="grid gap-2">
          {casos.map((caso) => (
            <Link className="block rounded-card border border-meta-divider bg-meta-warm-gray p-3 transition-all hover:border-primary/30 hover:bg-white hover:shadow-lift" href="/casos" key={caso.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm text-meta-charcoal">{caso.protocolo}</strong>
                <Badge tone={tomDoCaso(caso.situacao)}>{rotuloSituacao(caso.situacao)}</Badge>
              </div>
              <p className="mt-1 text-xs text-meta-slate">{caso.servico_nome || "Serviço não informado"} · {caso.unidade_nome}</p>
              {caso.descricao && <p className="mt-2 line-clamp-2 text-xs leading-5 text-meta-charcoal">{caso.descricao}</p>}
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function BeneficiosPanel({ cidadao, beneficios, onSaved }: { cidadao: Cidadao; beneficios: BeneficioEventual[]; onSaved: () => Promise<void> }) {
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({
    nome_da_pessoa: cidadao.nome,
    tipo: "SITUACAO_VULNERABILIDADE_TEMPORARIA",
    tipo_outro: "",
    descricao: "",
  });

  async function salvar() {
    setErro("");
    setSalvando(true);
    try {
      await api<BeneficioEventual>(`/citizens/${cidadao.id}/beneficios`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ nome_da_pessoa: cidadao.nome, tipo: "SITUACAO_VULNERABILIDADE_TEMPORARIA", tipo_outro: "", descricao: "" });
      setAberto(false);
      await onSaved();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível registrar o benefício.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <TituloAcao icon={Gift} title="Benefícios eventuais" count={beneficios.length} action={
        <SecondaryButton type="button" className="h-9 px-3 text-xs" onClick={() => setAberto((valor) => !valor)}>
          <Plus size={14} />
          Registrar
        </SecondaryButton>
      } />

      {aberto && (
        <div className="mb-4 rounded-card border border-primary/15 bg-primary/5 p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Pessoa beneficiada">
              <Input value={form.nome_da_pessoa} onChange={(event) => setForm((old) => ({ ...old, nome_da_pessoa: event.target.value }))} />
            </Field>
            <Field label="Tipo">
              <Select value={form.tipo} onChange={(event) => setForm((old) => ({ ...old, tipo: event.target.value }))}>
                <option value="SITUACAO_VULNERABILIDADE_TEMPORARIA">Vulnerabilidade temporária</option>
                <option value="SITUACAO_NASCIMENTO">Situação de nascimento</option>
                <option value="SITUACAO_MORTE">Situação de morte</option>
                <option value="SITUACAO_CALAMIDADE">Situação de calamidade</option>
                <option value="OUTROS">Outros</option>
              </Select>
            </Field>
          </div>
          {form.tipo === "OUTROS" && (
            <div className="mt-3">
              <Field label="Qual tipo?">
                <Input value={form.tipo_outro} onChange={(event) => setForm((old) => ({ ...old, tipo_outro: event.target.value }))} placeholder="Ex.: passagem, documentação..." />
              </Field>
            </div>
          )}
          <div className="mt-3">
            <Field label="Descrição / justificativa">
              <textarea className="input min-h-24" value={form.descricao} onChange={(event) => setForm((old) => ({ ...old, descricao: event.target.value }))} placeholder="O que foi concedido, motivo e orientação dada." />
            </Field>
          </div>
          {erro && <p className="mt-2 text-xs font-semibold text-danger">{erro}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <SecondaryButton type="button" className="h-9 px-3 text-xs" onClick={() => setAberto(false)}>Cancelar</SecondaryButton>
            <Button type="button" className="h-9 px-3 text-xs" disabled={salvando} onClick={salvar}>{salvando ? "Salvando..." : "Salvar benefício"}</Button>
          </div>
        </div>
      )}

      <ListaOuVazio itens={beneficios.map((b) => ({ id: b.id, title: `${b.tipo_outro || b.tipo_rotulo || b.tipo} · ${b.nome_da_pessoa}`, detail: `${b.unidade_nome || "Sem unidade"} · ${formatarDataHora(b.criado_em)}${b.descricao ? ` · ${b.descricao}` : ""}` }))} vazio="Benefícios concedidos ou registrados aparecem aqui." />
    </Card>
  );
}

function EncaminhamentosPanel({ cidadao, casos, encaminhamentos, unidades, onSaved }: { cidadao: Cidadao; casos: Caso[]; encaminhamentos: Encaminhamento[]; unidades: Unidade[]; onSaved: () => Promise<void> }) {
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({
    caso_id: "",
    unidade_destino_id: "",
    destino_externo: "",
    motivo: "",
    observacoes: "",
  });

  async function salvar() {
    setErro("");
    setSalvando(true);
    try {
      await api<Encaminhamento>(`/citizens/${cidadao.id}/encaminhamentos`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ caso_id: "", unidade_destino_id: "", destino_externo: "", motivo: "", observacoes: "" });
      setAberto(false);
      await onSaved();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível registrar o encaminhamento.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <TituloAcao icon={Send} title="Encaminhamentos" count={encaminhamentos.length} action={
        <SecondaryButton type="button" className="h-9 px-3 text-xs" onClick={() => setAberto((valor) => !valor)}>
          <Plus size={14} />
          Registrar
        </SecondaryButton>
      } />

      {aberto && (
        <div className="mb-4 rounded-card border border-primary/15 bg-primary/5 p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Vincular a caso">
              <Select value={form.caso_id} onChange={(event) => setForm((old) => ({ ...old, caso_id: event.target.value }))}>
                <option value="">Criar caso de encaminhamento</option>
                {casos.map((caso) => <option key={caso.id} value={caso.id}>{caso.protocolo} · {rotuloSituacao(caso.situacao)}</option>)}
              </Select>
            </Field>
            <Field label="Unidade da rede">
              <Select value={form.unidade_destino_id} onChange={(event) => setForm((old) => ({ ...old, unidade_destino_id: event.target.value, destino_externo: event.target.value ? "" : old.destino_externo }))}>
                <option value="">Destino externo</option>
                {unidades.map((unidade) => <option key={unidade.id} value={unidade.id}>{unidade.nome_qualificado || unidade.nome}</option>)}
              </Select>
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Destino externo">
              <Input value={form.destino_externo} disabled={Boolean(form.unidade_destino_id)} onChange={(event) => setForm((old) => ({ ...old, destino_externo: event.target.value }))} placeholder="Ex.: Conselho Tutelar, UBS, Defensoria..." />
            </Field>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Motivo">
              <textarea className="input min-h-24" value={form.motivo} onChange={(event) => setForm((old) => ({ ...old, motivo: event.target.value }))} placeholder="Por que o cidadão está sendo encaminhado?" />
            </Field>
            <Field label="Observações">
              <textarea className="input min-h-24" value={form.observacoes} onChange={(event) => setForm((old) => ({ ...old, observacoes: event.target.value }))} placeholder="Documentos, combinados e orientações." />
            </Field>
          </div>
          {erro && <p className="mt-2 text-xs font-semibold text-danger">{erro}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <SecondaryButton type="button" className="h-9 px-3 text-xs" onClick={() => setAberto(false)}>Cancelar</SecondaryButton>
            <Button type="button" className="h-9 px-3 text-xs" disabled={salvando} onClick={salvar}>{salvando ? "Salvando..." : "Salvar encaminhamento"}</Button>
          </div>
        </div>
      )}

      <ListaOuVazio itens={encaminhamentos.map((e) => ({ id: e.id, title: `${e.unidade_destino_nome || e.destino_externo} · ${rotuloSituacaoEncaminhamento(e.situacao)}`, detail: `${formatarDataHora(e.criado_em)} · ${e.motivo}${e.observacoes ? ` · ${e.observacoes}` : ""}` }))} vazio="Encaminhamentos internos ou externos aparecem aqui." />
    </Card>
  );
}

function AnexosPanel({ anexos }: { anexos: Record<string, unknown>[] }) {
  return <Card><Titulo icon={FileArchive} title="Documentos anexados" count={anexos.length} /><ListaOuVazio itens={anexos.map((a, i) => ({ id: valor(a.id) || String(i), title: valor(a.nome_original) || valor(a.nome_arquivo) || `Documento ${i + 1}`, detail: [valor(a.tipo_documento), valor(a.mime), valor(a.data_envio)].filter(Boolean).join(" · ") }))} vazio="Documentos enviados ao prontuário aparecem aqui." /></Card>;
}

function HistoricoPanel({ historico }: { historico: EntradaHistorico[] }) {
  return <Card><Titulo icon={CalendarClock} title="Histórico municipal" count={historico.length} /><ListaOuVazio itens={historico.map((h, i) => ({ id: `${h.quando}-${i}`, title: h.o_que, detail: `${h.unidade} · ${formatarDataHora(h.quando)}${h.detalhe ? ` · ${h.detalhe}` : ""}` }))} vazio="Os atendimentos desta pessoa aparecem aqui." /></Card>;
}

function PrivacidadePanel({ cidadao }: { cidadao: Cidadao }) {
  return (
    <Card>
      <Titulo icon={ShieldCheck} title="Privacidade e LGPD" count={null} />
      <p className="text-sm leading-6 text-meta-slate">Imprima o prontuário para uso administrativo ou exporte os dados pessoais em JSON quando houver solicitação LGPD.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a className="button" href={`/api/citizens/${cidadao.id}/imprimir`} target="_blank" rel="noreferrer">Imprimir prontuário</a>
        <a className="button secondary" href={`/api/citizens/${cidadao.id}/exportar`} target="_blank" rel="noreferrer">Exportar JSON LGPD</a>
        <Badge tone={cidadao.imagem_revogada_em ? "bad" : cidadao.autoriza_imagem ? "good" : "neutral"}>{cidadao.imagem_revogada_em ? "Imagem revogada" : cidadao.autoriza_imagem ? "Imagem autorizada" : "Imagem sem autorização"}</Badge>
      </div>
    </Card>
  );
}

function Titulo({ icon: Icon, title, count }: { icon: React.ElementType; title: string; count: number | null }) {
  return <div className="mb-4 flex items-center justify-between gap-3"><div className="row !justify-start"><span className="flex h-9 w-9 items-center justify-center rounded-pill bg-primary/10 text-primary"><Icon size={17} /></span><h2 className="!mb-0 !text-lg">{title}</h2></div>{count !== null && <Badge tone="neutral">{count}</Badge>}</div>;
}

function TituloAcao({ icon: Icon, title, count, action }: { icon: React.ElementType; title: string; count: number; action: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="row !justify-start">
        <span className="flex h-9 w-9 items-center justify-center rounded-pill bg-primary/10 text-primary"><Icon size={17} /></span>
        <h2 className="!mb-0 !text-lg">{title}</h2>
        <Badge tone="neutral">{count}</Badge>
      </div>
      {action}
    </div>
  );
}

function Resumo({ title, value, icon: Icon, tone }: { title: string; value: number; icon: React.ElementType; tone: "primary" | "neutral" | "good" | "warn" }) {
  const toneClass = { primary: "bg-primary/10 text-primary", neutral: "bg-meta-soft-gray text-meta-charcoal", good: "bg-success/10 text-success", warn: "bg-warning/20 text-[#8a5a00]" }[tone];
  return <Card className="!p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">{title}</p><strong className="mt-2 block text-3xl text-meta-charcoal">{value}</strong></div><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-pill ${toneClass}`}><Icon size={18} /></span></div></Card>;
}

function InfoGrid({ rows }: { rows: Array<[string, string | null | undefined]> }) {
  const visibleRows = rows.filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (visibleRows.length === 0) return <EmptyState title="Sem dados" text="Nenhuma informação registrada nesta seção." />;
  return <div className="grid gap-2">{visibleRows.map(([label, value]) => <div className="flex items-start justify-between gap-4 rounded-card bg-meta-warm-gray px-3 py-2 text-sm" key={label}><span className="text-meta-slate">{label}</span><strong className="max-w-[62%] text-right font-medium text-meta-charcoal">{value}</strong></div>)}</div>;
}

function ListaSimples({ titulo, itens }: { titulo: string; itens: Array<{ id: string; title: string | null; detail?: string | null }> }) {
  return <div className="mt-4"><h3 className="mb-2 text-sm font-semibold">{titulo}</h3><div className="grid gap-2">{itens.map((item) => <MiniLinha key={item.id} title={item.title} detail={item.detail} />)}</div></div>;
}

function ListaOuVazio({ itens, vazio }: { itens: Array<{ id: string; title: string | null; detail?: string | null }>; vazio: string }) {
  if (itens.length === 0) return <EmptyState title="Sem registros" text={vazio} />;
  return <div className="grid gap-2">{itens.map((item) => <MiniLinha key={item.id} title={item.title} detail={item.detail} />)}</div>;
}

function MiniLinha({ title, detail }: { title: string | null | undefined; detail?: string | null }) {
  return <div className="rounded-card border border-meta-divider bg-meta-warm-gray p-3"><strong className="block text-sm text-meta-charcoal">{title || "Registro"}</strong>{detail && <p className="mt-1 text-xs leading-5 text-meta-slate">{detail}</p>}</div>;
}

function valor(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return String(value);
}

function booleano(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return value ? "Sim" : "Não";
}

function formatarData(value: string) {
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

function formatarDataHora(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function rotuloDesfecho(value: string) { return value === "FINALIZADO" ? "Finalizado na recepção" : "Encaminhado para fila"; }
function rotuloPrioridade(value: string) { return ({ BAIXA: "Baixa", NORMAL: "Normal", ALTA: "Alta", URGENTE: "Urgente" } as Record<string, string>)[value] ?? value; }
function rotuloSituacaoFila(value: string) { return ({ AGUARDANDO: "Aguardando", CHAMADO: "Chamado", EM_ATENDIMENTO: "Em atendimento", ATENDIDO: "Atendido", DESISTIU: "Não compareceu" } as Record<string, string>)[value] ?? value; }
function rotuloSituacao(value: string) { return ({ EM_TRIAGEM: "Em triagem", EM_ATENDIMENTO: "Em atendimento", CONCLUIDO: "Concluído", ENCAMINHADO: "Encaminhado", CANCELADO: "Cancelado" } as Record<string, string>)[value] ?? value; }
function rotuloSituacaoEncaminhamento(value: string) { return ({ PENDENTE: "Pendente", ACEITO: "Aceito", RECUSADO: "Recusado", CONCLUIDO: "Concluído" } as Record<string, string>)[value] ?? value; }
function tomDoCaso(value: string): "neutral" | "good" | "warn" | "bad" { if (value === "CONCLUIDO") return "good"; if (value === "CANCELADO") return "neutral"; if (value === "EM_ATENDIMENTO") return "warn"; return "bad"; }
