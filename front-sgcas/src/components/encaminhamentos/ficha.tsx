"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, CalendarClock, Phone } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import { api, mensagemDaApi } from "@/lib/api";
import {
  formatarDataHora, formatarDiaDoPrazo, rotuloDaSituacao, tomDaSituacao, tomDaUrgencia,
} from "@/lib/encaminhamentos";
import type {
  Encaminhamento, EncaminhamentoDetalhe, EncaminhamentoResumo, FichaDoEncaminhamento,
} from "@/types/sgcas";

export function destinoDoEncaminhamento(e: EncaminhamentoResumo): string {
  return e.unidade_destino_nome || e.destino_externo || "Destino externo";
}

/**
 * Quem, de onde, para onde, quando e por que tipo de motivo — o que a recepção
 * pode ver. Os técnicos veem isso e, abaixo, a ficha.
 */
export function CabecalhoDoEncaminhamento({ encaminhamento: e }: { encaminhamento: EncaminhamentoResumo }) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tomDaSituacao(e.situacao)}>{rotuloDaSituacao(e.situacao)}</Badge>
        <Badge tone={tomDaUrgencia(e.urgencia)}>Urgência {e.urgencia_rotulo.toLowerCase()}</Badge>
        <Badge tone="neutral">{e.categoria_rotulo}</Badge>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-meta-charcoal">
        <span>{e.unidade_origem_nome || "Unidade de origem"}</span>
        <ArrowRight size={14} aria-hidden="true" className="text-meta-slate" />
        <span>{destinoDoEncaminhamento(e)}</span>
      </p>
      <p className="text-xs text-meta-slate">
        Encaminhado em {formatarDataHora(e.criado_em)}
        {e.chegou_em ? ` · chegou em ${formatarDataHora(e.chegou_em)}` : ""}
      </p>
      {e.prazo && (
        <p className="flex items-center gap-1.5 text-xs text-meta-slate">
          <CalendarClock size={14} aria-hidden="true" />
          Prazo: {formatarDiaDoPrazo(e.prazo)}
        </p>
      )}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-meta-divider bg-white p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-meta-slate">{titulo}</h4>
      <div className="text-sm leading-6 text-meta-charcoal">{children}</div>
    </section>
  );
}

function Texto({ valor }: { valor?: string | null }) {
  return valor ? <p className="whitespace-pre-line">{valor}</p> : <p className="text-meta-slate">Não informado.</p>;
}

/** O que a unidade de origem sabia no momento de encaminhar. */
function FotografiaDaOrigem({ ficha }: { ficha: FichaDoEncaminhamento }) {
  return (
    <Secao titulo={`O que ${ficha.unidade_origem} sabia (protocolo ${ficha.protocolo})`}>
      <div className="grid gap-4">
        <div>
          <strong>Serviço</strong>
          <p>
            {ficha.servico ? `${ficha.servico.nome}${ficha.servico.categoria ? ` · ${ficha.servico.categoria}` : ""}` : "Sem serviço vinculado."}
          </p>
        </div>
        <div>
          <strong>O que a pessoa solicitou</strong>
          {ficha.solicitado.length === 0 ? (
            <p className="text-meta-slate">Nenhum pedido registrado na recepção.</p>
          ) : (
            <ul className="mt-1 grid gap-1">
              {ficha.solicitado.map((pedido, indice) => (
                <li key={`${pedido.quando}-${indice}`}>
                  {pedido.demanda} · {pedido.unidade} · {formatarDataHora(pedido.quando)}
                  {pedido.observacao ? ` — ${pedido.observacao}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <strong>O que já recebeu desta unidade</strong>
          {ficha.beneficios_concedidos.length === 0 ? (
            <p className="text-meta-slate">Nenhum benefício concedido.</p>
          ) : (
            <ul className="mt-1 grid gap-1">
              {ficha.beneficios_concedidos.map((beneficio, indice) => (
                <li key={`${beneficio.quando}-${indice}`}>
                  {beneficio.tipo} · {formatarDataHora(beneficio.quando)}
                  {beneficio.descricao ? ` — ${beneficio.descricao}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <strong>Relato do atendimento até aqui</strong>
          <Texto valor={ficha.relato} />
        </div>
      </div>
    </Secao>
  );
}

/** A ficha inteira. Só os técnicos recebem estes campos da API. */
export function FichaCompleta({ encaminhamento: e, ficha }: { encaminhamento: Encaminhamento; ficha: FichaDoEncaminhamento | null }) {
  return (
    <div className="grid gap-3">
      <Secao titulo="Motivo"><Texto valor={e.motivo} /></Secao>
      <Secao titulo="Resumo da situação"><Texto valor={e.resumo_da_situacao} /></Secao>
      {(e.documentos_entregues || e.observacoes) && (
        <div className="grid gap-3 md:grid-cols-2">
          {e.documentos_entregues && <Secao titulo="Documentos entregues"><Texto valor={e.documentos_entregues} /></Secao>}
          {e.observacoes && <Secao titulo="Observações"><Texto valor={e.observacoes} /></Secao>}
        </div>
      )}
      {e.contato_para_retorno && (
        <p className="flex items-center gap-2 text-sm text-meta-charcoal">
          <Phone size={14} aria-hidden="true" />
          Contato para retorno: {e.contato_para_retorno}
        </p>
      )}
      {ficha && <FotografiaDaOrigem ficha={ficha} />}
      {(e.resposta || e.resultado) && (
        <Secao titulo="Resposta do destino">
          {e.resposta && <Texto valor={e.resposta} />}
          {e.resultado && <Texto valor={e.resultado} />}
          {e.respondido_por_nome && (
            <small className="text-meta-slate">
              {e.respondido_por_nome}{e.respondido_em ? ` · ${formatarDataHora(e.respondido_em)}` : ""}
            </small>
          )}
        </Secao>
      )}
    </div>
  );
}

/**
 * Busca o encaminhamento com a ficha. Para a recepção a API devolve só o resumo,
 * e é isso que se mostra: a tela não decide o que cada papel pode ler.
 */
export function useEncaminhamento(id: string | null, versao = 0) {
  const [dados, setDados] = useState<EncaminhamentoDetalhe | EncaminhamentoResumo | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!id) return;
    let cancelado = false;
    api<EncaminhamentoDetalhe | EncaminhamentoResumo>(`/referrals/${id}`)
      .then((resposta) => { if (!cancelado) { setDados(resposta); setErro(""); } })
      .catch((error) => { if (!cancelado) setErro(mensagemDaApi(error, "Não foi possível abrir o encaminhamento.")); });
    return () => { cancelado = true; };
  }, [id, versao]);

  return { dados: dados && dados.id === id ? dados : null, erro };
}

export function temFicha(dados: EncaminhamentoDetalhe | EncaminhamentoResumo): dados is EncaminhamentoDetalhe {
  return "motivo" in dados;
}

export function SemEncaminhamentos({ texto }: { texto: string }) {
  return <EmptyState title="Nada por aqui" text={texto} />;
}
