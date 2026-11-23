"use client";

import type { FormEvent } from "react";
import { UserX } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge, Button, EmptyState, Field, SecondaryButton, SectionHeading } from "@/components/ui";
import { CabecalhoDoEncaminhamento, FichaCompleta } from "@/components/encaminhamentos/ficha";
import {
  CamposDeEncaminhamento,
  type ErrosDoEncaminhamento,
  type FormularioDeEncaminhamento,
} from "@/components/encaminhamentos/formulario";
import { RegistroGuiado, type RegistroDoAtendimento } from "@/components/fila/registro-guiado";
import { PERIGO, type AtendimentoMontado, type ModoDaJanela } from "@/components/fila/tipos";
import { rotuloPrioridade, tomDaPrioridade } from "@/lib/casos";
import { formatarDataCurta } from "@/lib/datas";
import type { EntradaHistorico, Unidade } from "@/types/sgcas";

const TITULOS: Record<ModoDaJanela, (senha: string) => string> = {
  inicio: (senha) => `Conferir senha ${senha}`,
  observacao: () => "Registrar observação",
  encaminhar: () => "Encaminhar atendimento",
  concluir: () => "Concluir atendimento",
  naoCompareceu: () => "Não compareceu",
};

const DESCRICOES: Record<ModoDaJanela, string> = {
  inicio: "Confira cidadão, serviço e histórico antes de assumir o atendimento.",
  observacao: "Adicione uma evolução sem encerrar o caso.",
  encaminhar: "Envie o caso para outra unidade da rede ou registre um destino externo.",
  concluir: "Finalize o atendimento e libere a senha da fila.",
  naoCompareceu: "Use quando a senha foi chamada e o cidadão não se apresentou.",
};

