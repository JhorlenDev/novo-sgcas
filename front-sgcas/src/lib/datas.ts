/** Formatadores de data e hora do sistema, todos no fuso do navegador e em português. */

export function formatarDataHora(valor: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(valor));
}

/** Dia e hora, sem o ano: para listas do dia a dia, onde o ano é óbvio. */
export function formatarDataCurta(valor: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(valor));
}

export function formatarData(valor: string): string {
  return new Intl.DateTimeFormat("pt-BR").format(new Date(valor));
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
