"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, CheckCheck, Inbox, Send } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { DetalheDoEncaminhamento } from "@/components/encaminhamentos/detalhe";
import { CabecalhoDoEncaminhamento } from "@/components/encaminhamentos/ficha";
import { Badge, Button, Card, EmptyState, PageHeader, SecondaryButton, Select } from "@/components/ui";
import { api, mensagemDaApi } from "@/lib/api";
import { avisarQueOsAvisosMudaram } from "@/lib/avisos";
import { avisoPedeAtencao, formatarDataHora } from "@/lib/encaminhamentos";
import { cn } from "@/lib/utils";
import type { Aviso, Encaminhamento, EncaminhamentoResumo } from "@/types/sgcas";

type Aba = "recebidos" | "enviados" | "avisos";
type Filtro = "abertos" | "todos";

// A lista traz a ficha completa só para a equipe técnica; para a recepção, o resumo.
type Item = EncaminhamentoResumo | Encaminhamento;

export default function EncaminhamentosPage() {
  const [aba, setAba] = useState<Aba>("recebidos");
  // Recebidos é a fila de trabalho: só o que espera. Enviados é o acompanhamento: o que
  // já terminou também interessa, é a resposta a "em que pé anda o atendimento".
  const [filtros, setFiltros] = useState<Record<"recebidos" | "enviados", Filtro>>({ recebidos: "abertos", enviados: "todos" });
  const [recebidos, setRecebidos] = useState<Item[] | null>(null);
  const [enviados, setEnviados] = useState<Item[] | null>(null);
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [chegaram, sairam, notificacoes] = await Promise.all([
        api<Item[]>(`/referrals/recebidos?situacao=${filtros.recebidos}`),
        api<Item[]>(`/referrals/enviados?situacao=${filtros.enviados}`),
        api<Aviso[]>("/notices/"),
      ]);
      setRecebidos(chegaram);
      setEnviados(sairam);
      setAvisos(notificacoes);
      setErro("");
    } catch (error) {
      setErro(mensagemDaApi(error, "Não foi possível carregar os encaminhamentos."));
    }
  }, [filtros]);

  useEffect(() => {
    const timer = window.setTimeout(() => void carregar(), 0);
    return () => window.clearTimeout(timer);
  }, [carregar]);

  const pendentes = recebidos?.filter((e) => e.situacao === "PENDENTE").length ?? 0;
  const naoLidos = avisos?.filter((a) => !a.lido).length ?? 0;

  async function marcarComoLido(aviso: Aviso) {
    try {
      await api(`/notices/${aviso.id}/lido`, { method: "POST" });
      setAvisos((atual) => atual?.map((a) => (a.id === aviso.id ? { ...a, lido: true } : a)) ?? null);
      avisarQueOsAvisosMudaram();
    } catch (error) {
      setErro(mensagemDaApi(error, "Não foi possível marcar o aviso como lido."));
    }
  }

  async function marcarTodosComoLidos() {
    try {
      await api("/notices/lidos", { method: "POST" });
      setAvisos((atual) => atual?.map((a) => ({ ...a, lido: true })) ?? null);
      avisarQueOsAvisosMudaram();
    } catch (error) {
      setErro(mensagemDaApi(error, "Não foi possível marcar os avisos como lidos."));
    }
  }

  function aoMudar() {
    void carregar();
    avisarQueOsAvisosMudaram();
  }

  return (
    <AppShell>
      <PageHeader
        title="Encaminhamentos"
        description="Quem chegou à sua unidade vindo de outra, o que aconteceu com quem a sua unidade encaminhou e os avisos entre as unidades."
      />

      {erro && <div className="notice" role="alert">{erro}</div>}

      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-card border border-meta-divider bg-white p-2 shadow-lift" role="tablist">
        <AbaBotao ativa={aba === "recebidos"} onClick={() => setAba("recebidos")}>
          <Inbox size={17} /> Recebidos
          <Badge tone={pendentes ? "warn" : "neutral"}>{pendentes ? `${pendentes} aguardando` : recebidos?.length ?? 0}</Badge>
        </AbaBotao>
        <AbaBotao ativa={aba === "enviados"} onClick={() => setAba("enviados")}>
          <Send size={17} /> Enviados
          <Badge tone="neutral">{enviados?.length ?? 0}</Badge>
        </AbaBotao>
        <AbaBotao ativa={aba === "avisos"} onClick={() => setAba("avisos")}>
          <BellRing size={17} /> Avisos
          <Badge tone={naoLidos ? "bad" : "neutral"}>{naoLidos ? `${naoLidos} novo(s)` : avisos?.length ?? 0}</Badge>
        </AbaBotao>
        {aba !== "avisos" && (
          <label className="ml-auto flex items-center gap-2 text-sm text-meta-slate">
            Mostrar
            <Select
              value={filtros[aba]}
              onChange={(event) => setFiltros((atual) => ({ ...atual, [aba]: event.target.value as Filtro }))}
              className="!h-9 !w-auto"
            >
              <option value="abertos">Em aberto</option>
              <option value="todos">Todos</option>
            </Select>
          </label>
        )}
      </div>

      {aba === "recebidos" && (
        <ListaDeEncaminhamentos
          itens={recebidos}
          vazio={{ titulo: "Nenhum encaminhamento recebido", texto: "Quando outra unidade encaminhar alguém para a sua, aparece aqui, do mais urgente para o menos urgente." }}
          onAbrir={setAberto}
        />
      )}

      {aba === "enviados" && (
        <ListaDeEncaminhamentos
          itens={enviados}
          vazio={{ titulo: "Nenhum encaminhamento enviado", texto: "O que a sua unidade encaminhar aparece aqui, com a resposta do destino." }}
          onAbrir={setAberto}
        />
      )}

      {aba === "avisos" && (
        <ListaDeAvisos
          avisos={avisos}
          onLido={marcarComoLido}
          onTodosLidos={marcarTodosComoLidos}
          onAbrir={setAberto}
        />
      )}

      <DetalheDoEncaminhamento id={aberto} onClose={() => setAberto(null)} onMudou={aoMudar} />
    </AppShell>
  );
}

