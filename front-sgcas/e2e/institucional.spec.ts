import type { Demanda, Servico, Unidade } from "../src/types/sgcas";
import { expect, operador, OUTRA_UNIDADE, servico, test, UNIDADE, type SimuladorDeApi } from "./apoio";

/** A tela Institucional: unidades, serviços e a classificação que liga o controle de repetição. */

const BENEFICIO: Demanda = { id: "dem-beneficio", nome: "Benefício Eventual", ativa: true };
const VIOLACAO: Demanda = { id: "dem-violacao", nome: "Violação de Direitos", ativa: true };
const CESTA = servico({ id: "serv-cesta", nome: "Cesta básica", demanda_id: BENEFICIO.id, demanda_nome: BENEFICIO.nome, tipo_de_beneficio: "SITUACAO_VULNERABILIDADE_TEMPORARIA", tipo_de_beneficio_rotulo: "Vulnerabilidade temporária" });
const VISITA = servico({ id: "serv-visita", nome: "Visita domiciliar", demanda_id: null, demanda_nome: null });
const PAEFI = servico({ id: "serv-paefi", nome: "PAEFI", unidade: OUTRA_UNIDADE.id, unidade_nome: OUTRA_UNIDADE.nome, demanda_id: VIOLACAO.id, demanda_nome: VIOLACAO.nome });

function simular(api: SimuladorDeApi, unidades: Unidade[] = [UNIDADE, OUTRA_UNIDADE], servicos: Servico[] = [CESTA, VISITA, PAEFI]) {
  api.em("GET /api/institutional/units", { json: unidades });
  api.em("GET /api/institutional/services", { json: servicos });
  api.em("GET /api/institutional/coordinations", { json: [] });
  api.em("GET /api/institutional/demands", { json: [BENEFICIO, VIOLACAO] });
}

test("cadastra uma unidade, avisa que deu certo e atualiza a lista", async ({ page, api }) => {
  simular(api);
  api.em("POST /api/institutional/units", { status: 201, json: { id: "nova", nome: "CRAS III", sigla: "CRAS-III", tipo: "CRAS" } });
  await page.goto("/institucional/");

  await page.getByRole("button", { name: "Nova unidade" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("CRAS III");
  await page.getByLabel("Sigla").fill("CRAS-III");
  await page.getByRole("button", { name: "Cadastrar unidade" }).click();

  // Antes, a unidade era criada mas a tela dizia que não, e a lista não era atualizada.
  await expect(page.getByRole("status")).toHaveText("Unidade cadastrada.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(api.chamadasA("GET /api/institutional/units").length).toBeGreaterThanOrEqual(2);
  const [cadastro] = api.chamadasA("POST /api/institutional/units");
  expect(cadastro.corpo).toEqual({
    nome: "CRAS III", sigla: "CRAS-III", tipo: "CRAS", endereco: null, telefone: null, coordenacao_id: null,
  });
});

test("unidade recusada mostra o motivo da API dentro da janela", async ({ page, api }) => {
  simular(api);
  api.em("POST /api/institutional/units", { status: 400, json: { sigla: ["Já existe uma unidade com esta sigla."] } });
  await page.goto("/institucional/");

  await page.getByRole("button", { name: "Nova unidade" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("CRAS Centro");
  await page.getByLabel("Sigla").fill("CRAS-C");
  await page.getByRole("button", { name: "Cadastrar unidade" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Já existe uma unidade com esta sigla.");
});

test("cadastra um auxílio com a categoria e o tipo", async ({ page, api }) => {
  simular(api);
  api.em("POST /api/institutional/services", { status: 201, json: { id: "novo" } });
  await page.goto("/institucional/");

  await page.getByRole("button", { name: "Novo serviço" }).click();
  const janela = page.getByRole("dialog");
  await janela.getByLabel("Nome do serviço").fill("Auxílio funeral");
  await janela.getByLabel("Unidade").selectOption(UNIDADE.id);
  // O tipo só aparece na categoria de benefício.
  await expect(janela.getByLabel("Tipo de auxílio")).toHaveCount(0);
  await janela.getByLabel("Categoria municipal").selectOption(BENEFICIO.id);
  await janela.getByLabel("Tipo de auxílio").selectOption("SITUACAO_MORTE");
  await janela.getByRole("button", { name: "Cadastrar serviço" }).click();

  await expect(page.getByRole("status")).toHaveText("Serviço cadastrado.");
  const [cadastro] = api.chamadasA("POST /api/institutional/services");
  expect(cadastro.corpo).toEqual({
    nome: "Auxílio funeral", descricao: null, unidade_id: UNIDADE.id, demanda_id: BENEFICIO.id, tipo_de_beneficio: "SITUACAO_MORTE",
  });
});

test("serviço recusado mostra o motivo dentro da janela", async ({ page, api }) => {
  simular(api);
  api.em("POST /api/institutional/services", { status: 400, json: { nome: ["Esta unidade já tem um serviço com este nome."] } });
  await page.goto("/institucional/");

  await page.getByRole("button", { name: "Novo serviço" }).click();
  const janela = page.getByRole("dialog");
  await janela.getByLabel("Nome do serviço").fill("Cesta básica");
  await janela.getByLabel("Unidade").selectOption(UNIDADE.id);
  await janela.getByRole("button", { name: "Cadastrar serviço" }).click();
  await expect(janela.getByRole("alert")).toHaveText("Esta unidade já tem um serviço com este nome.");
});

test("classificar: fora da categoria de benefício, o tipo não vai à API", async ({ page, api }) => {
  simular(api);
  api.em(`PATCH /api/institutional/services/${CESTA.id}`, { json: { ...CESTA, demanda_id: VIOLACAO.id } });
  await page.goto("/institucional/");

  await page.getByRole("row").filter({ hasText: "Cesta básica" }).getByRole("button", { name: "Classificar" }).click();
  const janela = page.getByRole("dialog");
  await expect(janela.getByLabel("Tipo de auxílio")).toHaveValue("SITUACAO_VULNERABILIDADE_TEMPORARIA");
  await janela.getByLabel("Categoria municipal").selectOption(VIOLACAO.id);
  await janela.getByRole("button", { name: "Salvar classificação" }).click();

  await expect(page.getByRole("status")).toHaveText("Classificação do serviço atualizada.");
  const [edicao] = api.chamadasA(`PATCH /api/institutional/services/${CESTA.id}`);
  expect(edicao.corpo).toEqual({ demanda_id: VIOLACAO.id, tipo_de_beneficio: null });
});

test("o coordenador só classifica os serviços da própria unidade", async ({ page, api }) => {
  api.usuario(operador("COORDENADOR"));
  simular(api);
  await page.goto("/institucional/");

  await expect(page.getByRole("row").filter({ hasText: "Cesta básica" }).getByRole("button", { name: "Classificar" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "PAEFI" }).getByRole("button", { name: "Classificar" })).toHaveCount(0);
});

test("filtra os serviços por unidade e por nome", async ({ page, api }) => {
  simular(api);
  await page.goto("/institucional/");

  await expect(page.getByText("3 ativos")).toBeVisible();
  await page.getByLabel("Unidade").selectOption(UNIDADE.id);
  await expect(page.getByText("2 de 3")).toBeVisible();
  await page.getByLabel("Buscar serviço").fill("cesta");
  await expect(page.getByText("1 de 3")).toBeVisible();
  await page.getByLabel("Buscar serviço").fill("inexistente");
  await expect(page.getByText("Nenhum serviço encontrado")).toBeVisible();
});
