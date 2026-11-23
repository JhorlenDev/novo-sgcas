"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, Field, SecondaryButton, Select } from "@/components/ui";
import { AvisoDeDuplicidade } from "@/components/duplicidade/aviso";
import type { AcaoAtendimento, ResultadoAtendimento } from "@/components/recepcao/tipos";
import { formatarDataHora } from "@/lib/datas";
import type { AlertaDeDuplicidade, EncaminhamentoResumo, Servico } from "@/types/sgcas";

/** O registro do balcão: o serviço pedido e, conforme o desfecho, a senha ou o motivo da finalização. */
export function JanelaDeRegistro({
  aberta,
  onAbertaChange,
  acao,
  servicos,
  servicoId,
  onServico,
  prioridade,
  onPrioridade,
  vinculaveis,
  encaminhamentoDaVisita,
  onEncaminhamento,
  possivelDuplicidade,
  alertasDeDuplicidade,
  justificativa,
  onJustificativa,
  observacao,
  onObservacao,
  motivo,
  onMotivo,
  mensagem,
  registrando,
  podeRegistrar,
  onRegistrar,
}: {
  aberta: boolean;
  onAbertaChange: (aberta: boolean) => void;
  acao: AcaoAtendimento;
  servicos: Servico[];
  servicoId: string;
  onServico: (id: string) => void;
  prioridade: string;
  onPrioridade: (prioridade: string) => void;
  /** Encaminhamentos de outra unidade que esta visita pode cumprir. */
  vinculaveis: EncaminhamentoResumo[];
  encaminhamentoDaVisita: string;
  onEncaminhamento: (id: string) => void;
  /** Caso ou atendimento recente parecido, sem o aviso de repetição da API. */
  possivelDuplicidade: boolean;
  alertasDeDuplicidade: AlertaDeDuplicidade[];
  justificativa: string;
  onJustificativa: (texto: string) => void;
  observacao: string;
  onObservacao: (texto: string) => void;
  motivo: string;
  onMotivo: (texto: string) => void;
  mensagem: string;
  registrando: boolean;
  podeRegistrar: boolean;
  onRegistrar: () => void;
}) {
  return (
    <Dialog open={aberta} onOpenChange={onAbertaChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{acao === "ENCAMINHADO" ? "Iniciar atendimento" : "Finalizar na recepção"}</DialogTitle>
          <DialogDescription>
            {acao === "ENCAMINHADO"
              ? "Selecione o serviço e registre a solicitação. O sistema cria o caso e gera a senha."
              : "Use quando a orientação no balcão resolve a demanda ou já existe caso em acompanhamento."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="Serviço solicitado">
            <Select value={servicoId} onChange={(event) => onServico(event.target.value)} required>
              <option value="">Selecione o serviço</option>
              {servicos.map((servico) => (
                <option key={servico.id} value={servico.id}>
                  {servico.nome} — {servico.unidade_nome}
                </option>
              ))}
            </Select>
          </Field>

          {acao === "ENCAMINHADO" && (
            <Field label="Prioridade na fila">
              <Select value={prioridade} onChange={(event) => onPrioridade(event.target.value)} required>
                <option value="BAIXA">Baixa</option>
                <option value="NORMAL">Normal</option>
                <option value="ALTA">Alta</option>
                <option value="URGENTE">Urgente</option>
              </Select>
            </Field>
          )}

          {acao === "ENCAMINHADO" && vinculaveis.length > 0 && (
            <Field label="Esta pessoa chegou encaminhada de outra unidade?">
              <Select value={encaminhamentoDaVisita} onChange={(event) => onEncaminhamento(event.target.value)}>
                {vinculaveis.map((e) => (
                  <option key={e.id} value={e.id}>
                    Sim, de {e.unidade_origem_nome || "outra unidade"} · {e.categoria_rotulo} · urgência {e.urgencia_rotulo.toLowerCase()} ({formatarDataHora(e.criado_em)})
                  </option>
                ))}
                <option value="">Não, é um pedido novo</option>
              </Select>
            </Field>
          )}

          {possivelDuplicidade && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-amber-950 sm:p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} aria-hidden="true" className="shrink-0" />
                <strong>Possível duplicidade</strong>
              </div>
              <p className="mt-1.5 text-sm leading-6">
                Há caso ou atendimento recente. Se for a mesma demanda, finalize na recepção.
              </p>
            </div>
          )}

          {acao === "ENCAMINHADO" && (
            <AvisoDeDuplicidade alertas={alertasDeDuplicidade} justificativa={justificativa} onChange={onJustificativa} />
          )}

          <Field label={acao === "ENCAMINHADO" ? "Observação para o atendimento" : "Observação"}>
            <textarea
              className="input"
              value={observacao}
              onChange={(event) => onObservacao(event.target.value)}
              placeholder="Resumo do que o cidadão solicitou"
            />
          </Field>

          {acao === "FINALIZADO" && (
            <Field label="Motivo da finalização">
              <textarea
                className="input"
                value={motivo}
                onChange={(event) => onMotivo(event.target.value)}
                placeholder="Ex.: já existe caso aberto, orientação resolvida no balcão..."
              />
            </Field>
          )}

          {mensagem && <div className="notice" role="alert">{mensagem}</div>}
        </div>

        <DialogFooter>
          <SecondaryButton type="button" onClick={() => onAbertaChange(false)} disabled={registrando}>
            Cancelar
          </SecondaryButton>
          <Button type="button" disabled={!podeRegistrar} onClick={onRegistrar}>
            {acao === "ENCAMINHADO" ? (
              <>
                <Send size={16} aria-hidden="true" />
                {registrando ? "Gerando..." : "Criar caso e gerar senha"}
              </>
            ) : (
              <>
                <CheckCircle2 size={16} aria-hidden="true" />
                {registrando ? "Salvando..." : "Finalizar atendimento"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ao escolher a pessoa: lembrar de perguntar o que ela quer antes de decidir. */
export function JanelaDePergunta({ aberta, onAbertaChange }: { aberta: boolean; onAbertaChange: (aberta: boolean) => void }) {
  return (
    <Dialog open={aberta} onOpenChange={onAbertaChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pergunte o que o cidadão deseja</DialogTitle>
          <DialogDescription>
            Confira casos e atendimentos recentes. Se for uma nova demanda, inicie atendimento; se já existir acompanhamento, finalize na recepção.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onAbertaChange(false)}>Começar atendimento</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** O resultado do registro: a senha gerada ou a confirmação do balcão. */
export function JanelaDeResultado({
  aberta,
  onAbertaChange,
  resultado,
}: {
  aberta: boolean;
  onAbertaChange: (aberta: boolean) => void;
  resultado: ResultadoAtendimento | null;
}) {
  return (
    <Dialog open={aberta} onOpenChange={onAbertaChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{resultado?.desfecho === "ENCAMINHADO" ? "Caso enviado para a fila" : "Atendimento finalizado"}</DialogTitle>
          <DialogDescription>
            {resultado?.senha
              ? `Senha gerada: ${resultado.senha.senha}. O cidadão já aparece na fila da unidade.`
              : "O atendimento foi registrado no histórico do cidadão."}
            {resultado?.encaminhamento
              ? ` A chegada cumpriu o encaminhamento de ${resultado.encaminhamento.unidade_origem_nome ?? "outra unidade"}, que foi avisada.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {resultado?.senha && (
            <Link href="/fila" className="button secondary">
              Ver fila
            </Link>
          )}
          <Button onClick={() => onAbertaChange(false)}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
