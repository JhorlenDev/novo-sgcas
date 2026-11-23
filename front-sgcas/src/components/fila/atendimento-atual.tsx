"use client";

import { ArrowRight, CheckCircle2, ClipboardEdit, Send, UserX } from "lucide-react";
import { Badge, Button, Card, EmptyState, SecondaryButton } from "@/components/ui";
import { PERIGO, type AtendimentoMontado, type ModoDaJanela } from "@/components/fila/tipos";
import { rotuloPrioridade, rotuloSituacao, tomDaPrioridade } from "@/lib/casos";

/** O cartão de quem está sendo atendido agora, com as ações do momento. */
export function AtendimentoAtual({
  atendimento,
  iniciado,
  recuperando,
  onConferir,
  onModo,
  onVerFicha,
}: {
  atendimento: AtendimentoMontado | null;
  iniciado: boolean;
  /** Ainda buscando, na API, o atendimento que o operador deixou aberto. */
  recuperando: boolean;
  onConferir: () => void;
  onModo: (modo: Exclude<ModoDaJanela, "inicio">) => void;
  onVerFicha: (encaminhamentoId: string) => void;
}) {
  return (
    <Card>
      <h2 id="atendimento-atual">Atendimento atual</h2>
      {!atendimento ? (
        <EmptyState title={recuperando ? "Recuperando atendimento..." : "Nenhum atendimento iniciado"} text="Use o botão chamar próximo para conferir a senha antes de iniciar." />
      ) : (
        <div className="grid gap-4">
          <div className="rounded-lg border border-meta-divider bg-meta-warm-gray p-4">
            <div className="row">
              <Badge tone="info">Senha {atendimento.senha.senha}</Badge>
              <Badge tone={tomDaPrioridade(atendimento.senha.prioridade)}>{rotuloPrioridade(atendimento.senha.prioridade)}</Badge>
              <Badge tone={iniciado ? "good" : "warn"}>
                {iniciado ? "Atendimento iniciado" : "Aguardando confirmação"}
              </Badge>
            </div>
            <h3 className="mt-3">{atendimento.cidadao.nome}</h3>
            <p className="text-sm text-meta-slate">{atendimento.senha.servico}</p>
            {atendimento.caso && (
              <div className="mt-3 rounded-lg border border-meta-divider bg-white p-3">
                <p className="text-[13px] font-semibold text-meta-slate">Caso em atendimento</p>
                <strong className="text-sm">{atendimento.caso.protocolo}</strong>
                <p className="text-sm text-meta-slate">{atendimento.caso.descricao || rotuloSituacao(atendimento.caso.situacao)}</p>
              </div>
            )}
            {atendimento.encaminhamento_recebido && (
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-primary/30 bg-accent p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <p className="text-[13px] font-semibold text-meta-slate">Encaminhamento recebido</p>
                  <strong>
                    De {atendimento.encaminhamento_recebido.unidade_origem_nome || "outra unidade"} · {atendimento.encaminhamento_recebido.categoria_rotulo}
                  </strong>
                </div>
                <SecondaryButton
                  type="button"
                  size="sm"
                  className="shrink-0"
                  onClick={() => atendimento.encaminhamento_recebido && onVerFicha(atendimento.encaminhamento_recebido.id)}
                >
                  Ver ficha completa
                </SecondaryButton>
              </div>
            )}
          </div>
          {!iniciado ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Button type="button" onClick={onConferir}>
                Abrir conferência
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
              <SecondaryButton type="button" className={PERIGO} onClick={() => onModo("naoCompareceu")}>
                <UserX size={16} aria-hidden="true" />
                Não compareceu
              </SecondaryButton>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <SecondaryButton type="button" onClick={() => onModo("observacao")}>
                <ClipboardEdit size={15} aria-hidden="true" />
                Observação
              </SecondaryButton>
              <SecondaryButton type="button" onClick={() => onModo("encaminhar")}>
                <Send size={15} aria-hidden="true" />
                Encaminhar
              </SecondaryButton>
              <Button type="button" onClick={() => onModo("concluir")}>
                <CheckCircle2 size={15} aria-hidden="true" />
                Concluir
              </Button>
              <SecondaryButton type="button" className={PERIGO} onClick={() => onModo("naoCompareceu")}>
                <UserX size={15} aria-hidden="true" />
                Não veio
              </SecondaryButton>
            </div>
          )}
          <h3 className="!text-base">Histórico do cidadão</h3>
          {atendimento.historico.length === 0 ? (
            <EmptyState title="Sem histórico recente" text="Não há registros recentes para este cidadão." />
          ) : (
            atendimento.historico.map((entrada, index) => (
              <div className="line-row" key={`${entrada.quando}-${index}`}>
                <strong className="block">{entrada.o_que}</strong>
                <small className="mt-0.5 block">{entrada.unidade}{entrada.detalhe ? ` · ${entrada.detalhe}` : ""}</small>
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  );
}
