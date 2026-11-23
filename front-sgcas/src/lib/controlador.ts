/**
 * Quem responde pelos dados pessoais tratados no SGCAS (LGPD, art. 5º, VI): a Prefeitura,
 * e não a secretaria que usa ou a que mantém o sistema, que são órgãos dela, com o mesmo CNPJ.
 * Fonte única para o termo exibido no cadastro; os textos de `api-sgcas/docs/` repetem estes dados.
 */
export const CONTROLADOR = {
  nome: "Prefeitura Municipal de Tefé",
  cnpj: "04.426.383/0001-15",
  endereco: "Rua Olavo Bilac, 500, Tefé – AM, CEP 69470-000",
};

export type Encarregado = { nome: string; email: string; telefone: string };

/**
 * O encarregado pelo tratamento de dados (DPO, LGPD art. 41) é indicado pela Prefeitura, por ato
 * formal. Enquanto não houver, fica `null` e o termo diz que ele será designado, em vez de mostrar
 * campos em branco ao cidadão. Ao ser designado, preencha aqui e nos dois textos de `api-sgcas/docs/`.
 */
export const ENCARREGADO = null as Encarregado | null;
