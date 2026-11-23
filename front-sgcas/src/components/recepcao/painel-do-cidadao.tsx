"use client";

import { ArrowLeftRight, CheckCircle2, ClipboardList, Clock3, MapPin, Send, Stethoscope } from "lucide-react";
import { Badge, Card, EmptyState, SectionHeading } from "@/components/ui";
import type { AcaoAtendimento } from "@/components/recepcao/tipos";
import { rotuloPrioridade, rotuloSituacao, tomDaPrioridade, tomDoCaso } from "@/lib/casos";
import { formatarDataCurta, formatarDataHora } from "@/lib/datas";
import type { Caso, EncaminhamentoResumo, EntradaHistorico } from "@/types/sgcas";

/** Os dois desfechos do balcão, ao lado do histórico da pessoa. */
export function DesfechosDoBalcao({ mensagem, onEscolher }: { mensagem: string; onEscolher: (acao: AcaoAtendimento) => void }) {
  return (
    <Card className="h-fit xl:col-start-2 xl:row-start-1">
      <h2 className="!mb-0.5 !text-base">Atendimento</h2>
      <p className="mb-3 text-[13px] leading-5 text-meta-slate">Escolha o desfecho da recepção.</p>
      <div className="grid gap-2.5">
        {mensagem && <div className="notice" role="alert">{mensagem}</div>}

        <button
          type="button"
          className="flex items-start gap-3 rounded-lg bg-primary p-3.5 text-left text-primary-foreground transition-colors hover:bg-primary-hover"
          onClick={() => onEscolher("ENCAMINHADO")}
        >
          <Send size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <strong className="block text-sm font-semibold">Iniciar atendimento</strong>
            <small className="block text-[13px] leading-5 text-primary-foreground/85">Cria o caso e gera a senha.</small>
          </span>
        </button>

        <button
          type="button"
          className="flex items-start gap-3 rounded-lg border border-meta-divider bg-white p-3.5 text-left text-meta-charcoal transition-colors hover:bg-meta-soft-gray"
          onClick={() => onEscolher("FINALIZADO")}
        >
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-meta-slate" aria-hidden="true" />
          <span className="min-w-0">
            <strong className="block text-sm font-semibold">Finalizar na recepção</strong>
            <small className="block text-[13px] leading-5 text-meta-slate">Registra a orientação dada no balcão.</small>
          </span>
        </button>
      </div>
    </Card>
  );
}

/**
 * A pessoa foi encaminhada para esta unidade e ainda não chegou ao balcão. A
 * recepção vê só o resumo — de onde, quando, a categoria e a urgência; o relato
 * é da equipe técnica.
 */
