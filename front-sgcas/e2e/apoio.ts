import { test as base, expect, type Page, type Route } from "@playwright/test";
import type {
  Caso, CidadaoLista, EntradaHistorico, Operador, PainelAtendente, PainelRecepcao, Papel, Senha, Servico, Unidade,
} from "../src/types/sgcas";

/**
 * A API simulada dos testes de navegador.
 *
 * Cada teste diz o que cada rota responde (`api.em("GET /api/cases/", ...)`). A rota é o
 * método mais o caminho exato, com a barra final quando a tela a usa: a API Django distingue
 * `/services` de `/services/`. Uma chamada a rota que o teste não simula responde 404 e faz o
 * teste falhar no fim. Foi uma rota errada assim (`/acoes-itinerantes/`) que deixou o filtro
 * de Acompanhamentos vazio sem ninguém perceber.
 *
 * O teste também falha com erro de JavaScript na página ou erro no console, exceto o aviso do
 * navegador de recurso que respondeu com erro, que é o que os testes de falha provocam.
 */

export type Resposta = { status?: number; json?: unknown; corpo?: string; tipo?: string; atraso?: number };
export type Pedido = { metodo: string; url: URL; corpo: unknown };
export type Rota = Resposta | ((pedido: Pedido) => Resposta | Promise<Resposta>);

export const QUANDO = "2026-09-09T12:00:00Z";

export class SimuladorDeApi {
  private readonly rotas = new Map<string, Rota>();
  readonly chamadas: Pedido[] = [];
  readonly naoSimuladas: string[] = [];

  constructor() {
    this.usuario(operador());
    this.em("GET /api/notices/resumo", { json: { avisos_nao_lidos: 0, encaminhamentos_pendentes: 0 } });
  }

  /** Quem está logado; `null` responde 401, como a API sem sessão. */
  usuario(quem: Operador | null) {
    this.em("GET /api/auth/me", quem ? { json: quem } : { status: 401, json: { detail: "Não autenticado." } });
  }

  em(rota: string, resposta: Rota) {
    this.rotas.set(rota, resposta);
  }

  /** As chamadas feitas a uma rota (método e caminho, sem a query). */
  chamadasA(rota: string): Pedido[] {
    return this.chamadas.filter((pedido) => `${pedido.metodo} ${pedido.url.pathname}` === rota);
  }

  async responder(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const chave = `${request.method()} ${url.pathname}`;
    let corpo: unknown = null;
    try {
      corpo = request.postDataJSON();
    } catch {
      corpo = request.postData();
    }
    const pedido = { metodo: request.method(), url, corpo };
    this.chamadas.push(pedido);

    const rota = this.rotas.get(chave);
    if (!rota) {
      this.naoSimuladas.push(`${chave}${url.search}`);
      await route.fulfill({ status: 404, json: { detail: `Rota não simulada no teste: ${chave}` } });
      return;
    }
    const resposta = typeof rota === "function" ? await rota(pedido) : rota;
    if (resposta.atraso) await new Promise((fim) => setTimeout(fim, resposta.atraso));
    if (resposta.corpo !== undefined) {
      await route.fulfill({ status: resposta.status ?? 200, contentType: resposta.tipo ?? "text/html", body: resposta.corpo });
      return;
    }
    await route.fulfill({ status: resposta.status ?? 200, json: resposta.json ?? null });
  }
}

export const test = base.extend<{ api: SimuladorDeApi }>({
  // Automática: todo teste tem a API simulada, mesmo sem pedir `api`. Sem ela, uma chamada
  // escaparia para a API de verdade, se houver uma rodando na máquina.
  // O segundo parâmetro entrega a fixture ao teste (o `use` da documentação do Playwright).
  api: [async ({ page }, entregar) => {
    const api = new SimuladorDeApi();
    const erros: string[] = [];
    page.on("pageerror", (erro) => erros.push(`erro de JavaScript: ${erro.message}`));
    page.on("console", (mensagem) => {
      if (mensagem.type() !== "error") return;
      if (mensagem.text().startsWith("Failed to load resource")) return;
      erros.push(`console: ${mensagem.text()}`);
    });
    await page.route("**/api/**", (route) => api.responder(route));
    await entregar(api);
    expect(api.naoSimuladas, "a tela chamou rotas que o teste não simula; confira se a rota existe na API").toEqual([]);
    expect(erros, "erros na página").toEqual([]);
  }, { auto: true }],
});

/** Os avisos da tela (`.notice` com `role="alert"`). O Next tem outro `role="alert"`, vazio: o anunciador de rotas. */
export function avisos(page: Page) {
  return page.locator(".notice[role=alert]");
}

export { expect };

// ─── Dados fictícios ──────────────────────────────────────────────────────────

export const UNIDADE: Unidade = { id: "unidade-1", nome: "CRAS Centro", sigla: "CRAS-C", tipo: "CRAS", ativa: true };
export const OUTRA_UNIDADE: Unidade = { id: "unidade-2", nome: "CREAS", sigla: "CREAS-001", tipo: "CREAS", ativa: true };

export function operador(papel: Papel = "ADMIN", extra: Partial<Operador> = {}): Operador {
  return { id: "op-1", nome: "Operador de Teste", email: "operador@example.com", papel, ativo: true, unidade: UNIDADE, ...extra };
}

export function cidadao(extra: Partial<CidadaoLista> = {}): CidadaoLista {
  return { id: "c1", nome: "Pessoa de Teste", cpf: "90000000101", bairro: "Centro", cidade: "Tefé", ...extra };
}

export function senha(extra: Partial<Senha> = {}): Senha {
  return {
    id: "s1", senha: "A001", situacao: "AGUARDANDO", prioridade: "NORMAL", servico: "Orientação",
    cidadao: "c1", cidadao_nome: "Pessoa de teste", criado_em: QUANDO, ...extra,
  };
}

export function caso(extra: Partial<Caso> = {}): Caso {
  return {
    id: "caso-1", protocolo: "CASO-001", situacao: "EM_TRIAGEM", prioridade: "NORMAL", descricao: "Relato de teste",
    cidadao: "c1", cidadao_nome: "Pessoa de teste", unidade_nome: UNIDADE.nome, aberto_em: QUANDO, ...extra,
  };
}

export function servico(extra: Partial<Servico> = {}): Servico {
  return {
    id: "serv-1", nome: "Cesta básica", unidade: UNIDADE.id, unidade_nome: UNIDADE.nome,
    demanda_nome: "Benefício Eventual", ativo: true, ...extra,
  };
}

export function entrada(extra: Partial<EntradaHistorico> = {}): EntradaHistorico {
  return {
    quando: QUANDO, unidade: UNIDADE.nome, o_que: "Benefício concedido: Cesta básica", detalhe: "Entregue no balcão",
    quem_atendeu: null, no_mes_corrente: true, e_de_outra_unidade: false, ...extra,
  };
}

export function painelDoAtendente(extra: Partial<PainelAtendente> = {}): PainelAtendente {
  return {
    atendidos_hoje: 0, aguardando_na_fila: 1, em_atendimento: 0, finalizados_hoje: 0,
    casos_em_acompanhamento: 0, ultimos_atendimentos: [], ...extra,
  };
}

export function painelDaRecepcao(extra: Partial<PainelRecepcao> = {}): PainelRecepcao {
  return {
    atendimentos_hoje: 0, finalizados_no_balcao: 0, encaminhados_para_fila: 0, aguardando_na_fila: 0,
    em_atendimento: 0, ultimos_atendimentos: [], ...extra,
  };
}
