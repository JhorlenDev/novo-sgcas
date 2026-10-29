import type { Papel } from "@/types/sgcas";

/** Como cada papel aparece para quem usa o sistema (o código do papel não é texto de tela). */
export const ROTULO_DO_PAPEL: Record<Papel, string> = {
  ADMIN: "Administrador",
  COORDENADOR: "Coordenador",
  ASSISTENTE_SOCIAL: "Assistente social",
  TECNICO: "Técnico",
  RECEPCIONISTA: "Recepcionista",
  GESTOR_ACOES_ITINERANTES: "Gestor de ações itinerantes",
  VISUALIZADOR: "Visualizador",
};

export function rotuloDoPapel(papel: string): string {
  return ROTULO_DO_PAPEL[papel as Papel] ?? papel;
}
