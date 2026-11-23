"use client";

import { useCallback, useState } from "react";
import { avisoDeCarga, lerOuPadrao } from "@/lib/api";

/**
 * Para telas com várias leituras independentes, refeitas em momentos diferentes (a
 * Recepção relê a fila e o painel depois de cada registro). Cada fonte lembra se a
 * última tentativa falhou: o aviso lista só as que ainda estão falhando, e some
 * sozinho quando a leitura volta a dar certo.
 */
export function useAvisoDeCarga() {
  const [falhando, setFalhando] = useState<string[]>([]);

  const ler = useCallback(async <T>(fonte: string, caminho: string, padrao: T): Promise<T> => {
    const falhas: string[] = [];
    const valor = await lerOuPadrao<T>(caminho, padrao, () => falhas.push(fonte));
    setFalhando((atual) => {
      const semEsta = atual.filter((item) => item !== fonte);
      return falhas.length > 0 ? [...semEsta, fonte] : semEsta;
    });
    return valor;
  }, []);

  const falhou = useCallback((fonte: string) => falhando.includes(fonte), [falhando]);

  return { aviso: avisoDeCarga(falhando), falhou, ler };
}
