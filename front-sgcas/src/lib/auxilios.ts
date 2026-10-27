/**
 * Os tipos de auxílio que um serviço pode conceder, na ordem da tela.
 *
 * O balcão não sabe, pelo nome do serviço, que "Auxílio maternidade" é um auxílio de
 * nascimento — e é o tipo que decide por quanto tempo a repetição conta. Quem
 * cadastra o serviço informa o tipo. "Outros" fica de fora de propósito: não diz o
 * quê é dado, então não há o que comparar. A lista espelha a da API
 * (`BeneficioEventual.Tipo`).
 */
export const TIPOS_DE_AUXILIO = [
  { valor: "SITUACAO_VULNERABILIDADE_TEMPORARIA", rotulo: "Vulnerabilidade temporária" },
  { valor: "SITUACAO_NASCIMENTO", rotulo: "Situação de nascimento" },
  { valor: "SITUACAO_MORTE", rotulo: "Situação de morte" },
  { valor: "SITUACAO_CALAMIDADE", rotulo: "Situação de calamidade" },
] as const;

/** A categoria municipal que liga o serviço ao controle de repetição de auxílio. */
export const CATEGORIA_DE_BENEFICIO = "Benefício Eventual";

/** Os tipos que a regra do município limita a uma vez por ano, e não por mês. */
export const TIPOS_DE_UMA_VEZ_POR_ANO: readonly string[] = ["SITUACAO_NASCIMENTO"];
