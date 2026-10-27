"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { participaDaComunicacao } from "@/lib/encaminhamentos";
import type { ResumoDosAvisos } from "@/types/sgcas";

const INTERVALO_DE_ATUALIZACAO = 60_000;
const EVENTO = "sgcas:avisos-mudaram";

/** Quem leu ou respondeu algo chama isto para o número do menu acompanhar. */
export function avisarQueOsAvisosMudaram() {
  window.dispatchEvent(new Event(EVENTO));
}

/**
 * Os números do menu: encaminhamentos aguardando resposta e avisos não lidos.
 *
 * Atualiza a cada minuto, ao voltar para a aba e quando algo muda na própria
 * tela. Não é tempo real — um aviso novo pode levar até um minuto para aparecer —,
 * e isso basta para o ritmo de uma unidade; empurrar do servidor exigiria uma
 * conexão aberta por usuário.
 */
export function useResumoDosAvisos(papel?: string) {
  const participa = participaDaComunicacao(papel);
  const [resumo, setResumo] = useState<ResumoDosAvisos | null>(null);

  const recarregar = useCallback(async () => {
    if (!participa) return;
    try {
      setResumo(await api<ResumoDosAvisos>("/notices/resumo", { skipAuthRedirect: true }));
    } catch {
      // O número do menu não vale um alerta: fica o último que se conhecia.
    }
  }, [participa]);

  useEffect(() => {
    if (!participa) return;
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void recarregar();
    };
    const primeiro = window.setTimeout(() => void recarregar(), 0);
    const repeticao = window.setInterval(aoVoltar, INTERVALO_DE_ATUALIZACAO);
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener(EVENTO, aoVoltar);
    return () => {
      window.clearTimeout(primeiro);
      window.clearInterval(repeticao);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener(EVENTO, aoVoltar);
    };
  }, [participa, recarregar]);

  return { resumo, recarregar };
}
