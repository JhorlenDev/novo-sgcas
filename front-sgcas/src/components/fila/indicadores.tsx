"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SecondaryButton } from "@/components/ui";
import { INDICADORES, type DetalhesIndicador, type Indicador, type SenhaAberta } from "@/components/fila/tipos";
import { rotuloPrioridade, rotuloSituacao } from "@/lib/casos";
import { formatarDataCurta } from "@/lib/datas";

/** Os registros por trás de um número do painel (atendidos hoje, aguardando...). */
export function DetalhesDoIndicador({
  indicador,
  detalhes,
  erro,
  onFechar,
  onTentarDeNovo,
}: {
  indicador: Indicador | null;
  detalhes: DetalhesIndicador | null;
  erro: string;
  onFechar: () => void;
  onTentarDeNovo: (indicador: Indicador) => void;
}) {
  return (
    <Dialog open={indicador !== null} onOpenChange={(open) => { if (!open) onFechar(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{indicador ? INDICADORES[indicador].titulo : "Registros"}</DialogTitle>
          <DialogDescription>{indicador ? INDICADORES[indicador].descricao : ""}</DialogDescription>
        </DialogHeader>
        {erro ? <div role="alert" className="grid gap-3"><p className="text-sm">{erro}</p><SecondaryButton className="w-fit" onClick={() => indicador && onTentarDeNovo(indicador)}>Tentar novamente</SecondaryButton></div>
          : !detalhes ? <p className="text-sm text-meta-slate" role="status">Carregando registros...</p>
          : detalhes.registros.length === 0 ? <p className="text-sm text-meta-slate">Nenhum registro neste indicador.</p>
          : <div>
            <p className="mb-1 text-sm text-meta-slate">{detalhes.registros.length} registro(s)</p>
            <ul>
              {detalhes.tipo === "senhas" ? detalhes.registros.map((senha) => (
                <li key={senha.id} className="line-row">
                  <strong className="block">{senha.senha} · {senha.cidadao_nome}</strong>
                  <span className="block">{senha.servico || "Serviço não informado"}</span>
                  <small>{rotuloPrioridade(senha.prioridade)} · {formatarDataCurta(senha.criado_em)}</small>
                </li>
              )) : detalhes.registros.map((caso) => (
                <li key={caso.id} className="line-row">
                  <strong className="block">{caso.protocolo} · {caso.cidadao_nome}</strong>
                  <span className="block">{caso.servico_nome || caso.descricao || "Serviço não informado"}</span>
                  <span className="block">{rotuloSituacao(caso.situacao)}</span>
                  <small>{caso.tecnico_nome || "Sem técnico responsável"} · {caso.unidade_nome}</small>
                </li>
              ))}
            </ul>
          </div>}
      </DialogContent>
    </Dialog>
  );
}

/** As senhas em atendimento na unidade: a própria se retoma, a dos outros só se vê. */
export function SenhasEmAtendimento({
  aberta,
  onAbertaChange,
  carregando,
  erro,
  senhas,
  retomando,
  onListar,
  onRetomar,
}: {
  aberta: boolean;
  onAbertaChange: (aberta: boolean) => void;
  carregando: boolean;
  erro: string;
  senhas: SenhaAberta[];
  retomando: string | null;
  onListar: () => void;
  onRetomar: (senhaId: string) => void;
}) {
  return (
    <Dialog open={aberta} onOpenChange={onAbertaChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Senhas em atendimento</DialogTitle>
          <DialogDescription>Selecione uma senha sua para reabrir em Atendimento atual. As demais mostram quem está atendendo.</DialogDescription>
        </DialogHeader>
        {carregando ? <p className="text-sm text-meta-slate" role="status">Carregando atendimentos...</p> : erro ? (
          <div role="alert" className="grid gap-3"><p className="text-sm">{erro}</p><SecondaryButton className="w-fit" onClick={onListar}>Tentar novamente</SecondaryButton></div>
        ) : senhas.length === 0 ? <p className="text-sm text-meta-slate">Nenhuma senha em atendimento nesta unidade.</p> : (
          <div className="grid gap-2.5">
            {senhas.map((senha) => (
              <button key={senha.id} type="button" className="rounded-lg border border-meta-divider bg-white p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-meta-warm-gray disabled:opacity-60 disabled:hover:border-meta-divider disabled:hover:bg-white" disabled={!senha.pode_retomar || retomando !== null} onClick={() => onRetomar(senha.id)}>
                <strong className="block text-sm">{senha.senha} · {senha.cidadao_nome}</strong>
                <span className="block text-sm">{senha.servico}</span>
                <small className="block text-meta-slate">{senha.operador_nome ?? "Sem atendente"} · {retomando === senha.id ? "Abrindo..." : senha.pode_retomar ? "Retomar atendimento" : "Com outro atendente"}</small>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
