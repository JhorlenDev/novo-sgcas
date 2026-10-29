"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, CheckCheck, Inbox, Send } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { DetalheDoEncaminhamento } from "@/components/encaminhamentos/detalhe";
import { CabecalhoDoEncaminhamento } from "@/components/encaminhamentos/ficha";
import { Aba, Abas, Badge, Button, Card, EmptyState, Field, PageHeader, SecondaryButton, Select } from "@/components/ui";
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

      {erro && <div className="notice mb-4" role="alert">{erro}</div>}

      <Abas
        rotulo="Caixas de encaminhamentos"
        lateral={
          aba !== "avisos" && (
            <div className="pb-3 md:w-56">
              <Field label="Mostrar">
                <Select
                  value={filtros[aba]}
                  onChange={(event) => setFiltros((atual) => ({ ...atual, [aba]: event.target.value as Filtro }))}
                >
                  <option value="abertos">Em aberto</option>
                  <option value="todos">Todos</option>
                </Select>
              </Field>
            </div>
          )
        }
      >
        <Aba ativa={aba === "recebidos"} onClick={() => setAba("recebidos")}>
          <Inbox size={16} aria-hidden="true" /> Recebidos
          <Badge tone={pendentes ? "warn" : "neutral"}>{pendentes ? `${pendentes} aguardando` : recebidos?.length ?? 0}</Badge>
        </Aba>
        <Aba ativa={aba === "enviados"} onClick={() => setAba("enviados")}>
          <Send size={16} aria-hidden="true" /> Enviados
          <Badge tone="neutral">{enviados?.length ?? 0}</Badge>
        </Aba>
        <Aba ativa={aba === "avisos"} onClick={() => setAba("avisos")}>
          <BellRing size={16} aria-hidden="true" /> Avisos
          <Badge tone={naoLidos ? "bad" : "neutral"}>{naoLidos ? `${naoLidos} novo(s)` : avisos?.length ?? 0}</Badge>
        </Aba>
      </Abas>

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
    <div className="grid gap-4 lg:grid-cols-2">
      {itens.map((item) => (
        <Card key={item.id}>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <strong className="min-w-0 text-base text-meta-charcoal">{item.cidadao_nome}</strong>
            <SecondaryButton type="button" size="sm" className="shrink-0" onClick={() => onAbrir(item.id)}>
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
    return <EmptyState title="Nenhum aviso" text="Os avisos entre as unidades (encaminhamentos, chegadas e repetições de auxílio) aparecem aqui." />;
  }
  const naoLidos = avisos.filter((a) => !a.lido).length;

  return (
    <div className="grid gap-3">
      {naoLidos > 0 && (
        <div className="flex justify-end">
          <SecondaryButton type="button" size="sm" onClick={onTodosLidos}>
            <CheckCheck size={15} aria-hidden="true" /> Marcar todos como lidos
          </SecondaryButton>
        </div>
      )}
      {avisos.map((aviso) => (
        <article
          key={aviso.id}
          className={cn(
            "flex flex-col gap-3 rounded-card border bg-white p-4 sm:flex-row sm:items-center sm:justify-between",
            aviso.lido ? "border-meta-divider" : "border-l-4 border-meta-divider border-l-primary",
          )}
        >
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge tone={aviso.lido ? "neutral" : avisoPedeAtencao(aviso.tipo) ? "warn" : "good"}>{aviso.titulo}</Badge>
              <small className="text-meta-slate">{formatarDataHora(aviso.criado_em)}</small>
            </div>
            <p className={cn("text-sm leading-6", aviso.lido ? "text-meta-slate" : "font-medium text-meta-charcoal")}>{aviso.mensagem}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {aviso.encaminhamento && (
              <SecondaryButton type="button" size="sm" onClick={() => onAbrir(aviso.encaminhamento as string)}>
                Ver encaminhamento
              </SecondaryButton>
            )}
            {!aviso.lido && (
              <Button type="button" size="sm" onClick={() => onLido(aviso)}>Marcar como lido</Button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
