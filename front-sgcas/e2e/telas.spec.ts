import {
  avisos, caso, cidadao, entrada, expect, operador, OUTRA_UNIDADE, painelDaRecepcao, senha, servico, test, UNIDADE,
  type SimuladorDeApi,
} from "./apoio";

/**
 * Cada tela abre, com dados, sem erro na página e sem chamar rota que a API não tem.
 * E, para os defeitos já corrigidos, o comportamento que não pode voltar.
 */

const ACAO = {
  id: "acao-1", titulo: "Ação no Abial", descricao: null, local: "Escola do bairro", data: "2026-10-10",
  observacoes: null, unidade: UNIDADE.id, unidade_nome: UNIDADE.nome, responsavel: "op-1",
  responsavel_nome: "Operador de Teste", ativa: true, participantes: 3, cidadaos_atendidos: 2,
  beneficios_concedidos: 1, casos_abertos: 1, concluida: false,
};

const PRONTUARIO = {
  cidadao: { ...cidadao(), email: "pessoa@example.com", telefone: "(97) 98100-0000" },
  historico: [entrada()], casos: [caso()], atendimentos_recepcao: [], beneficios_eventuais: [], encaminhamentos: [],
  senhas: [], anexos: [], tipos_de_anexo: [], membros_da_familia: [], socioeconomico: {}, documentos: {}, endereco_detalhado: {},
};

const TELAS: Array<{ caminho: string; titulo: string; simular: (api: SimuladorDeApi) => void }> = [
  {
    caminho: "/dashboard/", titulo: "Painel",
    simular: (api) => {
      api.em("GET /api/queues/", { json: [senha()] });
      api.em("GET /api/cases/", { json: [caso()] });
    },
  },
  {
    caminho: "/cidadaos/", titulo: "Cidadãos",
    simular: (api) => api.em("GET /api/citizens/", { json: [cidadao()] }),
  },
  { caminho: "/cidadaos/novo/", titulo: "Novo cidadão", simular: () => {} },
  {
    caminho: "/cidadaos/c1/", titulo: "Pessoa de Teste",
    simular: (api) => {
      api.em("GET /api/citizens/c1/prontuario", { json: PRONTUARIO });
      api.em("GET /api/institutional/units", { json: [UNIDADE, OUTRA_UNIDADE] });
    },
  },
  {
    caminho: "/recepcao/", titulo: "Recepção",
    simular: (api) => {
      api.em("GET /api/institutional/services", { json: [servico()] });
      api.em("GET /api/reception/atendimentos", { json: [] });
      api.em("GET /api/reception/painel", { json: painelDaRecepcao() });
      api.em("GET /api/queues/", { json: [senha()] });
    },
  },
  {
    caminho: "/casos/", titulo: "Acompanhamentos",
    simular: (api) => {
      api.em("GET /api/cases/", { json: [caso()] });
      api.em("GET /api/itinerant-actions/", { json: [ACAO] });
    },
  },
  {
    caminho: "/encaminhamentos/", titulo: "Encaminhamentos",
    simular: (api) => {
      api.em("GET /api/referrals/recebidos", { json: [] });
      api.em("GET /api/referrals/enviados", { json: [] });
      api.em("GET /api/notices/", { json: [] });
    },
  },
  {
    caminho: "/acoes-itinerantes/", titulo: "Ações itinerantes",
    simular: (api) => {
      api.em("GET /api/itinerant-actions/", { json: [ACAO] });
      api.em("GET /api/itinerant-actions/resumo", {
        json: { total_cidadaos: 2, total_casos: 1, total_beneficios: 1, total_acoes: 1, total_concluidas: 0 },
      });
    },
  },
  {
    caminho: "/institucional/", titulo: "Institucional",
    simular: (api) => {
      api.em("GET /api/institutional/units", { json: [UNIDADE, OUTRA_UNIDADE] });
      api.em("GET /api/institutional/services", { json: [servico()] });
      api.em("GET /api/institutional/coordinations", { json: [] });
      api.em("GET /api/institutional/demands", { json: [] });
    },
  },
  {
    caminho: "/admin/", titulo: "Usuários",
    simular: (api) => {
      api.em("GET /api/users/", { json: [operador()] });
      api.em("GET /api/access-requests/", { json: [] });
      api.em("GET /api/institutional/units", { json: [UNIDADE] });
    },
  },
];

