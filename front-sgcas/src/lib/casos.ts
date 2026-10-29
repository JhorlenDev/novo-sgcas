import type { Tom } from "@/lib/tom";

// Uma só tabela de rótulos e tons para a situação do caso: a mesma situação tem de
// aparecer igual no painel, na recepção, no atendimento e no prontuário.
const SITUACOES: Record<string, { rotulo: string; tom: Tom }> = {
  EM_TRIAGEM: { rotulo: "Em triagem", tom: "warn" },
  EM_ATENDIMENTO: { rotulo: "Em atendimento", tom: "info" },
  CONCLUIDO: { rotulo: "Concluído", tom: "good" },
  ENCAMINHADO: { rotulo: "Encaminhado", tom: "neutral" },
  CANCELADO: { rotulo: "Cancelado", tom: "neutral" },
};

export function rotuloSituacao(situacao: string): string {
  return SITUACOES[situacao]?.rotulo ?? situacao;
}

export function tomDoCaso(situacao: string): Tom {
  return SITUACOES[situacao]?.tom ?? "neutral";
}

const PRIORIDADES: Record<string, string> = { BAIXA: "Baixa", NORMAL: "Normal", ALTA: "Alta", URGENTE: "Urgente" };

export function rotuloPrioridade(prioridade: string): string {
  return PRIORIDADES[prioridade] ?? prioridade;
}

/** Só o que pede pressa ganha cor: prioridade normal ou baixa não precisa chamar a atenção. */
export function tomDaPrioridade(prioridade: string): Tom {
  if (prioridade === "URGENTE") return "bad";
  if (prioridade === "ALTA") return "warn";
  return "neutral";
}

const SITUACOES_DA_SENHA: Record<string, string> = {
  AGUARDANDO: "Aguardando",
  CHAMADO: "Chamado",
  EM_ATENDIMENTO: "Em atendimento",
  ATENDIDO: "Atendido",
  DESISTIU: "Não compareceu",
};

export function rotuloSituacaoDaSenha(situacao: string): string {
  return SITUACOES_DA_SENHA[situacao] ?? situacao;
}
