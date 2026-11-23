import type { AcaoItinerante } from "../src/types/sgcas";
import { avisos, expect, operador, test, UNIDADE, type SimuladorDeApi } from "./apoio";

/** A tela de Ações itinerantes: listar, cadastrar, concluir, ver o balanço e excluir. */

function acao(extra: Partial<AcaoItinerante>): AcaoItinerante {
  return {
    id: "acao", titulo: "Ação", descricao: null, local: "Comunidade", data: "2099-01-10T09:00:00-04:00",
    observacoes: null, unidade: UNIDADE.id, unidade_nome: UNIDADE.nome, responsavel: "op-1",
    responsavel_nome: "Operador de Teste", ativa: true, participantes: 0, cidadaos_atendidos: 0,
    beneficios_concedidos: 0, casos_abertos: 0, concluida: false, ...extra,
  };
}

// Datas longe de hoje, para a situação não depender do dia em que o teste roda.
const FUTURA = acao({ id: "futura", titulo: "Mutirão Caiambé", local: "Comunidade Caiambé", data: "2099-03-10T09:00:00-04:00" });
const PASSADA = acao({ id: "passada", titulo: "Ação no Abial", local: "Escola do Abial", data: "2020-05-10T09:00:00-04:00" });
const CONCLUIDA = acao({
  id: "concluida", titulo: "Ação no Juruá", local: "Juruá", data: "2021-08-10T09:00:00-04:00", concluida: true,
  descricao: "Cadastro e orientação", cidadaos_atendidos: 18, participantes: 4, beneficios_concedidos: 6, casos_abertos: 2,
});

function simular(api: SimuladorDeApi, acoes: AcaoItinerante[] = [FUTURA, PASSADA, CONCLUIDA]) {
  api.usuario(operador("GESTOR_ACOES_ITINERANTES"));
  api.em("GET /api/itinerant-actions/", { json: acoes });
  api.em("GET /api/itinerant-actions/resumo", {
    json: { total_cidadaos: 18, total_casos: 2, total_beneficios: 6, total_acoes: acoes.length, total_concluidas: 1 },
  });
}

test("lista as próximas ações e a situação de cada uma", async ({ page, api }) => {
  simular(api);
  await page.goto("/acoes-itinerantes/");

  const proximas = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Próximas ações" }) });
  await expect(proximas).toContainText("Mutirão Caiambé");
  await expect(proximas).toContainText("Próxima");
  await expect(proximas).not.toContainText("Ação no Abial");

  const linha = (titulo: string) => page.getByRole("row").filter({ hasText: titulo });
  await expect(linha("Mutirão Caiambé")).toContainText("Agendada");
  await expect(linha("Ação no Abial")).toContainText("Em andamento");
  await expect(linha("Ação no Juruá")).toContainText("Concluída");
  await expect(page.getByText("1 de 3 ações concluídas")).toBeVisible();

  // A ordem da tabela segue a escolha.
  const primeiraLinha = page.getByRole("row").nth(1);
  await expect(primeiraLinha).toContainText("Ação no Abial");
  await page.getByLabel("Ordem").selectOption("mais-recentes");
  await expect(primeiraLinha).toContainText("Mutirão Caiambé");
});

test("cadastra uma ação nova e atualiza a lista", async ({ page, api }) => {
  simular(api);
  api.em("POST /api/itinerant-actions/", { status: 201, json: acao({ id: "nova", titulo: "Ação no Monte Castelo" }) });
  await page.goto("/acoes-itinerantes/");

  await page.getByRole("button", { name: "Nova ação" }).click();
  await page.getByLabel("Título").fill("Ação no Monte Castelo");
  await page.getByLabel("Local").fill("Centro comunitário");
  await page.getByLabel("Data e hora").fill("2099-05-10T09:30");
  await page.getByLabel("Descrição (opcional)").fill("Atualização do CadÚnico");
  await page.getByRole("button", { name: "Salvar ação" }).click();

  await expect(page.getByRole("status")).toHaveText('Ação "Ação no Monte Castelo" cadastrada.');
  const [cadastro] = api.chamadasA("POST /api/itinerant-actions/");
  expect(cadastro.corpo).toEqual({
    titulo: "Ação no Monte Castelo", local: "Centro comunitário", data: "2099-05-10T09:30",
    descricao: "Atualização do CadÚnico", observacoes: null,
  });
  expect(api.chamadasA("GET /api/itinerant-actions/").length).toBeGreaterThanOrEqual(2);
});

