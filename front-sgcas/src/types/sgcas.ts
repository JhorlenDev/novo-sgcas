export type Papel =
  | "ADMIN"
  | "COORDENADOR"
  | "ASSISTENTE_SOCIAL"
  | "TECNICO"
  | "RECEPCIONISTA"
  | "GESTOR_ACOES_ITINERANTES"
  | "VISUALIZADOR";

export type Unidade = {
  id: string;
  nome: string;
  sigla?: string | null;
  tipo?: string | null;
  endereco?: string | null;
  telefone?: string | null;
  coordenacao?: string | null;
  nome_qualificado?: string | null;
  ativa?: boolean;
};

export type Coordenacao = {
  id: string;
  nome: string;
  sigla: string;
  ativa: boolean;
  superior?: string | null;
};

export type Demanda = {
  id: string;
  nome: string;
  categoria?: string | null;
  ativa: boolean;
};

export type Operador = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  unidade: Unidade | null;
};

export type CidadaoLista = {
  id: string;
  nome: string;
  cpf?: string | null;
  nascimento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
};

export type Cidadao = CidadaoLista & {
  nis?: string | null;
  rg?: string | null;
  email?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  uf?: string | null;
  cep?: string | null;
  observacoes?: string | null;
  socioeconomico?: Record<string, unknown> | null;
  membros_da_familia?: unknown[] | null;
  anexos?: unknown[] | null;
  autoriza_imagem?: boolean | null;
  imagem_aceita_em?: string | null;
  imagem_revogada_em?: string | null;
  consentiu_tefe_cidadao_em?: string | null;
};

export type Servico = {
  id: string;
  nome: string;
  descricao?: string | null;
  unidade: string;
  unidade_nome: string;
  demanda_id?: string | null;
  demanda_nome?: string | null;
  /** Que auxílio o serviço concede, quando é um auxílio (só na categoria "Benefício Eventual"). */
  tipo_de_beneficio?: string | null;
  tipo_de_beneficio_rotulo?: string | null;
  ativo?: boolean;
};

export type Senha = {
  id: string;
  senha: string;
  situacao: string;
  prioridade: string;
  servico?: string | null;
  cidadao: string;
  cidadao_nome: string;
  chamado_em?: string | null;
  criado_em: string;
};

export type AtendimentoRecepcao = {
  id: string;
  cidadao: string;
  cidadao_nome: string;
  unidade_nome: string;
  atendido_por_nome: string;
  demanda: string;
  desfecho: "ENCAMINHADO" | "FINALIZADO";
  motivo?: string | null;
  observacao?: string | null;
  local_do_atendimento?: string | null;
  caso?: string | null;
  caso_protocolo?: string | null;
  criado_em: string;
};