export function EncaminhamentosAguardando({ encaminhamentos, nome }: { encaminhamentos: EncaminhamentoResumo[]; nome: string }) {
  return (
    <div role="status" className="rounded-card border border-primary/30 bg-accent p-3.5 sm:p-4">
      <div className="flex items-start gap-2 text-meta-charcoal">
        <ArrowLeftRight size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
        <strong>{nome} foi encaminhado(a) para esta unidade</strong>
      </div>
      <ul className="mt-2 grid gap-1 text-sm leading-6 text-meta-charcoal">
        {encaminhamentos.map((e) => (
          <li key={e.id}>
            De <strong>{e.unidade_origem_nome || "outra unidade"}</strong> em {formatarDataHora(e.criado_em)} ·{" "}
            {e.categoria_rotulo} · urgência {e.urgencia_rotulo.toLowerCase()}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] leading-5 text-meta-slate">
        Ao iniciar o atendimento, vincule a visita ao encaminhamento: a ficha e a urgência seguem com a pessoa e a unidade
        de origem é avisada da chegada.
      </p>
    </div>
  );
}

/** O que a recepção confere antes de decidir: casos e atendimentos recentes da pessoa. */
export function PainelDoCidadao({ casos, historico, casosIndisponiveis, historicoIndisponivel }: {
  casos: Caso[];
  historico: EntradaHistorico[];
  casosIndisponiveis: boolean;
  historicoIndisponivel: boolean;
}) {
  const casosAbertos = casos.filter((caso) => !["CONCLUIDO", "CANCELADO"].includes(caso.situacao));
  const ultimoContato = historico[0]?.quando;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="!mb-1 !text-base">Histórico para decisão</h2>
          <p className="text-[13px] leading-5 text-meta-slate">
            Confira se já existe atendimento parecido antes de criar uma nova senha.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {casosIndisponiveis ? (
            <Badge tone="warn">Casos não conferidos</Badge>
          ) : (
            <Badge tone={casosAbertos.length ? "warn" : "good"}>
              {casosAbertos.length ? `${casosAbertos.length} caso(s) aberto(s)` : "Sem caso aberto"}
            </Badge>
          )}
          {historicoIndisponivel ? (
            <Badge tone="warn">Histórico não conferido</Badge>
          ) : (
            <Badge tone="neutral">
              {ultimoContato ? `Último contato ${formatarDataCurta(ultimoContato)}` : "Sem histórico recente"}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2 xl:gap-8">
        <CasosRecentes casos={casos} indisponiveis={casosIndisponiveis} />
        <HistoricoAtendimentos historico={historico} indisponivel={historicoIndisponivel} />
      </div>
    </div>
  );
}

function CasosRecentes({ casos, indisponiveis }: { casos: Caso[]; indisponiveis: boolean }) {
  return (
    <div className="min-w-0">
      <SectionHeading icon={ClipboardList} title="Casos recentes" count={casos.length} />

      {indisponiveis ? (
        <EmptyState title="Casos indisponíveis" text="Não foi possível conferir os casos desta pessoa. Atualize a página antes de decidir." />
      ) : casos.length === 0 ? (
        <EmptyState title="Nenhum caso recente" text="Se a demanda for nova, inicie o atendimento e gere a senha." />
      ) : (
        <ul>
          {casos.slice(0, 6).map((caso) => (
            <li className="line-row" key={caso.id}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                <div className="min-w-0">
                  <small className="block">Caso {caso.protocolo}</small>
                  <strong className="block">{caso.servico_nome || "Serviço não informado"}</strong>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={tomDoCaso(caso.situacao)}>{rotuloSituacao(caso.situacao)}</Badge>
                  <Badge tone={tomDaPrioridade(caso.prioridade)}>{rotuloPrioridade(caso.prioridade)}</Badge>
                </div>
              </div>

              <p className="mt-1.5 line-clamp-3 text-[13px] leading-5 text-meta-charcoal">{caso.descricao || "Sem observação registrada."}</p>

              <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-meta-slate">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={13} aria-hidden="true" />
                  {caso.unidade_nome}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={13} aria-hidden="true" />
                  Aberto em {formatarDataHora(caso.aberto_em)}
                </span>
                {caso.tecnico_nome && (
                  <span className="inline-flex items-center gap-1.5">
                    <Stethoscope size={13} aria-hidden="true" />
                    Em atendimento com {caso.tecnico_nome}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoricoAtendimentos({ historico, indisponivel }: { historico: EntradaHistorico[]; indisponivel: boolean }) {
  return (
    <div className="min-w-0">
      <SectionHeading icon={Clock3} title="Histórico de atendimentos" count={historico.length} />

      {indisponivel ? (
        <EmptyState title="Histórico indisponível" text="Não foi possível conferir o histórico desta pessoa. Atualize a página antes de conceder um benefício." />
      ) : historico.length === 0 ? (
        <EmptyState title="Sem atendimentos recentes" text="Nada nos últimos meses que indique duplicidade." />
      ) : (
        <ul>
          {historico.slice(0, 8).map((entrada, index) => (
            <li className="line-row" key={`${entrada.quando}-${index}`}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                <strong>{entrada.o_que}</strong>
                <Badge tone={entrada.e_de_outra_unidade ? "warn" : "neutral"}>
                  {entrada.e_de_outra_unidade ? "Outra unidade" : "Mesma unidade"}
                </Badge>
              </div>
              <p className="mt-1 text-[13px] leading-5 text-meta-charcoal">{entrada.detalhe || "Sem observação registrada."}</p>
              <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-meta-slate">
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={13} aria-hidden="true" />
                  {formatarDataHora(entrada.quando)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={13} aria-hidden="true" />
                  {entrada.unidade}
                </span>
                {entrada.quem_atendeu && (
                  <span className="inline-flex items-center gap-1.5">
                    <Stethoscope size={13} aria-hidden="true" />
                    {entrada.quem_atendeu}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
