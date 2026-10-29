"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, ClipboardList, FolderOpen, Gift, House, Plus, Send, ShieldCheck, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, DadosEmLista, EmptyState, Field, Input, PageHeader, SecondaryButton, SectionHeading, Select, Stat } from "@/components/ui";
import { AvisoDeDuplicidade, alertasDoErro, justificativaValida, mensagemDeDuplicidade, useDuplicidade } from "@/components/duplicidade/aviso";
import { DetalheDoEncaminhamento } from "@/components/encaminhamentos/detalhe";
import { destinoDoEncaminhamento } from "@/components/encaminhamentos/ficha";
import {
  CamposDeEncaminhamento, FORMULARIO_VAZIO, corpoDoEncaminhamento, validarEncaminhamento,
  type FormularioDeEncaminhamento,
} from "@/components/encaminhamentos/formulario";
import { api, mensagemDaApi } from "@/lib/api";
import { rotuloPrioridade, rotuloSituacao, rotuloSituacaoDaSenha, tomDoCaso } from "@/lib/casos";
import { formatarData, formatarDataHora } from "@/lib/datas";
import { rotuloDaSituacao } from "@/lib/encaminhamentos";
import { AnexosPanel } from "./anexos-panel";
import type { AlertaDeDuplicidade, AtendimentoRecepcao, BeneficioEventual, Caso, Cidadao, Encaminhamento, EntradaHistorico, ProntuarioCidadao, Senha, Unidade } from "@/types/sgcas";

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
        <SecondaryButton type="button" size="sm" onClick={() => router.back()}>
          <ArrowLeft size={15} aria-hidden="true" />
          Voltar
        </SecondaryButton>
      </div>

      <PageHeader
        title={cidadao?.nome ?? "Prontuário do cidadão"}
        description={cidadao ? [cidadao.cpf, cidadao.email, cidadao.telefone].filter(Boolean).join(" · ") || "Cadastro sem documento principal" : "Carregando..."}
        action={cidadao ? <Link href="/recepcao" className="button">Nova recepção</Link> : null}
      />

      {erro && <div className="notice mb-4" role="alert">{erro}</div>}
      {carregando && <Card><EmptyState title="Carregando prontuário" text="Buscando cadastro, histórico e registros vinculados." /></Card>}

      {prontuario && cidadao && resumo && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Casos ativos" vertical value={resumo.casosAbertos} icon={ClipboardList} highlight={resumo.casosAbertos > 0} />
            <Stat label="Benefícios" vertical value={resumo.beneficios} icon={Gift} />
            <Stat label="Encaminhamentos" vertical value={resumo.encaminhamentos} icon={Send} />
            <Stat label="Família" vertical value={resumo.familia} icon={Users} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <DadosCadastrais cidadao={cidadao} />
            <DadosEndereco cidadao={cidadao} enderecoDetalhado={prontuario.endereco_detalhado} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <DadosSocioeconomicos dados={prontuario.socioeconomico} />
            <MembrosFamilia membros={prontuario.membros_da_familia} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <AtendimentosPanel atendimentos={prontuario.atendimentos_recepcao} senhas={prontuario.senhas} />
            <CasosPanel casos={prontuario.casos} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <BeneficiosPanel cidadao={cidadao} beneficios={prontuario.beneficios_eventuais} onSaved={carregarProntuario} />
            <EncaminhamentosPanel cidadao={cidadao} casos={prontuario.casos} encaminhamentos={prontuario.encaminhamentos} unidades={unidades} onSaved={carregarProntuario} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <AnexosPanel cidadaoId={cidadao.id} anexos={prontuario.anexos} tipos={prontuario.tipos_de_anexo} onChanged={carregarProntuario} />
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
      <SectionHeading icon={ShieldCheck} title="Dados pessoais" />
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
      <SectionHeading icon={House} title="Endereço e moradia" />
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
      <SectionHeading icon={ClipboardList} title="Socioeconômico" />
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
      <SectionHeading icon={Users} title="Composição familiar" count={membros.length} />
      {membros.length === 0 ? <EmptyState title="Sem membros cadastrados" text="A composição familiar aparece aqui quando informada no cadastro." /> : (
        <ul>
          {membros.map((membro, index) => (
            <li className="line-row" key={index}>
              <strong className="block">{valor(membro.nome_membro) || `Membro ${index + 1}`}</strong>
              <DadosEmLista
                className="mt-2 !gap-y-1.5"
                itens={[
                  { rotulo: "Parentesco", valor: valor(membro.parentesco) || "—" },
                  { rotulo: "CPF", valor: membro.nao_possui_cpf ? "Não possui" : valor(membro.cpf_membro) || "—" },
                  { rotulo: "Nascimento", valor: valor(membro.data_nascimento) || "—" },
                  { rotulo: "Escolaridade", valor: valor(membro.escolaridade) || "—" },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AtendimentosPanel({ atendimentos, senhas }: { atendimentos: AtendimentoRecepcao[]; senhas: Senha[] }) {
  const itens = [
    ...atendimentos.slice(0, 8).map((item) => ({ id: `a-${item.id}`, title: `${rotuloDesfecho(item.desfecho)} · ${item.demanda}`, detail: `${item.unidade_nome} · ${formatarDataHora(item.criado_em)}${item.observacao ? ` · ${item.observacao}` : ""}` })),
    ...senhas.slice(0, 8).map((senha) => ({ id: `s-${senha.id}`, title: `Senha ${senha.senha} · ${rotuloSituacaoDaSenha(senha.situacao)}`, detail: `${senha.servico || "Serviço não informado"} · ${rotuloPrioridade(senha.prioridade)} · ${formatarDataHora(senha.criado_em)}` })),
  ];
  return <Card><SectionHeading icon={ClipboardList} title="Atendimentos e fila" count={itens.length} /><ListaOuVazio itens={itens} vazio="Passagens pela recepção e senhas aparecem aqui." /></Card>;
}

function CasosPanel({ casos }: { casos: Caso[] }) {
  return (
    <Card>
      <SectionHeading icon={FolderOpen} title="Casos" count={casos.length} />
      {casos.length === 0 ? <EmptyState title="Sem casos" text="Casos abertos pela recepção ou atendimento aparecem aqui." /> : (
        <ul>
          {casos.map((caso) => (
            <li className="line-row" key={caso.id}>
              <Link className="block rounded-md transition-colors hover:text-primary" href="/casos">
                <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <strong>{caso.protocolo}</strong>
                  <Badge tone={tomDoCaso(caso.situacao)}>{rotuloSituacao(caso.situacao)}</Badge>
                </span>
                <small className="mt-0.5 block">{caso.servico_nome || "Serviço não informado"} · {caso.unidade_nome}</small>
                {caso.descricao && <span className="mt-1 line-clamp-2 block text-[13px] leading-5 text-meta-charcoal">{caso.descricao}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BeneficiosPanel({ cidadao, beneficios, onSaved }: { cidadao: Cidadao; beneficios: BeneficioEventual[]; onSaved: () => Promise<void> }) {
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [alertasDoServidor, setAlertasDoServidor] = useState<AlertaDeDuplicidade[]>([]);
  const formInicial = { nome_da_pessoa: cidadao.nome, tipo: "SITUACAO_VULNERABILIDADE_TEMPORARIA", tipo_outro: "", descricao: "" };
  const [form, setForm] = useState(formInicial);

  // O aviso aparece assim que o tipo é escolhido, não só ao tentar salvar.
  const outro = form.tipo_outro.trim();
  const consulta = !aberto ? null : form.tipo === "OUTROS"
    ? (outro ? `tipo=OUTROS&tipo_outro=${encodeURIComponent(outro)}` : null)
    : `tipo=${form.tipo}`;
  const daPrevia = useDuplicidade(cidadao.id, consulta);
  const alertas = daPrevia.length > 0 ? daPrevia : alertasDoServidor;

  function mudar(parcial: Partial<typeof formInicial>) {
    setForm((old) => ({ ...old, ...parcial }));
    // Os avisos do servidor valem para o tipo que foi enviado; outro tipo, outra pergunta.
    if ("tipo" in parcial || "tipo_outro" in parcial) setAlertasDoServidor([]);
  }

  async function salvar() {
    setErro("");
    if (alertas.length > 0 && !justificativaValida(justificativa)) {
      setErro("Escreva a justificativa para repetir este auxílio.");
      return;
    }
    setSalvando(true);
    try {
      await api<BeneficioEventual>(`/citizens/${cidadao.id}/beneficios`, {
        method: "POST",
        body: JSON.stringify({ ...form, justificativa_duplicidade: alertas.length > 0 ? justificativa.trim() : null }),
      });
      setForm(formInicial);
      setJustificativa("");
      setAlertasDoServidor([]);
      setAberto(false);
      await onSaved();
    } catch (error) {
      const duplicadas = alertasDoErro(error);
      if (duplicadas) {
        setAlertasDoServidor(duplicadas);
        setErro(mensagemDeDuplicidade(duplicadas));
      } else {
        setErro(mensagemDaApi(error, "Não foi possível registrar o benefício."));
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <SectionHeading icon={Gift} title="Benefícios eventuais" count={beneficios.length} action={
        <SecondaryButton type="button" size="sm" onClick={() => setAberto((valor) => !valor)}>
          <Plus size={14} aria-hidden="true" />
          Registrar
        </SecondaryButton>
      } />

      {aberto && (
        <div className="mb-4 rounded-lg border border-meta-divider bg-meta-warm-gray p-3 sm:p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Pessoa beneficiada">
              <Input value={form.nome_da_pessoa} onChange={(event) => mudar({ nome_da_pessoa: event.target.value })} />
            </Field>
            <Field label="Tipo">
              <Select value={form.tipo} onChange={(event) => mudar({ tipo: event.target.value })}>
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
                <Input value={form.tipo_outro} onChange={(event) => mudar({ tipo_outro: event.target.value })} placeholder="Ex.: passagem, documentação..." />
              </Field>
            </div>
          )}
          <div className="mt-3">
            <Field label="Descrição">
              <textarea className="input min-h-24" value={form.descricao} onChange={(event) => mudar({ descricao: event.target.value })} placeholder="O que foi concedido, motivo e orientação dada." />
            </Field>
          </div>
          <div className="mt-3">
            <AvisoDeDuplicidade alertas={alertas} justificativa={justificativa} onChange={setJustificativa} />
          </div>
          {erro && <p role="alert" className="field-error mt-2">{erro}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <SecondaryButton type="button" size="sm" onClick={() => setAberto(false)}>Cancelar</SecondaryButton>
            <Button type="button" size="sm" disabled={salvando} onClick={salvar}>{salvando ? "Salvando..." : "Salvar benefício"}</Button>
          </div>
        </div>
      )}

      <ListaOuVazio itens={beneficios.map((b) => ({ id: b.id, title: `${b.tipo_outro || b.tipo_rotulo || b.tipo} · ${b.nome_da_pessoa}`, detail: `${b.unidade_nome || "Sem unidade"} · ${formatarDataHora(b.criado_em)}${b.descricao ? ` · ${b.descricao}` : ""}${b.justificativa_duplicidade ? ` · Justificativa para repetir: ${b.justificativa_duplicidade}` : ""}` }))} vazio="Benefícios concedidos ou registrados aparecem aqui." />
    </Card>
  );
}

function EncaminhamentosPanel({ cidadao, casos, encaminhamentos, unidades, onSaved }: { cidadao: Cidadao; casos: Caso[]; encaminhamentos: Encaminhamento[]; unidades: Unidade[]; onSaved: () => Promise<void> }) {
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [casoId, setCasoId] = useState("");
  const [form, setForm] = useState<FormularioDeEncaminhamento>(FORMULARIO_VAZIO);
  // Os erros só aparecem depois da primeira tentativa de salvar e acompanham o que está digitado.
  const [tentou, setTentou] = useState(false);
  const erros = tentou ? validarEncaminhamento(form) : {};
  const [fichaAberta, setFichaAberta] = useState<string | null>(null);

  async function salvar() {
    setErro("");
    setTentou(true);
    if (Object.keys(validarEncaminhamento(form)).length > 0) return;

    setSalvando(true);
    try {
      await api<Encaminhamento>(`/citizens/${cidadao.id}/encaminhamentos`, {
        method: "POST",
        body: JSON.stringify({ ...corpoDoEncaminhamento(form), caso_id: casoId || null }),
      });
      setForm(FORMULARIO_VAZIO);
      setTentou(false);
      setCasoId("");
      setAberto(false);
      await onSaved();
    } catch (error) {
      setErro(mensagemDaApi(error, "Não foi possível registrar o encaminhamento."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <SectionHeading icon={Send} title="Encaminhamentos" count={encaminhamentos.length} action={
        <SecondaryButton type="button" size="sm" onClick={() => setAberto((valor) => !valor)}>
          <Plus size={14} aria-hidden="true" />
          Registrar
        </SecondaryButton>
      } />

      {aberto && (
        <div className="mb-4 rounded-lg border border-meta-divider bg-meta-warm-gray p-3 sm:p-4">
          <div className="mb-4">
            <Field label="Vincular a caso">
              <Select value={casoId} onChange={(event) => setCasoId(event.target.value)}>
                <option value="">Criar caso de encaminhamento</option>
                {casos.map((caso) => <option key={caso.id} value={caso.id}>{caso.protocolo} · {rotuloSituacao(caso.situacao)}</option>)}
              </Select>
            </Field>
          </div>
          <CamposDeEncaminhamento valor={form} onChange={setForm} unidades={unidades} erros={erros} />
          {erro && <p role="alert" className="field-error mt-2">{erro}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <SecondaryButton type="button" size="sm" onClick={() => setAberto(false)}>Cancelar</SecondaryButton>
            <Button type="button" size="sm" disabled={salvando} onClick={salvar}>{salvando ? "Salvando..." : "Salvar encaminhamento"}</Button>
          </div>
        </div>
      )}

      {encaminhamentos.length === 0 ? (
        <EmptyState title="Sem registros" text="Encaminhamentos internos ou externos aparecem aqui." />
      ) : (
        <ul>
          {encaminhamentos.map((e) => (
            <li className="line-row" key={e.id}>
              <button
                type="button"
                onClick={() => setFichaAberta(e.id)}
                className="block w-full rounded-md text-left transition-colors hover:text-primary"
                aria-label={`Abrir a ficha do encaminhamento para ${destinoDoEncaminhamento(e)}`}
              >
                <strong className="block text-sm">
                  {(e.unidade_origem_nome || "Origem")} → {destinoDoEncaminhamento(e)} · {rotuloDaSituacao(e.situacao)}
                </strong>
                <small className="mt-0.5 block">
                  {formatarDataHora(e.criado_em)} · {e.categoria_rotulo} · Urgência {e.urgencia_rotulo.toLowerCase()}
                  {e.motivo ? ` · ${e.motivo}` : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}

      <DetalheDoEncaminhamento id={fichaAberta} onClose={() => setFichaAberta(null)} onMudou={() => void onSaved()} />
    </Card>
  );
}

function HistoricoPanel({ historico }: { historico: EntradaHistorico[] }) {
  return <Card><SectionHeading icon={CalendarClock} title="Histórico municipal" count={historico.length} /><ListaOuVazio itens={historico.map((h, i) => ({ id: `${h.quando}-${i}`, title: h.o_que, detail: `${h.unidade} · ${formatarDataHora(h.quando)}${h.detalhe ? ` · ${h.detalhe}` : ""}` }))} vazio="Os atendimentos desta pessoa aparecem aqui." /></Card>;
}

function PrivacidadePanel({ cidadao }: { cidadao: Cidadao }) {
  return (
    <Card>
      <SectionHeading icon={ShieldCheck} title="Privacidade e LGPD" />
      <p className="text-sm leading-6 text-meta-slate">Imprima o prontuário para uso administrativo ou exporte os dados pessoais em JSON quando houver solicitação LGPD.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a className="button" href={`/api/citizens/${cidadao.id}/imprimir`} target="_blank" rel="noreferrer">Imprimir prontuário</a>
        <a className="button secondary" href={`/api/citizens/${cidadao.id}/exportar`} target="_blank" rel="noreferrer">Exportar JSON LGPD</a>
        <Badge tone={cidadao.imagem_revogada_em ? "bad" : cidadao.autoriza_imagem ? "good" : "neutral"}>{cidadao.imagem_revogada_em ? "Imagem revogada" : cidadao.autoriza_imagem ? "Imagem autorizada" : "Imagem sem autorização"}</Badge>
      </div>
    </Card>
  );
}

function InfoGrid({ rows }: { rows: Array<[string, string | null | undefined]> }) {
  const visibleRows = rows.filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (visibleRows.length === 0) return <EmptyState title="Sem dados" text="Nenhuma informação registrada nesta seção." />;
  return <DadosEmLista itens={visibleRows.map(([rotulo, valor]) => ({ rotulo, valor }))} />;
}

function ListaSimples({ titulo, itens }: { titulo: string; itens: Array<{ id: string; title: string | null; detail?: string | null }> }) {
  return (
    <div className="mt-4 border-t border-meta-divider pt-4">
      <h3 className="mb-1 !text-sm">{titulo}</h3>
      <ul>{itens.map((item) => <MiniLinha key={item.id} title={item.title} detail={item.detail} />)}</ul>
    </div>
  );
}

function ListaOuVazio({ itens, vazio }: { itens: Array<{ id: string; title: string | null; detail?: string | null }>; vazio: string }) {
  if (itens.length === 0) return <EmptyState title="Sem registros" text={vazio} />;
  return <ul>{itens.map((item) => <MiniLinha key={item.id} title={item.title} detail={item.detail} />)}</ul>;
}

function MiniLinha({ title, detail }: { title: string | null | undefined; detail?: string | null }) {
  return (
    <li className="line-row">
      <strong className="block">{title || "Registro"}</strong>
      {detail && <small className="mt-0.5 block">{detail}</small>}
    </li>
  );
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

function rotuloDesfecho(value: string) { return value === "FINALIZADO" ? "Finalizado na recepção" : "Encaminhado para fila"; }