/** A janela do atendimento: conferir, registrar, encaminhar, concluir ou marcar o não comparecimento. */
export function JanelaDoAtendimento({
  aberta,
  onAbertaChange,
  atendimento,
  modo,
  onModo,
  mensagem,
  salvando,
  registro,
  onRegistro,
  relato,
  onRelato,
  encaminhamento,
  onEncaminhamento,
  errosDoEncaminhamento,
  unidades,
  motivoNaoCompareceu,
  onMotivoNaoCompareceu,
  onIniciar,
  onSalvarObservacao,
  onEncaminhar,
  onConcluir,
  onNaoCompareceu,
}: {
  aberta: boolean;
  onAbertaChange: (aberta: boolean) => void;
  atendimento: AtendimentoMontado | null;
  modo: ModoDaJanela;
  onModo: (modo: Exclude<ModoDaJanela, "inicio">) => void;
  mensagem: string;
  salvando: boolean;
  registro: RegistroDoAtendimento;
  onRegistro: (registro: RegistroDoAtendimento) => void;
  relato: string;
  onRelato: (relato: string) => void;
  encaminhamento: FormularioDeEncaminhamento;
  onEncaminhamento: (formulario: FormularioDeEncaminhamento) => void;
  errosDoEncaminhamento: ErrosDoEncaminhamento;
  unidades: Unidade[];
  motivoNaoCompareceu: string;
  onMotivoNaoCompareceu: (motivo: string) => void;
  onIniciar: () => void;
  onSalvarObservacao: (event: FormEvent<HTMLFormElement>) => void;
  onEncaminhar: (event: FormEvent<HTMLFormElement>) => void;
  onConcluir: (event: FormEvent<HTMLFormElement>) => void;
  onNaoCompareceu: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const fechar = () => onAbertaChange(false);

  return (
    <Dialog open={aberta} onOpenChange={onAbertaChange}>
      <DialogContent className="max-w-3xl">
        {atendimento && (
          <>
            <DialogHeader>
              <DialogTitle>{TITULOS[modo](atendimento.senha.senha)}</DialogTitle>
              <DialogDescription>{DESCRICOES[modo]}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="rounded-lg border border-meta-divider bg-meta-warm-gray p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="mb-2 flex flex-wrap gap-2">
                      <Badge tone="info">Senha {atendimento.senha.senha}</Badge>
                      <Badge tone={tomDaPrioridade(atendimento.senha.prioridade)}>{rotuloPrioridade(atendimento.senha.prioridade)}</Badge>
                    </div>
                    <h3 className="text-lg font-semibold text-meta-charcoal">{atendimento.cidadao.nome}</h3>
                    <p className="mt-0.5 text-sm text-meta-slate">{atendimento.senha.servico || "Serviço não informado"}</p>
                  </div>
                  {atendimento.caso && (
                    <div className="text-sm md:text-right">
                      <p className="text-[13px] font-semibold text-meta-slate">Caso</p>
                      <strong className="text-meta-charcoal">{atendimento.caso.protocolo}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Com a janela aberta, a mensagem é o erro da ação feita nela (o sucesso fecha a
                  janela). Fora dela, ficaria atrás do fundo escurecido, sem ninguém ver. */}
              {mensagem && <div className="notice" role="alert">{mensagem}</div>}

              {modo === "inicio" && (
                <div className="grid gap-4">
                  <RegistroGuiado valor={registro} onChange={onRegistro} compacto />

                  {atendimento.encaminhamento_recebido && (
                    <details open className="rounded-lg border border-primary/30 bg-accent p-3.5 sm:p-4">
                      <summary className="cursor-pointer text-sm font-semibold text-meta-charcoal">
                        Encaminhado de {atendimento.encaminhamento_recebido.unidade_origem_nome || "outra unidade"}: a ficha que veio com a pessoa
                      </summary>
                      <div className="mt-3 grid gap-3">
                        <CabecalhoDoEncaminhamento encaminhamento={atendimento.encaminhamento_recebido} />
                        <FichaCompleta
                          encaminhamento={atendimento.encaminhamento_recebido}
                          ficha={atendimento.encaminhamento_recebido.ficha}
                        />
                      </div>
                    </details>
                  )}

                  <ResumoHistorico historico={atendimento.historico} />

                  <DialogFooter>
                    <SecondaryButton type="button" onClick={fechar} disabled={salvando}>
                      Conferir depois
                    </SecondaryButton>
                    <SecondaryButton type="button" className={PERIGO} onClick={() => onModo("naoCompareceu")} disabled={salvando}>
                      <UserX size={16} aria-hidden="true" />
                      Não compareceu
                    </SecondaryButton>
                    <Button type="button" onClick={onIniciar} disabled={salvando}>
                      {salvando ? "Iniciando..." : "Iniciar atendimento"}
                    </Button>
                  </DialogFooter>
                </div>
              )}

              {modo === "observacao" && (
                <form className="grid gap-4" onSubmit={onSalvarObservacao}>
                  <RegistroGuiado valor={registro} onChange={onRegistro} />
                  <DialogFooter>
                    <SecondaryButton type="button" onClick={fechar} disabled={salvando}>
                      Cancelar
                    </SecondaryButton>
                    <Button disabled={salvando}>{salvando ? "Salvando..." : "Salvar observação"}</Button>
                  </DialogFooter>
                </form>
              )}

              {modo === "encaminhar" && (
                <form className="grid gap-4" onSubmit={onEncaminhar} noValidate>
                  <CamposDeEncaminhamento
                    valor={encaminhamento}
                    onChange={onEncaminhamento}
                    unidades={unidades}
                    erros={errosDoEncaminhamento}
                  />
                  <DialogFooter>
                    <SecondaryButton type="button" onClick={fechar} disabled={salvando}>
                      Cancelar
                    </SecondaryButton>
                    <Button disabled={salvando}>{salvando ? "Encaminhando..." : "Encaminhar atendimento"}</Button>
                  </DialogFooter>
                </form>
              )}

              {modo === "concluir" && (
                <form className="grid gap-4" onSubmit={onConcluir}>
                  <Field label="Relato final">
                    <textarea
                      className="input"
                      value={relato}
                      onChange={(event) => onRelato(event.target.value)}
                      placeholder="Se quiser, escreva um resumo final. A situação, a providência e as observações já ficam registradas no caso."
                    />
                  </Field>
                  <DialogFooter>
                    <SecondaryButton type="button" onClick={fechar} disabled={salvando}>
                      Cancelar
                    </SecondaryButton>
                    <Button disabled={salvando}>{salvando ? "Concluindo..." : "Concluir atendimento"}</Button>
                  </DialogFooter>
                </form>
              )}

              {modo === "naoCompareceu" && (
                <form className="grid gap-4" onSubmit={onNaoCompareceu}>
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
                    <strong className="flex items-center gap-2 text-sm text-red-900">
                      <UserX size={16} aria-hidden="true" className="shrink-0" />
                      Confirmar não comparecimento?
                    </strong>
                    <p className="mt-1 text-sm leading-6 text-red-800">
                      A senha será marcada como desistência e o caso será encerrado como cancelado.
                    </p>
                  </div>
                  <Field label="Motivo, opcional">
                    <textarea
                      className="input"
                      value={motivoNaoCompareceu}
                      onChange={(event) => onMotivoNaoCompareceu(event.target.value)}
                      placeholder="Ex.: chamado três vezes, cidadão saiu da unidade, não respondeu..."
                    />
                  </Field>
                  <DialogFooter>
                    <SecondaryButton type="button" onClick={fechar} disabled={salvando}>
                      Cancelar
                    </SecondaryButton>
                    <button className="button danger" disabled={salvando}>
                      {salvando ? "Marcando..." : "Confirmar não compareceu"}
                    </button>
                  </DialogFooter>
                </form>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResumoHistorico({ historico }: { historico: EntradaHistorico[] }) {
  return (
    <div className="rounded-lg border border-meta-divider bg-white p-3.5 sm:p-4">
      <SectionHeading title="Histórico rápido" count={historico.length} />
      {historico.length === 0 ? (
        <EmptyState title="Sem histórico recente" text="Pode iniciar o atendimento normalmente." />
      ) : (
        <ul>
          {historico.slice(0, 4).map((entrada, index) => (
            <li className="line-row" key={`${entrada.quando}-${index}`}>
              <strong className="block">{entrada.o_que}</strong>
              <small className="mt-0.5 block">
                {formatarDataCurta(entrada.quando)} · {entrada.unidade}{entrada.detalhe ? ` · ${entrada.detalhe}` : ""}
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
