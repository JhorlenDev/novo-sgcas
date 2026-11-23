import type { Page } from "@playwright/test";
import {
  avisos, caso, entrada, expect, operador, OUTRA_UNIDADE, painelDoAtendente, senha, test, UNIDADE, type SimuladorDeApi,
} from "./apoio";

/** Os cenários da tela de Atendimento (antes em `scripts/test-fila.mjs`). */

const A001 = senha();
const montado = (s = A001) => ({ senha: s, cidadao: { id: "c1", nome: "Pessoa de teste" }, caso: null, encaminhamento_recebido: null, historico: [] });

function simularFila(api: SimuladorDeApi, opcoes: { filaVaziaDepoisDeChamar?: boolean } = {}) {
  let chamou = false;
  api.em("GET /api/queues/", () => ({ json: chamou && opcoes.filaVaziaDepoisDeChamar ? [] : [A001] }));
  api.em("GET /api/queues/painel", { json: painelDoAtendente() });
  api.em("GET /api/institutional/units", { json: [UNIDADE, OUTRA_UNIDADE] });
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

/** Um atendimento já chamado, com caso, como volta de `atendimento-atual`. */
const CASO = caso({ id: "caso-1", protocolo: "20261123-ABC123" });

async function abrirAtendimento(page: Page, api: SimuladorDeApi) {
  simularFila(api);
  api.em("GET /api/queues/atendimento-atual", { json: { ...montado(), caso: CASO } });
  api.em(`POST /api/cases/${CASO.id}/observacao`, { json: CASO });
  await page.goto("/fila/");
  await page.getByRole("button", { name: "Abrir conferência" }).click();
  await expect(page.getByRole("heading", { name: "Conferir senha A001" })).toBeVisible();
}

async function iniciarSemRegistro(page: Page) {
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(page.getByRole("status")).toHaveText("Senha A001 em atendimento.");
}

test.describe("o atendimento depois de chamado", () => {
  test("iniciar grava o registro guiado como observação do caso", async ({ page, api }) => {
    await abrirAtendimento(page, api);
    await page.getByLabel("Situação identificada").selectOption("Vulnerabilidade social relatada");
    await page.getByLabel("Providência").selectOption("Orientação registrada");
    await page.getByLabel("Retorno necessário?").selectOption("SIM");
    await page.getByLabel("Data prevista").fill("2026-10-10");
    await page.getByLabel("Observação inicial").fill("Trouxe os documentos.");
    await page.getByRole("button", { name: "Iniciar atendimento" }).click();

    await expect(page.getByRole("status")).toHaveText("Senha A001 em atendimento.");
    const [observacao] = api.chamadasA(`POST /api/cases/${CASO.id}/observacao`);
    expect(observacao.corpo).toEqual({
      observacao: [
        "Situação identificada: Vulnerabilidade social relatada.",
        "Providência tomada: Orientação registrada.",
        "Retorno necessário: sim, previsto para 10/10/2026.",
        "Observação: Trouxe os documentos.",
      ].join("\n"),
    });
    for (const acao of ["Observação", "Encaminhar", "Concluir", "Não veio"]) {
      await expect(page.getByRole("button", { name: acao, exact: true })).toBeVisible();
    }
  });

  test("iniciar sem registro não grava observação vazia", async ({ page, api }) => {
    await abrirAtendimento(page, api);
    await iniciarSemRegistro(page);
    expect(api.chamadasA(`POST /api/cases/${CASO.id}/observacao`)).toHaveLength(0);
  });

  test("observação registra a evolução", async ({ page, api }) => {
    await abrirAtendimento(page, api);
    await iniciarSemRegistro(page);
    await page.getByRole("button", { name: "Observação", exact: true }).click();
    await page.getByLabel("Observação/evolução").fill("Retornou com o comprovante.");
    await page.getByRole("button", { name: "Salvar observação" }).click();
    await expect(page.getByRole("status")).toHaveText("Observação registrada no acompanhamento.");
    const [observacao] = api.chamadasA(`POST /api/cases/${CASO.id}/observacao`);
    expect(observacao.corpo).toEqual({ observacao: "Observação: Retornou com o comprovante." });
  });

  test("encaminhar cobra a ficha e envia para a unidade escolhida", async ({ page, api }) => {
    await abrirAtendimento(page, api);
    api.em(`POST /api/cases/${CASO.id}/encaminhar`, { json: { id: "enc-1" } });
    await iniciarSemRegistro(page);
    await page.getByRole("button", { name: "Encaminhar", exact: true }).click();

    const enviar = page.getByRole("button", { name: "Encaminhar atendimento" });
    await enviar.click();
    await expect(page.getByText("Escolha a unidade de destino ou informe o destino externo.")).toBeVisible();
    await expect(page.getByText("Informe o motivo do encaminhamento.")).toBeVisible();
    expect(api.chamadasA(`POST /api/cases/${CASO.id}/encaminhar`)).toHaveLength(0);

    // A própria unidade não é oferecida como destino.
    await expect(page.getByLabel("Unidade da rede").locator("option", { hasText: UNIDADE.nome })).toHaveCount(0);
    await page.getByLabel("Unidade da rede").selectOption(OUTRA_UNIDADE.id);
    await page.getByLabel("Categoria do motivo").selectOption("VIOLACAO_DE_DIREITOS");
    await page.getByLabel("Motivo do encaminhamento").fill("Suspeita de violação de direitos.");
    await page.getByLabel("Resumo da situação").fill("Relato da família na recepção.");
    await enviar.click();

    await expect(page.getByRole("status")).toHaveText("Atendimento encaminhado com a ficha. A unidade de destino foi avisada.");
    const [envio] = api.chamadasA(`POST /api/cases/${CASO.id}/encaminhar`);
    expect(envio.corpo).toEqual({
      unidade_destino_id: OUTRA_UNIDADE.id, destino_externo: null, categoria_do_motivo: "VIOLACAO_DE_DIREITOS",
      urgencia: "NORMAL", motivo: "Suspeita de violação de direitos.", resumo_da_situacao: "Relato da família na recepção.",
      documentos_entregues: null, contato_para_retorno: null, prazo: null, observacoes: null,
    });
  });

  test("concluir encerra o caso com o relato", async ({ page, api }) => {
    await abrirAtendimento(page, api);
    api.em(`POST /api/cases/${CASO.id}/concluir`, { json: { ...CASO, situacao: "CONCLUIDO" } });
    await iniciarSemRegistro(page);
    await page.getByRole("button", { name: "Concluir", exact: true }).click();
    await page.getByLabel("Relato final").fill("Orientação concluída.");
    await page.getByRole("button", { name: "Concluir atendimento" }).click();
    await expect(page.getByRole("status")).toHaveText("Atendimento concluído e senha finalizada.");
    const [conclusao] = api.chamadasA(`POST /api/cases/${CASO.id}/concluir`);
    expect(conclusao.corpo).toEqual({ situacao: "CONCLUIDO", relato: "Orientação concluída." });
    await expect(page.getByText("Nenhum atendimento iniciado")).toBeVisible();
  });

  test("concluir um caso já encerrado mostra o motivo da API", async ({ page, api }) => {
    await abrirAtendimento(page, api);
    api.em(`POST /api/cases/${CASO.id}/concluir`, { status: 409, json: { detalhe: "Este caso já foi concluído." } });
    await iniciarSemRegistro(page);
    await page.getByRole("button", { name: "Concluir", exact: true }).click();
    await page.getByRole("button", { name: "Concluir atendimento" }).click();
    // O erro aparece dentro da janela, que continua aberta; atrás dela ninguém o veria.
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Este caso já foi concluído.");
  });

  test("encaminhamento recusado pela API mostra o motivo dentro da janela", async ({ page, api }) => {
    await abrirAtendimento(page, api);
    api.em(`POST /api/cases/${CASO.id}/encaminhar`, {
      status: 400, json: { unidade_destino_id: ["A unidade SEDECTI não recebe encaminhamento de caso."] },
    });
    await iniciarSemRegistro(page);
    await page.getByRole("button", { name: "Encaminhar", exact: true }).click();
    await page.getByLabel("Unidade da rede").selectOption(OUTRA_UNIDADE.id);
    await page.getByLabel("Categoria do motivo").selectOption("VIOLACAO_DE_DIREITOS");
    await page.getByLabel("Motivo do encaminhamento").fill("Motivo.");
    await page.getByLabel("Resumo da situação").fill("Resumo.");
    await page.getByRole("button", { name: "Encaminhar atendimento" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("A unidade SEDECTI não recebe encaminhamento de caso.");
  });

  test("não compareceu marca a senha com o motivo", async ({ page, api }) => {
    await abrirAtendimento(page, api);
    api.em(`POST /api/queues/${A001.id}/nao-compareceu`, { json: { ok: true } });
    await page.getByRole("dialog").getByRole("button", { name: "Não compareceu" }).click();
    await page.getByLabel("Motivo, opcional").fill("Chamado três vezes.");
    await page.getByRole("button", { name: "Confirmar não compareceu" }).click();
    await expect(page.getByRole("status")).toHaveText("Senha marcada como não compareceu.");
    const [marcacao] = api.chamadasA(`POST /api/queues/${A001.id}/nao-compareceu`);
    expect(marcacao.corpo).toEqual({ motivo: "Chamado três vezes." });
  });
});
