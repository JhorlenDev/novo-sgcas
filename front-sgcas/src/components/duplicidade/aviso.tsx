"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Field } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { MINIMO_DA_JUSTIFICATIVA, formatarDataHora } from "@/lib/encaminhamentos";
import type { AlertaDeDuplicidade, RespostaDeDuplicidade } from "@/types/sgcas";

/**
 * O mesmo auxílio em unidades diferentes: o aviso mostra onde, quando e o quê, e
 * a justificativa escrita é a condição para seguir. Não bloqueia — quem atende
 * decide —, mas a decisão fica no histórico para as outras unidades lerem.
 */

/**
 * Pergunta à API, antes de enviar, se o que está sendo pedido repete algo do mês.
 * `consulta` é a query (`servico_id=…` ou `tipo=…`); `null` quando ainda não há o
 * que perguntar. O resultado só vale para a consulta que o originou: trocar de
 * serviço não deve mostrar, nem por um instante, o aviso do anterior.
 */
export function useDuplicidade(cidadaoId: string | null, consulta: string | null): AlertaDeDuplicidade[] {
  const [resposta, setResposta] = useState<{ chave: string; alertas: AlertaDeDuplicidade[] } | null>(null);
  const chave = cidadaoId && consulta ? `${cidadaoId}?${consulta}` : null;

  useEffect(() => {
    if (!cidadaoId || !consulta || !chave) return;
    let cancelado = false;
    const timer = window.setTimeout(() => {
      api<RespostaDeDuplicidade>(`/citizens/${cidadaoId}/duplicidade?${consulta}`)
        .then((r) => { if (!cancelado) setResposta({ chave, alertas: r.alertas }); })
        // Sem a prévia, o registro ainda cobra a justificativa (409) se for o caso.
        .catch(() => { if (!cancelado) setResposta({ chave, alertas: [] }); });
    }, 250);
    return () => { cancelado = true; window.clearTimeout(timer); };
  }, [cidadaoId, consulta, chave]);

  return chave && resposta?.chave === chave ? resposta.alertas : [];
}

/** Os avisos que a API devolve quando o registro exige a justificativa (409). */
export function alertasDoErro(error: unknown): AlertaDeDuplicidade[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const corpo = error.data as { exige_justificativa?: boolean; duplicidade?: AlertaDeDuplicidade[] } | null;
  return corpo?.exige_justificativa && Array.isArray(corpo.duplicidade) ? corpo.duplicidade : null;
}

export function justificativaValida(texto: string): boolean {
  return texto.trim().length >= MINIMO_DA_JUSTIFICATIVA;
}

export function AvisoDeDuplicidade({
  alertas,
  justificativa,
  onChange,
}: {
  alertas: AlertaDeDuplicidade[];
  justificativa: string;
  onChange: (texto: string) => void;
}) {
  if (alertas.length === 0) return null;
  const faltam = MINIMO_DA_JUSTIFICATIVA - justificativa.trim().length;

  return (
    <div role="alert" className="grid gap-3 rounded-feature border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <div className="flex items-center gap-2">
        <AlertTriangle size={18} aria-hidden="true" />
        <strong>Esta pessoa já recebeu ou pediu este auxílio neste mês</strong>
      </div>
      <ul className="grid gap-1 text-sm leading-6">
        {alertas.map((alerta, indice) => (
          <li key={`${alerta.quando}-${indice}`}>
            <strong>{alerta.unidade}</strong> · {alerta.o_que} · {formatarDataHora(alerta.quando)}
            {alerta.detalhe ? ` — ${alerta.detalhe}` : ""}
          </li>
        ))}
      </ul>
      <p className="text-sm leading-6">
        Para seguir, escreva por que repetir. A justificativa fica no histórico e as outras unidades são avisadas.
      </p>
      <Field label="Justificativa para repetir">
        <textarea
          className="input min-h-20"
          value={justificativa}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ex.: família numerosa, a cesta anterior acabou em uma semana."
          aria-describedby="ajuda-da-justificativa"
        />
      </Field>
      <small id="ajuda-da-justificativa" className="text-xs">
        {faltam > 0 ? `Escreva pelo menos mais ${faltam} caractere(s).` : "Justificativa suficiente para seguir."}
      </small>
    </div>
  );
}
