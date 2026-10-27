import type { CategoriaDoMotivo, SituacaoDoEncaminhamento, TipoDeAviso, Urgencia } from "@/types/sgcas";

export type Tom = "neutral" | "good" | "warn" | "bad";

// A mesma lista que a API valida (Encaminhamento.Categoria): uma palavra que diz
// por que a pessoa segue para outro lugar. É o que a recepção do destino lê.
export const CATEGORIAS: ReadonlyArray<{ valor: CategoriaDoMotivo; rotulo: string }> = [
  { valor: "VIOLACAO_DE_DIREITOS", rotulo: "Violação de direitos" },
  { valor: "SITUACAO_DE_RUA", rotulo: "Situação de rua" },
  { valor: "ACOMPANHAMENTO_FAMILIAR", rotulo: "Acompanhamento familiar" },
  { valor: "BENEFICIO_EVENTUAL", rotulo: "Benefício eventual" },
  { valor: "SAUDE", rotulo: "Saúde" },
  { valor: "DOCUMENTACAO", rotulo: "Documentação" },
  { valor: "OUTRO", rotulo: "Outro" },
];

export const URGENCIAS: ReadonlyArray<{ valor: Urgencia; rotulo: string }> = [
  { valor: "BAIXA", rotulo: "Baixa" },
  { valor: "NORMAL", rotulo: "Normal" },
  { valor: "ALTA", rotulo: "Alta" },
  { valor: "URGENTE", rotulo: "Urgente" },
];

const SITUACOES: Record<SituacaoDoEncaminhamento, { rotulo: string; tom: Tom }> = {
  PENDENTE: { rotulo: "Aguardando resposta", tom: "warn" },
  ACEITO: { rotulo: "Aceito", tom: "good" },
  RECUSADO: { rotulo: "Recusado", tom: "bad" },
  CONCLUIDO: { rotulo: "Concluído", tom: "neutral" },
};

export function rotuloDaSituacao(situacao: string): string {
  return SITUACOES[situacao as SituacaoDoEncaminhamento]?.rotulo ?? situacao;
}

export function tomDaSituacao(situacao: string): Tom {
  return SITUACOES[situacao as SituacaoDoEncaminhamento]?.tom ?? "neutral";
}

export function tomDaUrgencia(urgencia: string): Tom {
  if (urgencia === "URGENTE") return "bad";
  if (urgencia === "ALTA") return "warn";
  return "neutral";
}

// Avisos que pedem uma providência de quem lê, em destaque na lista.
const AVISOS_QUE_PEDEM_ATENCAO: ReadonlySet<TipoDeAviso> = new Set([
  "ENCAMINHAMENTO_RECEBIDO",
  "ENCAMINHAMENTO_RECUSADO",
  "NAO_COMPARECEU",
  "BENEFICIO_REPETIDO",
]);

export function avisoPedeAtencao(tipo: TipoDeAviso): boolean {
  return AVISOS_QUE_PEDEM_ATENCAO.has(tipo);
}

export function formatarDataHora(valor: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(valor));
}

/**
 * Uma data sem hora (o prazo) chega como "2026-11-05". `new Date()` a leria como
 * meia-noite UTC e, no fuso do município, mostraria o dia anterior.
 */
export function formatarDiaDoPrazo(valor: string): string {
  const [ano, mes, dia] = valor.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export function hojeNoFormatoDoInput(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

// O mínimo que a API exige de uma justificativa de repetição (duplicidade.py).
export const MINIMO_DA_JUSTIFICATIVA = 10;

// Quem lê o relato e responde: a equipe de atendimento (EquipeDeAtendimento, na API).
// A recepção participa da comunicação entre unidades mas só vê o resumo; o
// visualizador não participa. A API é quem decide — aqui só se esconde o que não serviria.
const PAPEIS_DA_EQUIPE = new Set(["ADMIN", "COORDENADOR", "ASSISTENTE_SOCIAL", "TECNICO", "GESTOR_ACOES_ITINERANTES"]);

export function veORelato(papel?: string): boolean {
  return papel !== undefined && PAPEIS_DA_EQUIPE.has(papel);
}

export function participaDaComunicacao(papel?: string): boolean {
  return veORelato(papel) || papel === "RECEPCIONISTA";
}
