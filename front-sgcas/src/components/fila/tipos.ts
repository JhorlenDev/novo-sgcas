import type { Caso, Cidadao, EncaminhamentoDetalhe, EntradaHistorico, Senha } from "@/types/sgcas";

export const INDICADORES = {
  atendidos_hoje: { titulo: "Atendidos hoje", descricao: "Senhas finalizadas por você hoje nesta unidade." },
  aguardando_na_fila: { titulo: "Aguardando na fila", descricao: "Senhas aguardando nesta unidade, por prioridade e ordem de chegada." },
  finalizados_hoje: { titulo: "Finalizados", descricao: "Casos concluídos ou encaminhados por você hoje nesta unidade." },
  casos_em_acompanhamento: { titulo: "Acompanhamento", descricao: "Casos da unidade que não estão concluídos nem cancelados." },
};
export type Indicador = keyof typeof INDICADORES;

export type DetalhesIndicador = { tipo: "senhas"; registros: Senha[] } | { tipo: "casos"; registros: Caso[] };

export type SenhaAberta = Senha & { operador_nome: string | null; pode_retomar: boolean };

export type AtendimentoMontado = {
  senha: Senha;
  cidadao: Cidadao;
  caso: Caso | null;
  // Quando a pessoa chegou encaminhada de outra unidade: a ficha que veio com ela.
  encaminhamento_recebido: EncaminhamentoDetalhe | null;
  historico: EntradaHistorico[];
};

export type ModoDaJanela = "inicio" | "observacao" | "encaminhar" | "concluir" | "naoCompareceu";

// Ação que descarta algo (marcar não comparecimento): vermelho discreto, sem preencher o botão.
export const PERIGO = "!border-red-200 !text-red-700 hover:!bg-red-50";
