import type { Page } from "@playwright/test";
import {
  avisos, caso, cidadao, entrada, expect, operador, OUTRA_UNIDADE, painelDaRecepcao, QUANDO, servico, test, type SimuladorDeApi,
} from "./apoio";

const MARIA = cidadao({ id: "c1", nome: "Maria de Teste" });
const CESTA = servico({ id: "serv-1", nome: "Cesta básica" });
const PAEFI = servico({
  id: "serv-2", nome: "PAEFI", unidade: OUTRA_UNIDADE.id, unidade_nome: OUTRA_UNIDADE.nome, demanda_nome: "Violação de Direitos",
});

function simularRecepcao(api: SimuladorDeApi) {
  api.usuario(operador("RECEPCIONISTA"));
  api.em("GET /api/institutional/services", { json: [CESTA, PAEFI] });
  api.em("GET /api/reception/atendimentos", { json: [] });
  api.em("GET /api/reception/painel", { json: painelDaRecepcao({ aguardando_na_fila: 2 }) });
  api.em("GET /api/queues/", { json: [] });
  api.em("GET /api/citizens/", { json: [MARIA] });
  api.em(`GET /api/citizens/${MARIA.id}/historico`, { json: { cidadao: MARIA, entradas: [entrada()] } });
  api.em("GET /api/cases/", { json: [] });
  api.em("GET /api/referrals/recebidos", { json: [] });
  api.em(`GET /api/citizens/${MARIA.id}/duplicidade`, { json: { alertas: [], exige_justificativa: false } });
}

async function selecionarMaria(page: Page) {
  await page.goto("/recepcao/");
  await page.getByLabel("Buscar por nome, CPF, NIS ou e-mail").fill("Maria");
  await page.getByRole("button", { name: `Selecionar ${MARIA.nome}` }).click();
  await expect(page.getByRole("heading", { name: "Pergunte o que o cidadão deseja" })).toBeVisible();
  await page.getByRole("button", { name: "Começar atendimento" }).click();
}

test("inicia o atendimento: cria o caso e mostra a senha", async ({ page, api }) => {
  simularRecepcao(api);
  api.em("POST /api/reception/atendimento", {
    json: { desfecho: "ENCAMINHADO", caso: caso(), senha: { senha: "NR001", servico: CESTA.nome }, encaminhamento: null },
  });

  await selecionarMaria(page);
  await expect(page.getByText("Benefício concedido: Cesta básica")).toBeVisible();
  await page.getByRole("button", { name: /^Iniciar atendimento/ }).click();
  await page.getByLabel("Serviço solicitado").selectOption(CESTA.id);
  await page.getByRole("button", { name: "Criar caso e gerar senha" }).click();

  await expect(page.getByRole("heading", { name: "Caso enviado para a fila" })).toBeVisible();
  await expect(page.getByText("Senha gerada: NR001.", { exact: false })).toBeVisible();
  const [registro] = api.chamadasA("POST /api/reception/atendimento");
  expect(registro.corpo).toMatchObject({
    cidadao_id: MARIA.id, servico_id: CESTA.id, unidade_destino_id: CESTA.unidade, desfecho: "ENCAMINHADO", justificativa_duplicidade: null,
  });
});

test("finaliza no balcão: registra o motivo e não gera senha", async ({ page, api }) => {
  simularRecepcao(api);
  api.em("POST /api/reception/atendimento", { json: { desfecho: "FINALIZADO", caso: null, senha: null, encaminhamento: null } });

  await selecionarMaria(page);
  await page.getByRole("button", { name: /^Finalizar na recepção/ }).click();
  await page.getByLabel("Serviço solicitado").selectOption(CESTA.id);
  await page.getByLabel("Motivo da finalização").fill("Já retirou a cesta neste mês no CRAS Sul.");
  await page.getByRole("button", { name: "Finalizar atendimento" }).click();

  await expect(page.getByRole("heading", { name: "Atendimento finalizado" })).toBeVisible();
  const [registro] = api.chamadasA("POST /api/reception/atendimento");
  expect(registro.corpo).toMatchObject({ desfecho: "FINALIZADO", motivo: "Já retirou a cesta neste mês no CRAS Sul." });
});

test("auxílio repetido: só gera a senha com a justificativa escrita", async ({ page, api }) => {
  simularRecepcao(api);
  const alerta = {
    origem: "beneficio", quando: QUANDO, unidade: OUTRA_UNIDADE.nome, unidade_id: OUTRA_UNIDADE.id,
    o_que: "Cesta básica", detalhe: null, periodo: "neste mês",
  };
  api.em(`GET /api/citizens/${MARIA.id}/duplicidade`, { json: { alertas: [alerta], exige_justificativa: true } });
  api.em("POST /api/reception/atendimento", {
    json: { desfecho: "ENCAMINHADO", caso: caso(), senha: { senha: "NR002" }, encaminhamento: null },
  });

  await selecionarMaria(page);
  await page.getByRole("button", { name: /^Iniciar atendimento/ }).click();
  await page.getByLabel("Serviço solicitado").selectOption(CESTA.id);

  await expect(page.getByText("Esta pessoa já recebeu ou pediu este auxílio neste mês")).toBeVisible();
  const gerar = page.getByRole("button", { name: "Criar caso e gerar senha" });
  await expect(gerar).toBeDisabled();
  await page.getByLabel("Justificativa para repetir").fill("curta");
  await expect(gerar).toBeDisabled();
  const justificativa = "Família numerosa, a cesta anterior acabou.";
  await page.getByLabel("Justificativa para repetir").fill(justificativa);
  await expect(gerar).toBeEnabled();
  await gerar.click();

  await expect(page.getByRole("heading", { name: "Caso enviado para a fila" })).toBeVisible();
  const [registro] = api.chamadasA("POST /api/reception/atendimento");
  expect(registro.corpo).toMatchObject({ justificativa_duplicidade: justificativa });
});

test("sem o histórico da pessoa, não afirma que não há repetição", async ({ page, api }) => {
  simularRecepcao(api);
  api.em(`GET /api/citizens/${MARIA.id}/historico`, { status: 500, json: { detail: "erro" } });

  await selecionarMaria(page);
  await expect(avisos(page)).toContainText("Não foi possível carregar o histórico da pessoa");
  await expect(page.getByText("Histórico indisponível")).toBeVisible();
  await expect(page.getByText("Histórico não conferido")).toBeVisible();
  await expect(page.getByText("Nada nos últimos meses que indique duplicidade.")).toHaveCount(0);
});

test("falha na busca de cidadãos avisa, em vez de parecer que ninguém foi encontrado", async ({ page, api }) => {
  simularRecepcao(api);
  api.em("GET /api/citizens/", { status: 500, json: { detail: "erro" } });

  await page.goto("/recepcao/");
  await page.getByLabel("Buscar por nome, CPF, NIS ou e-mail").fill("Maria");
  await expect(avisos(page)).toContainText("Não foi possível carregar a busca de cidadãos");
});