test.describe("cada tela abre sem erro", () => {
  for (const tela of TELAS) {
    test(tela.caminho, async ({ page, api }) => {
      tela.simular(api);
      await page.goto(tela.caminho);
      await expect(page.getByRole("heading", { level: 1, name: tela.titulo })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(page.locator(".notice[role=alert]")).toHaveCount(0);
    });
  }
});

test.describe("sessão", () => {
  test("sem sessão, a tela interna leva ao login", async ({ page, api }) => {
    api.usuario(null);
    // Sem sessão a API responde 401 a tudo; o Painel ainda pede a fila e os casos antes de sair.
    api.em("GET /api/queues/", { status: 401, json: { detail: "Não autenticado." } });
    api.em("GET /api/cases/", { status: 401, json: { detail: "Não autenticado." } });
    await page.goto("/dashboard/");
    await expect(page).toHaveURL(/\/login\/?$/);
    await expect(page.getByRole("button", { name: /Entrar com Tefé Cidadão/ })).toBeVisible();
  });

  test("cada perfil cai na sua tela inicial", async ({ page, api }) => {
    api.usuario(operador("RECEPCIONISTA"));
    api.em("GET /api/institutional/services", { json: [] });
    api.em("GET /api/reception/atendimentos", { json: [] });
    api.em("GET /api/reception/painel", { json: painelDaRecepcao() });
    api.em("GET /api/queues/", { json: [] });
    await page.goto("/");
    await expect(page).toHaveURL(/\/recepcao\/?$/);
  });

  test("o login mostra a causa da falha e só o detalhe no formato da API", async ({ page, api }) => {
    api.usuario(null);
    await page.goto("/login/?erro=sso-segredo&ref=status-401");
    const caixa = page.getByRole("alert").filter({ hasText: "Código:" });
    await expect(caixa).toContainText("Servidor com o segredo do Tefé Cidadão errado");
    await expect(caixa).toContainText("Código: sso-segredo · status-401");

    await page.goto("/login/?erro=sso-segredo&ref=<script>texto livre</script>");
    const outra = page.getByRole("alert").filter({ hasText: "Código:" });
    await expect(outra).toContainText("Código: sso-segredo");
    await expect(outra).not.toContainText("texto livre");
  });
});

test.describe("termo de consentimento (LGPD)", () => {
  test("mostra o controlador e nenhum campo em branco", async ({ page, api }) => {
    api.usuario(operador("RECEPCIONISTA"));
    await page.goto("/cidadaos/novo/");
    await page.getByText("Ler o termo completo").click();
    const termo = page.locator("section", { hasText: "1. Controlador dos Dados" });
    await expect(termo).toContainText("CNPJ sob o nº 04.426.383/0001-15");
    await expect(termo).toContainText("Rua Olavo Bilac, 500, Tefé – AM, CEP 69470-000");
    const texto = await page.locator("body").innerText();
    expect(texto).not.toMatch(/\[[A-ZÀ-Ú .\/X-]{4,}\]/);
  });
});

test.describe("falha de carga aparece como aviso, e 403 não", () => {
  test("Acompanhamentos: o filtro de ações usa a rota da API e lista as ações", async ({ page, api }) => {
    api.em("GET /api/cases/", { json: [caso({ acao_itinerante: ACAO.id, acao_itinerante_titulo: ACAO.titulo })] });
    api.em("GET /api/itinerant-actions/", { json: [{ id: ACAO.id, titulo: ACAO.titulo, local: ACAO.local, data: ACAO.data }] });
    await page.goto("/casos/");
    await page.getByLabel("Origem").selectOption("itinerante");
    await expect(page.getByLabel("Ação itinerante").locator("option", { hasText: ACAO.titulo })).toHaveCount(1);
    const [lista] = api.chamadasA("GET /api/itinerant-actions/");
    expect(lista.url.searchParams.get("compacto")).toBe("1");
  });

  test("Acompanhamentos: a recepção não vê as ações (403) e não recebe aviso", async ({ page, api }) => {
    api.usuario(operador("RECEPCIONISTA"));
    api.em("GET /api/cases/", { json: [] });
    api.em("GET /api/itinerant-actions/", { status: 403, json: { detail: "Sem permissão." } });
    await page.goto("/casos/");
    await expect(page.getByRole("heading", { level: 1, name: "Acompanhamentos" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".notice[role=alert]")).toHaveCount(0);
  });

  test("Acompanhamentos: erro do servidor avisa", async ({ page, api }) => {
    api.em("GET /api/cases/", { status: 500, json: { detail: "erro" } });
    api.em("GET /api/itinerant-actions/", { json: [] });
    await page.goto("/casos/");
    await expect(avisos(page)).toContainText("Não foi possível carregar os acompanhamentos");
  });

  test("Usuários: o coordenador não vê os pedidos de acesso (403) e não recebe aviso", async ({ page, api }) => {
    api.usuario(operador("COORDENADOR"));
    api.em("GET /api/users/", { json: [operador("COORDENADOR")] });
    api.em("GET /api/access-requests/", { status: 403, json: { detail: "Somente administradores." } });
    api.em("GET /api/institutional/units", { json: [UNIDADE] });
    await page.goto("/admin/");
    await expect(page.getByRole("heading", { name: "Operadores cadastrados" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".notice[role=alert]")).toHaveCount(0);
  });

  test("Cidadãos: busca que falha não diz \"Nada encontrado\"", async ({ page, api }) => {
    api.em("GET /api/citizens/", { status: 500, json: { detail: "erro" } });
    await page.goto("/cidadaos/");
    await expect(avisos(page)).toContainText("Não foi possível carregar os cidadãos");
    await expect(page.getByText("Nada encontrado")).toHaveCount(0);
    await expect(page.getByText("Nenhum cidadão cadastrado")).toHaveCount(0);
  });

  test("Painel: sem rede, avisa o que não carregou", async ({ page, api }) => {
    api.em("GET /api/queues/", { status: 503, json: { detail: "indisponível" } });
    api.em("GET /api/cases/", { json: [] });
    await page.goto("/dashboard/");
    await expect(avisos(page)).toContainText("Não foi possível carregar a fila");
  });

  test("Institucional: lista o que falhou", async ({ page, api }) => {
    api.em("GET /api/institutional/units", { json: [] });
    api.em("GET /api/institutional/services", { status: 500, json: { detail: "erro" } });
    api.em("GET /api/institutional/coordinations", { json: [] });
    api.em("GET /api/institutional/demands", { status: 500, json: { detail: "erro" } });
    await page.goto("/institucional/");
    // As duas leituras falham em paralelo: a ordem no aviso é a de quem respondeu primeiro.
    await expect(avisos(page)).toContainText("os serviços");
    await expect(avisos(page)).toContainText("as categorias");
    await expect(avisos(page)).not.toContainText("as unidades");
  });

  test("Ações itinerantes: sem o resumo, avisa", async ({ page, api }) => {
    api.usuario(operador("GESTOR_ACOES_ITINERANTES"));
    api.em("GET /api/itinerant-actions/", { json: [] });
    api.em("GET /api/itinerant-actions/resumo", { status: 500, json: { detail: "erro" } });
    await page.goto("/acoes-itinerantes/");
    await expect(avisos(page)).toContainText("Não foi possível carregar o resumo");
  });

  test("Prontuário: sem as unidades, avisa que o encaminhamento ficou sem destinos", async ({ page, api }) => {
    api.em("GET /api/citizens/c1/prontuario", { json: PRONTUARIO });
    api.em("GET /api/institutional/units", { status: 500, json: { detail: "erro" } });
    await page.goto("/cidadaos/c1/");
    await expect(avisos(page)).toContainText("Não foi possível carregar as unidades de destino do encaminhamento");
  });
});