test("cadastro recusado mostra o motivo dentro da janela", async ({ page, api }) => {
  simular(api);
  api.em("POST /api/itinerant-actions/", { status: 409, json: { detalhe: "Seu usuário não tem unidade de lotação definida." } });
  await page.goto("/acoes-itinerantes/");

  await page.getByRole("button", { name: "Nova ação" }).click();
  await page.getByLabel("Título").fill("Ação sem unidade");
  await page.getByLabel("Local").fill("Lugar");
  await page.getByLabel("Data e hora").fill("2099-05-10T09:30");
  await page.getByRole("button", { name: "Salvar ação" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Seu usuário não tem unidade de lotação definida.");
});

test("conclui uma ação com os números do dia", async ({ page, api }) => {
  simular(api);
  api.em(`PATCH /api/itinerant-actions/${PASSADA.id}/concluir`, { json: { ...PASSADA, concluida: true } });
  await page.goto("/acoes-itinerantes/");

  await page.getByRole("row").filter({ hasText: "Ação no Abial" }).getByRole("button", { name: "Concluir" }).click();
  const concluir = page.getByRole("button", { name: "Concluir ação" });
  // Sem o número de cidadãos atendidos, não conclui.
  await expect(concluir).toBeDisabled();
  await page.getByLabel("Cidadãos atendidos").fill("12");
  await page.getByLabel("Participantes").fill("3");
  await concluir.click();

  await expect(page.getByRole("status")).toHaveText('Ação "Ação no Abial" concluída.');
  const [conclusao] = api.chamadasA(`PATCH /api/itinerant-actions/${PASSADA.id}/concluir`);
  expect(conclusao.corpo).toEqual({ cidadaos_atendidos: 12, participantes: 3, beneficios_concedidos: 0, casos_abertos: 0 });
});

test("mostra o balanço de uma ação concluída", async ({ page, api }) => {
  simular(api);
  api.em(`GET /api/itinerant-actions/${CONCLUIDA.id}/balanco`, {
    json: {
      ...CONCLUIDA,
      balanco: {
        cidadaos_cadastrados: 5, casos_abertos_vinculados: 2, beneficios_vinculados: 6, participantes: 4,
        cidadaos_atendidos: 18, beneficios_concedidos: 6, casos_abertos: 2, concluida: true,
      },
    },
  });
  await page.goto("/acoes-itinerantes/");

  await page.getByRole("row").filter({ hasText: "Ação no Juruá" }).getByRole("button", { name: "Balanço" }).click();
  const janela = page.getByRole("dialog");
  await expect(janela.getByRole("heading", { name: "Balanço da ação" })).toBeVisible();
  await expect(janela).toContainText("Ação no Juruá — Juruá");
  await expect(janela).toContainText("18");
  await expect(janela).toContainText("Cadastro e orientação");
});

test("exclui uma ação depois de confirmar", async ({ page, api }) => {
  simular(api);
  api.em(`DELETE /api/itinerant-actions/${FUTURA.id}/excluir`, { status: 204, corpo: "" });
  await page.goto("/acoes-itinerantes/");

  await page.getByRole("button", { name: "Excluir a ação Mutirão Caiambé" }).click();
  await expect(page.getByRole("dialog")).toContainText('A ação "Mutirão Caiambé" será excluída.');
  await page.getByRole("dialog").getByRole("button", { name: "Excluir", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText('Ação "Mutirão Caiambé" excluída.');
  expect(api.chamadasA(`DELETE /api/itinerant-actions/${FUTURA.id}/excluir`)).toHaveLength(1);
  await expect(avisos(page)).toHaveCount(0);
});
