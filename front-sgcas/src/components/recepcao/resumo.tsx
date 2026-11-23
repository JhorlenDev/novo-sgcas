"use client";

import { CheckCircle2, ClipboardList, Clock3, Headset, ListChecks, MapPin, Send, Stethoscope } from "lucide-react";
import { Badge, Card, EmptyState, SecondaryButton, SectionHeading, Stat } from "@/components/ui";
import { rotuloPrioridade, rotuloSituacaoDaSenha, tomDaPrioridade } from "@/lib/casos";
import { formatarDataHora } from "@/lib/datas";
import type { AtendimentoRecepcao, PainelRecepcao, Senha } from "@/types/sgcas";

/** Os números do balcão no dia. */
export function PainelResumoRecepcao({ painel }: { painel: PainelRecepcao | null }) {
  return (
    <section aria-label="Resumo da recepção" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <Stat label="Atendidos hoje" value={(painel?.atendimentos_hoje ?? 0).toLocaleString("pt-BR")} hint="Passagens registradas no balcão" icon={Headset} />
      <Stat label="Aguardando" value={(painel?.aguardando_na_fila ?? 0).toLocaleString("pt-BR")} hint="Senhas esperando chamada" icon={ListChecks} highlight />
      <Stat label="Em atendimento" value={(painel?.em_atendimento ?? 0).toLocaleString("pt-BR")} hint="Já chamados pela equipe" icon={Stethoscope} />
      <Stat label="Finalizados" value={(painel?.finalizados_no_balcao ?? 0).toLocaleString("pt-BR")} hint="Resolvidos na recepção" icon={CheckCircle2} />
      <Stat label="Geraram senha" value={(painel?.encaminhados_para_fila ?? 0).toLocaleString("pt-BR")} hint="Encaminhados hoje" icon={Send} />
    </section>
  );
}

export function UltimosAtendimentos({ atendimentos, completo = false }: { atendimentos: AtendimentoRecepcao[]; completo?: boolean }) {
  return (
    <Card>
      <SectionHeading title={completo ? "Atendimentos recentes" : "Meus últimos atendimentos"} count={atendimentos.length} />
      {completo && (
        <p className="-mt-1 mb-3 text-sm leading-6 text-meta-slate">
          Tudo que a recepção finalizou no balcão ou encaminhou para a fila.
        </p>
      )}

      {atendimentos.length === 0 ? (
        <EmptyState title="Nenhum registro ainda" text="Quando você finalizar ou enviar alguém para a fila, aparece aqui." />
      ) : (
        <ul>
          {atendimentos.slice(0, completo ? 20 : 6).map((atendimento) => (
            <li className="line-row" key={atendimento.id}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                <strong>{atendimento.cidadao_nome}</strong>
                <Badge tone={atendimento.desfecho === "ENCAMINHADO" ? "warn" : "good"}>
                  {atendimento.desfecho === "ENCAMINHADO" ? "Enviado para a fila" : "Finalizado no balcão"}
                </Badge>
              </div>
              <p className="mt-0.5 text-[13px] font-medium text-meta-charcoal">{atendimento.demanda}</p>
              <p className="mt-0.5 text-[13px] leading-5 text-meta-slate">
                {atendimento.observacao || atendimento.motivo || "Sem observação registrada."}
              </p>
              <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-meta-slate">
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={13} aria-hidden="true" />
                  {formatarDataHora(atendimento.criado_em)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={13} aria-hidden="true" />
                  {atendimento.local_do_atendimento || atendimento.unidade_nome}
                </span>
                {atendimento.caso_protocolo && (
                  <span className="inline-flex items-center gap-1.5">
                    <ClipboardList size={13} aria-hidden="true" />
                    Caso {atendimento.caso_protocolo}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A fila vista do balcão: quem chama é o atendente, na tela de Atendimento. */
export function FilaSomenteLeitura({ fila, onAtualizar }: { fila: Senha[]; onAtualizar: () => void }) {
  return (
    <Card>
      <SectionHeading
        title="Fila de atendimento"
        count={fila.length}
        action={
          <SecondaryButton type="button" size="sm" onClick={onAtualizar}>
            Atualizar
          </SecondaryButton>
        }
      />
      <p className="-mt-1 mb-3 text-sm leading-6 text-meta-slate">
        Consulta da recepção. Quem inicia o atendimento é o atendente, na tela de Atendimento.
      </p>

      {fila.length === 0 ? (
        <EmptyState title="Fila vazia" text="Nenhuma senha aguardando atendimento agora." />
      ) : (
        <ul>
          {fila.map((senha) => (
            <li className="line-row flex flex-wrap items-center gap-x-3 gap-y-2" key={senha.id}>
              <span className="flex h-10 min-w-14 shrink-0 items-center justify-center rounded-lg bg-primary px-2.5 text-[15px] font-bold tabular-nums text-primary-foreground">
                {senha.senha}
              </span>
              <span className="min-w-0 flex-1 basis-40">
                <span className="block text-sm font-semibold text-meta-charcoal">{senha.cidadao_nome}</span>
                <small className="block">{senha.servico || "Serviço não informado"}</small>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={tomDaPrioridade(senha.prioridade)}>{rotuloPrioridade(senha.prioridade)}</Badge>
                <Badge tone="neutral">{rotuloSituacaoDaSenha(senha.situacao)}</Badge>
                <small className="tabular-nums">{formatarDataHora(senha.criado_em)}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
