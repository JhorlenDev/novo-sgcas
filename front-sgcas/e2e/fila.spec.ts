import { avisos, caso, entrada, expect, operador, painelDoAtendente, senha, test, UNIDADE, type SimuladorDeApi } from "./apoio";

/** Os cenários da tela de Atendimento (antes em `scripts/test-fila.mjs`). */

const A001 = senha();
const montado = (s = A001) => ({ senha: s, cidadao: { id: "c1", nome: "Pessoa de teste" }, caso: null, encaminhamento_recebido: null, historico: [] });

function simularFila(api: SimuladorDeApi, opcoes: { filaVaziaDepoisDeChamar?: boolean } = {}) {
  let chamou = false;
  api.em("GET /api/queues/", () => ({ json: chamou && opcoes.filaVaziaDepoisDeChamar ? [] : [A001] }));
  api.em("GET /api/queues/painel", { json: painelDoAtendente() });
  api.em("GET /api/institutional/units", { json: [UNIDADE] });
  api.em("GET /api/queues/atendimento-atual", { json: null });
  return { marcarChamada: () => { chamou = true; } };
}

test.describe("chamar o próximo", () => {
  test("sucesso: abre a conferência, recupera depois e lista os indicadores", async ({ page, api }) => {
    const fila = simularFila(api, { filaVaziaDepoisDeChamar: true });
    let atual: unknown = null;
    api.em("GET /api/queues/atendimento-atual", () => ({ json: atual }));
    api.em("POST /api/queues/chamar-proximo", () => {
      fila.marcarChamada();
      atual = montado();
      return { json: atual, atraso: 150 };
    });
    api.em("GET /api/cases/", { json: [] });
    api.em("GET /api/queues/em-atendimento", {
      json: [
        { ...A001, id: "antiga", senha: "A002", operador_nome: "Operador de Teste", pode_retomar: true },
        { ...A001, id: "outra", senha: "A003", operador_nome: "Outro operador", pode_retomar: false },
      ],
    });
    api.em("GET /api/queues/antiga/retomar", { json: montado({ ...A001, id: "antiga", senha: "A002" }) });
    for (const grupo of ["atendidos_hoje", "aguardando_na_fila", "finalizados_hoje", "casos_em_acompanhamento"]) {
      api.em(`GET /api/queues/painel/${grupo}`, {
        json: grupo === "aguardando_na_fila" ? { tipo: "senhas", registros: [] }
          : grupo === "atendidos_hoje" ? { tipo: "senhas", registros: [A001] }
          : { tipo: "casos", registros: [caso({ situacao: "CONCLUIDO" })] },
      });
    }

    await page.goto("/fila/");
    const botao = page.getByRole("button", { name: "Chamar próximo", exact: true });
    await expect(page.getByText("A001", { exact: true })).toBeVisible();
    expect(api.chamadasA("GET /api/queues/")[0].url.searchParams.get("unidade")).toBe(UNIDADE.id);

    // Clique duplo não chama duas vezes.
    await botao.dblclick();
    await expect(page.getByRole("heading", { name: "Conferir senha A001" })).toBeVisible();
    expect(api.chamadasA("POST /api/queues/chamar-proximo")).toHaveLength(1);
    await page.getByRole("button", { name: "Conferir depois" }).click();
    await expect(botao).toBeDisabled();

    // Sair e voltar recupera o atendimento.
    await page.goto("/dashboard/");
    await page.goto("/fila/");
    await expect(page.getByRole("button", { name: "Abrir conferência" })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Abrir conferência" }).click();
    await expect(page.getByRole("heading", { name: "Conferir senha A001" })).toBeVisible();
    await page.getByRole("button", { name: "Conferir depois" }).click();

    // Retomar uma senha própria; a de outro atendente não se retoma.
    await page.getByRole("button", { name: "Ver em atendimento" }).click();
    await expect(page.getByRole("button", { name: /A003/ })).toBeDisabled();
    await page.getByRole("button", { name: /A002/ }).click();
    await expect(page.getByRole("status")).toHaveText("Senha A002 recuperada em Atendimento atual.");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Abrir conferência" }).click();
    await expect(page.getByRole("heading", { name: "Conferir senha A002" })).toBeVisible();
    await page.getByRole("button", { name: "Conferir depois" }).click();

    for (const rotulo of ["atendidos hoje", "aguardando na fila", "finalizados", "acompanhamento"]) {
      await page.getByRole("button", { name: `Ver ${rotulo}`, exact: true }).click();
      const dialogo = page.getByRole("dialog");
      await expect(dialogo).toBeVisible();
      await expect(dialogo).toContainText(
        rotulo === "aguardando na fila" ? "Nenhum registro neste indicador." : rotulo === "atendidos hoje" ? "A001" : "CASO-001",
      );
      await dialogo.getByRole("button", { name: "Fechar", exact: true }).click();
    }
  });

  const recusas = [
    { cenario: "fila vazia", resposta: { status: 404, json: { detalhe: "Não há ninguém aguardando" } }, mensagem: "Não há ninguém aguardando" },
    { cenario: "sem permissão", resposta: { status: 403, json: { detail: "Sem permissão para chamar." } }, mensagem: "Sem permissão para chamar." },
    {
      cenario: "servidor fora do ar",
      resposta: { status: 502, corpo: "<html>Bad Gateway</html>" },
      mensagem: "O servidor retornou uma resposta inválida. Tente novamente.",
    },
  ];
  for (const { cenario, resposta, mensagem } of recusas) {
    test(`${cenario}: mostra o motivo e deixa tentar de novo`, async ({ page, api }) => {
      simularFila(api);
      api.em("POST /api/queues/chamar-proximo", resposta);
      await page.goto("/fila/");
      const botao = page.getByRole("button", { name: "Chamar próximo", exact: true });
      await expect(page.getByText("A001", { exact: true })).toBeVisible();
      await botao.dblclick();
      await expect(page.getByRole("status")).toHaveText(mensagem);
      await expect(botao).toBeEnabled();
      expect(api.chamadasA("POST /api/queues/chamar-proximo")).toHaveLength(1);
    });
  }
});

test.describe("quando não pode chamar", () => {
  test("sem unidade de lotação", async ({ page, api }) => {
    api.usuario(operador("ADMIN", { unidade: null }));
    api.em("GET /api/institutional/units", { json: [UNIDADE] });
    await page.goto("/fila/");
    await expect(page.getByText("Seu usuário não tem unidade de lotação definida", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Chamar próximo", exact: true })).toBeDisabled();
  });

  test("perfil de recepção", async ({ page, api }) => {
    api.usuario(operador("RECEPCIONISTA"));
    simularFila(api);
    await page.goto("/fila/");
    await expect(page.getByText("Seu perfil não tem permissão para chamar senhas.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Chamar próximo", exact: true })).toBeDisabled();
    expect(api.chamadasA("POST /api/queues/chamar-proximo")).toHaveLength(0);
  });

  test("atendimento atual indisponível: não deixa chamar outra senha por cima", async ({ page, api }) => {
    simularFila(api);
    api.em("GET /api/queues/atendimento-atual", { status: 500, json: { detail: "erro" } });
    await page.goto("/fila/");
    await expect(page.getByRole("status")).toHaveText(
      "Não foi possível recuperar seu atendimento atual. Recarregue a página para tentar novamente.",
    );
    await expect(page.getByRole("button", { name: "Chamar próximo", exact: true })).toBeDisabled();
    expect(api.chamadasA("POST /api/queues/chamar-proximo")).toHaveLength(0);
  });
});

test("histórico do atendimento: o que aconteceu e onde ficam em linhas separadas", async ({ page, api }) => {
  simularFila(api);
  api.em("GET /api/queues/atendimento-atual", {
    json: { ...montado(), historico: [entrada({ o_que: "Auxílio em calamidade pública", unidade: "CRAS Centro", detalhe: null })] },
  });
  await page.goto("/fila/");
  const linha = page.locator("#atendimento-atual").locator("..").locator(".line-row").first();
  await expect(linha).toBeVisible();
  // Antes saía "Auxílio em calamidade públicaCRAS Centro", tudo numa linha.
  await expect(linha).toHaveText(/Auxílio em calamidade pública\s*\n\s*CRAS Centro/, { useInnerText: true });
  for (const elemento of [linha.locator("strong"), linha.locator("small")]) {
    expect(await elemento.evaluate((el) => getComputedStyle(el).display)).toBe("block");
  }
});

test("falha ao carregar os destinos do encaminhamento avisa", async ({ page, api }) => {
  simularFila(api);
  api.em("GET /api/institutional/units", { status: 500, json: { detail: "erro" } });
  await page.goto("/fila/");
  await expect(avisos(page)).toContainText("Não foi possível carregar as unidades de destino do encaminhamento");
});
