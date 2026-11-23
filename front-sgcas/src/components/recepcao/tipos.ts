import type { Caso, CidadaoLista, EncaminhamentoResumo, EntradaHistorico } from "@/types/sgcas";

export type HistoricoResponse = {
  cidadao: CidadaoLista;
  entradas: EntradaHistorico[];
};

export type ResultadoAtendimento = {
  desfecho: "ENCAMINHADO" | "FINALIZADO";
  caso: Caso | null;
  senha: { senha: string; servico?: string | null } | null;
  // Presente quando a visita cumpriu um encaminhamento de outra unidade.
  encaminhamento: EncaminhamentoResumo | null;
};

export type AcaoAtendimento = "FINALIZADO" | "ENCAMINHADO";
