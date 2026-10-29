"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, ExternalLink, ShieldAlert, XCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button, EmptyState, Field, SecondaryButton } from "@/components/ui";
import {
  CabecalhoDoEncaminhamento, FichaCompleta, destinoDoEncaminhamento, temFicha, useEncaminhamento,
} from "@/components/encaminhamentos/ficha";
import { api, mensagemDaApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { veORelato } from "@/lib/encaminhamentos";

type Acao = "aceitar" | "recusar" | "retorno";

/**
 * O encaminhamento aberto: a ficha para os técnicos, o resumo para a recepção, e
 * as respostas que cabem a cada lado — o destino aceita ou recusa; a origem
 * registra o retorno de um serviço externo.
 *
 * A tela só oferece o que o papel e a unidade permitem; quem decide é a API.
 */
export function DetalheDoEncaminhamento({
  id,
  onClose,
  onMudou,
}: {
  id: string | null;
  onClose: () => void;
  onMudou: () => void;
}) {
  const { user } = useAuth();
  const [versao, setVersao] = useState(0);
  const { dados, erro } = useEncaminhamento(id, versao);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroDaAcao, setErroDaAcao] = useState("");

  function fechar() {
    setAcao(null);
    setTexto("");
    setErroDaAcao("");
    onClose();
  }

  function escolher(proxima: Acao | null) {
    setAcao(proxima);
    setTexto("");
    setErroDaAcao("");
  }

  const tecnico = veORelato(user?.papel);
  const admin = user?.papel === "ADMIN";
  const unidadeId = user?.unidade?.id;
  const completo = dados && temFicha(dados) ? dados : null;

  const souDestino = Boolean(completo && (admin || (unidadeId && completo.unidade_destino === unidadeId)));
  const souOrigem = Boolean(completo && (admin || (unidadeId && completo.unidade_origem === unidadeId)));
  const aberto = completo?.situacao === "PENDENTE" || completo?.situacao === "ACEITO";
  const externo = Boolean(completo && !completo.unidade_destino);

  const podeAceitarOuRecusar = tecnico && souDestino && completo?.situacao === "PENDENTE" && !externo;
  const podeRegistrarRetorno = tecnico && souOrigem && aberto && externo;

  async function enviar() {
    if (!completo || !acao) return;
    const conteudo = texto.trim();
    if (acao !== "aceitar" && !conteudo) {
      setErroDaAcao(acao === "recusar" ? "Informe o motivo da recusa." : "Informe o retorno do serviço.");
      return;
    }
    const corpo =
      acao === "aceitar" ? { observacao: conteudo || null }
        : acao === "recusar" ? { motivo: conteudo }
          : { resultado: conteudo };
    const rota = acao === "retorno" ? "concluir" : acao;

    setEnviando(true);
    setErroDaAcao("");
    try {
      await api(`/referrals/${completo.id}/${rota}`, { method: "POST", body: JSON.stringify(corpo) });
      escolher(null);
      setVersao((atual) => atual + 1);
      onMudou();
    } catch (error) {
      setErroDaAcao(mensagemDaApi(error, "Não foi possível registrar a resposta."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={id !== null} onOpenChange={(aberto) => { if (!aberto) fechar(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{dados ? dados.cidadao_nome : "Encaminhamento"}</DialogTitle>
          <DialogDescription>
            {dados ? `Para ${destinoDoEncaminhamento(dados)}` : "Carregando a ficha do encaminhamento."}
          </DialogDescription>
        </DialogHeader>

        {erro ? (
          <EmptyState title="Não foi possível abrir" text={erro} />
        ) : !dados ? (
          <p className="text-sm text-meta-slate">Carregando...</p>
        ) : (
          <div className="grid gap-4">
            <CabecalhoDoEncaminhamento encaminhamento={dados} />

            {completo ? (
              <FichaCompleta encaminhamento={completo} ficha={completo.ficha} />
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-meta-divider bg-meta-warm-gray p-3 text-sm leading-6 text-meta-slate">
                <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  A recepção vê de onde a pessoa veio, quando e a categoria do motivo. O relato e a ficha são lidos
                  só pela equipe técnica. Quando a pessoa chegar, registre a chegada na Recepção.
                </span>
              </div>
            )}

            {completo && podeAceitarOuRecusar && acao === null && (
              <p className="text-sm text-meta-slate">
                Ao aceitar ou recusar, {completo.unidade_origem_nome || "a unidade de origem"} é avisada. Recusar devolve o
                caso à origem.
              </p>
            )}

            {completo && !externo && souDestino && completo.situacao === "ACEITO" && (
              <p className="text-sm text-meta-slate">
                Aceito. O encaminhamento é concluído quando você concluir o caso em{" "}
                <Link className="font-semibold text-primary underline-offset-4 hover:underline" href="/casos">Acompanhamentos</Link>.
              </p>
            )}

            {acao && (
              <div className="grid gap-3 rounded-lg border border-meta-divider bg-meta-warm-gray p-3 sm:p-4">
                <Field
                  label={
                    acao === "aceitar" ? "Observação, opcional"
                      : acao === "recusar" ? "Motivo da recusa"
                        : "Retorno do serviço externo"
                  }
                >
                  <textarea
                    className="input min-h-24"
                    value={texto}
                    onChange={(event) => setTexto(event.target.value)}
                    placeholder={
                      acao === "aceitar" ? "Ex.: vamos agendar para terça-feira."
                        : acao === "recusar" ? "Explique por que este encaminhamento não cabe aqui."
                          : "O que o serviço externo informou ou fez."
                    }
                  />
                </Field>
                {erroDaAcao && <p role="alert" className="field-error">{erroDaAcao}</p>}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <SecondaryButton type="button" onClick={() => escolher(null)} disabled={enviando}>Voltar</SecondaryButton>
                  <Button type="button" onClick={() => void enviar()} disabled={enviando}>
                    {enviando ? "Enviando..." : acao === "aceitar" ? "Aceitar encaminhamento" : acao === "recusar" ? "Recusar encaminhamento" : "Registrar retorno"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {dados && tecnico && (
            <Link href={`/cidadaos/${dados.cidadao}`} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline sm:mr-auto">
              <ExternalLink size={14} aria-hidden="true" /> Abrir prontuário
            </Link>
          )}
          {!acao && podeAceitarOuRecusar && (
            <>
              <SecondaryButton type="button" onClick={() => escolher("recusar")}>
                <XCircle size={16} aria-hidden="true" /> Recusar
              </SecondaryButton>
              <Button type="button" onClick={() => escolher("aceitar")}>
                <CheckCircle2 size={16} aria-hidden="true" /> Aceitar
              </Button>
            </>
          )}
          {!acao && podeRegistrarRetorno && (
            <Button type="button" onClick={() => escolher("retorno")}>Registrar retorno</Button>
          )}
          <SecondaryButton type="button" onClick={fechar}>Fechar</SecondaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
