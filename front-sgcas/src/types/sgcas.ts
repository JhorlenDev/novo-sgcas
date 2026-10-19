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
  demanda_nome?: string | null;
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
  registrado_por?: string | null;
  registrado_por_nome?: string | null;
  unidade?: string | null;
  unidade_nome?: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type Encaminhamento = {
  id: string;
  caso: string;
  situacao: string;
  motivo: string;
  observacoes?: string | null;
  unidade_destino?: string | null;
  unidade_destino_nome?: string | null;
  destino_externo: string;
  encaminhado_por_nome: string;
  criado_em: string;
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

export type ProntuarioCidadao = {
  cidadao: Cidadao;
  historico: EntradaHistorico[];
  casos: Caso[];
  atendimentos_recepcao: AtendimentoRecepcao[];
  beneficios_eventuais: BeneficioEventual[];
  encaminhamentos: Encaminhamento[];
  senhas: Senha[];
  anexos: Record<string, unknown>[];
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