function AbaBotao({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-pill px-4 py-2 text-sm font-semibold transition-colors",
        ativa ? "bg-primary text-primary-foreground shadow-lift" : "text-meta-charcoal hover:bg-meta-soft-gray",
      )}
    >
      {children}
    </button>
  );
}

function ListaDeEncaminhamentos({
  itens,
  vazio,
  onAbrir,
}: {
  itens: Item[] | null;
  vazio: { titulo: string; texto: string };
  onAbrir: (id: string) => void;
}) {
  if (itens === null) return <p className="text-sm text-meta-slate">Carregando...</p>;
  if (itens.length === 0) return <EmptyState title={vazio.titulo} text={vazio.texto} />;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {itens.map((item) => (
        <Card key={item.id}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <strong className="text-base text-meta-charcoal">{item.cidadao_nome}</strong>
            <SecondaryButton type="button" className="h-9 shrink-0 px-3 text-xs" onClick={() => onAbrir(item.id)}>
              Abrir ficha
            </SecondaryButton>
          </div>
          <CabecalhoDoEncaminhamento encaminhamento={item} />
          {"motivo" in item && item.motivo && (
            <p className="mt-3 line-clamp-2 text-sm leading-6 text-meta-slate">{item.motivo}</p>
          )}
        </Card>
      ))}
    </div>
  );
}

function ListaDeAvisos({
  avisos,
  onLido,
  onTodosLidos,
  onAbrir,
}: {
  avisos: Aviso[] | null;
  onLido: (aviso: Aviso) => void;
  onTodosLidos: () => void;
  onAbrir: (id: string) => void;
}) {
  if (avisos === null) return <p className="text-sm text-meta-slate">Carregando...</p>;
  if (avisos.length === 0) {
    return <EmptyState title="Nenhum aviso" text="Os avisos entre as unidades — encaminhamentos, chegadas e repetições de auxílio — aparecem aqui." />;
  }
  const naoLidos = avisos.filter((a) => !a.lido).length;

  return (
    <div className="grid gap-3">
      {naoLidos > 0 && (
        <div className="flex justify-end">
          <SecondaryButton type="button" className="h-9 px-3 text-xs" onClick={onTodosLidos}>
            <CheckCheck size={15} /> Marcar todos como lidos
          </SecondaryButton>
        </div>
      )}
      {avisos.map((aviso) => (
        <article
          key={aviso.id}
          className={cn(
            "flex flex-col gap-3 rounded-card border p-4 sm:flex-row sm:items-center sm:justify-between",
            aviso.lido ? "border-meta-divider bg-white" : "border-primary/30 bg-primary/5",
          )}
        >
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge tone={aviso.lido ? "neutral" : avisoPedeAtencao(aviso.tipo) ? "warn" : "good"}>{aviso.titulo}</Badge>
              <small className="text-meta-slate">{formatarDataHora(aviso.criado_em)}</small>
            </div>
            <p className={cn("text-sm leading-6", aviso.lido ? "text-meta-slate" : "font-medium text-meta-charcoal")}>{aviso.mensagem}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {aviso.encaminhamento && (
              <SecondaryButton type="button" className="h-9 px-3 text-xs" onClick={() => onAbrir(aviso.encaminhamento as string)}>
                Ver encaminhamento
              </SecondaryButton>
            )}
            {!aviso.lido && (
              <Button type="button" className="h-9 px-3 text-xs" onClick={() => onLido(aviso)}>Marcar como lido</Button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