export type BeneficioEventual = {
  id: string;
  cidadao: string;
  cidadao_nome: string;
  nome_da_pessoa: string;
  tipo: string;
  tipo_rotulo?: string | null;
  tipo_outro?: string | null;
  descricao?: string | null;
  // Escrita quando o mesmo benefício já tinha sido concedido no mês.
  justificativa_duplicidade?: string | null;
  registrado_por?: string | null;
  registrado_por_nome?: string | null;
  unidade?: string | null;
  unidade_nome?: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type SituacaoDoEncaminhamento = "PENDENTE" | "ACEITO" | "RECUSADO" | "CONCLUIDO";

export type CategoriaDoMotivo =
  | "VIOLACAO_DE_DIREITOS"
  | "SITUACAO_DE_RUA"
  | "ACOMPANHAMENTO_FAMILIAR"
  | "BENEFICIO_EVENTUAL"
  | "SAUDE"
  | "DOCUMENTACAO"
  | "OUTRO";

export type Urgencia = "BAIXA" | "NORMAL" | "ALTA" | "URGENTE";

/** O que a recepção vê de um encaminhamento: quem, de onde, quando e a categoria. Sem o relato. */
export type EncaminhamentoResumo = {
  id: string;
  cidadao: string;
  cidadao_nome: string;
  situacao: SituacaoDoEncaminhamento;
  categoria_do_motivo: CategoriaDoMotivo;
  categoria_rotulo: string;
  urgencia: Urgencia;
  urgencia_rotulo: string;
  prazo?: string | null;
  unidade_origem?: string | null;
  unidade_origem_nome?: string | null;
  unidade_destino?: string | null;
  unidade_destino_nome?: string | null;
  destino_externo: string;
  chegou_em?: string | null;
  concluido_em?: string | null;
  criado_em: string;
};

/** O encaminhamento como os técnicos o veem: tudo. */
export type Encaminhamento = EncaminhamentoResumo & {
  caso: string;
  caso_protocolo: string;
  motivo: string;
  resumo_da_situacao: string;
  documentos_entregues?: string | null;
  contato_para_retorno?: string | null;
  observacoes?: string | null;
  encaminhado_por_nome: string;
  respondido_por_nome?: string | null;
  respondido_em?: string | null;
  resposta?: string | null;
  resultado?: string | null;
};

/** A fotografia do que a origem sabia ao encaminhar. */
export type FichaDoEncaminhamento = {
  gerada_em: string;
  unidade_origem: string;
  protocolo: string;
  aberto_em: string;
  prioridade: string;
  servico: { nome: string; categoria: string | null } | null;
  solicitado: Array<{ quando: string; unidade: string; demanda: string; desfecho: string; observacao: string | null }>;
  relato: string | null;
  beneficios_concedidos: Array<{ quando: string; unidade: string | null; tipo: string; descricao: string | null }>;
};

export type EncaminhamentoDetalhe = Encaminhamento & { ficha: FichaDoEncaminhamento | null };

export type TipoDeAviso =
  | "ENCAMINHAMENTO_RECEBIDO"
  | "ENCAMINHAMENTO_ACEITO"
  | "ENCAMINHAMENTO_RECUSADO"
  | "PESSOA_CHEGOU"
  | "ENCAMINHAMENTO_CONCLUIDO"
  | "NAO_COMPARECEU"
  | "ENCAMINHADO_ADIANTE"
  | "BENEFICIO_REPETIDO";

export type Aviso = {
  id: string;
  tipo: TipoDeAviso;
  titulo: string;
  mensagem: string;
  cidadao?: string | null;
  cidadao_nome?: string | null;
  encaminhamento?: string | null;
  criado_em: string;
  lido: boolean;
  lido_em?: string | null;
};

export type ResumoDosAvisos = {
  avisos_nao_lidos: number;
  encaminhamentos_pendentes: number;
};

/** Um auxílio já concedido ou pedido dentro da janela do tipo, em qualquer unidade. */
export type AlertaDeDuplicidade = {
  origem: "beneficio" | "atendimento";
  quando: string;
  unidade: string;
  unidade_id: string | null;
  o_que: string;
  detalhe: string | null;
  /** A janela que se aplicou: "neste mês" ou, no auxílio de nascimento, "nos últimos 12 meses". */
  periodo: string;
};

export type RespostaDeDuplicidade = {
  alertas: AlertaDeDuplicidade[];
  exige_justificativa: boolean;
};

export type PainelRecepcao = {
  atendimentos_hoje: number;
  finalizados_no_balcao: number;
  encaminhados_para_fila: number;
  aguardando_na_fila: number;
  em_atendimento: number;
  ultimos_atendimentos: AtendimentoRecepcao[];
};

export type Caso = {
  id: string;
  protocolo: string;
  situacao: string;
  prioridade: string;
  descricao?: string | null;
  cidadao: string;
  cidadao_nome: string;
  unidade_nome: string;
  tecnico_nome?: string | null;
  servico?: string | null;
  servico_nome?: string | null;
  acao_itinerante?: string | null;
  acao_itinerante_titulo?: string | null;
  acao_itinerante_local?: string | null;
  aberto_em: string;
  fechado_em?: string | null;
};

export type PainelAtendente = {
  atendidos_hoje: number;
  aguardando_na_fila: number;
  em_atendimento: number;
  finalizados_hoje: number;
  casos_em_acompanhamento: number;
  ultimos_atendimentos: Caso[];
};

export type EntradaHistorico = {
  quando: string;
  unidade: string;
  o_que: string;
  detalhe: string | null;
  quem_atendeu: string | null;
  no_mes_corrente: boolean;
  e_de_outra_unidade: boolean;
};

export type Anexo = {
  id: string;
  tipo_documento: string;
  mime: string;
  tamanho: number;
  // Anexos anteriores ao registro da data não a têm.
  enviado_em?: string | null;
};

export type TipoDeAnexo = {
  valor: string;
  rotulo: string;
};

export type ProntuarioCidadao = {
  cidadao: Cidadao;
  historico: EntradaHistorico[];
  casos: Caso[];
  atendimentos_recepcao: AtendimentoRecepcao[];
  beneficios_eventuais: BeneficioEventual[];
  encaminhamentos: Encaminhamento[];
  senhas: Senha[];
  anexos: Anexo[];
  tipos_de_anexo: TipoDeAnexo[];
  membros_da_familia: Record<string, unknown>[];
  socioeconomico: Record<string, unknown>;
  documentos: Record<string, unknown>;
  endereco_detalhado: Record<string, unknown>;
};

export type AcaoItinerante = {
  id: string;
  titulo: string;
  descricao?: string | null;
  local: string;
  data: string;
  observacoes?: string | null;
  unidade: string;
  unidade_nome: string;
  responsavel: string;
  responsavel_nome: string;
  ativa: boolean;
  participantes: number;
  cidadaos_atendidos: number;
  beneficios_concedidos: number;
  casos_abertos: number;
  concluida: boolean;
};

export type BalancoAcaoItinerante = AcaoItinerante & {
  balanco: {
    cidadaos_cadastrados: number;
    casos_abertos_vinculados: number;
    beneficios_vinculados: number;
    participantes: number;
    cidadaos_atendidos: number;
    beneficios_concedidos: number;
    casos_abertos: number;
    concluida: boolean;
  };
};

export type ResumoAcoesItinerantes = {
  total_cidadaos: number;
  total_casos: number;
  total_beneficios: number;
  total_acoes: number;
  total_concluidas: number;
};
