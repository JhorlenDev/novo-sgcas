"use client";

import { FormEvent, useEffect, useState } from "react";
import { Building2, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button, PageHeader, SecondaryButton } from "@/components/ui";
import {
  SEM_CLASSIFICACAO, corpoDaClassificacao, type Classificacao,
} from "@/components/institucional/classificacao";
import { JanelaClassificar, JanelaNovaUnidade, JanelaNovoServico } from "@/components/institucional/janelas";
import { TabelaDeServicos, TabelaDeUnidades } from "@/components/institucional/tabelas";
import { api, avisoDeCarga, lerOuPadrao, mensagemDaApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Coordenacao, Demanda, Servico, Unidade } from "@/types/sgcas";

export default function InstitucionalPage() {
  const { user } = useAuth();
  const [classificacao, setClassificacao] = useState<Classificacao>(SEM_CLASSIFICACAO);
  const [editando, setEditando] = useState<Servico | null>(null);
  const [edicao, setEdicao] = useState<Classificacao>(SEM_CLASSIFICACAO);
  const [erroDaEdicao, setErroDaEdicao] = useState("");
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [coordenacoes, setCoordenacoes] = useState<Coordenacao[]>([]);
  const [demandas, setDemandas] = useState<Demanda[]>([]);
  const [mensagem, setMensagem] = useState("");
  const [erroCarga, setErroCarga] = useState("");
  const [modalUnidade, setModalUnidade] = useState(false);
  const [modalServico, setModalServico] = useState(false);
  // O erro de cada cadastro aparece na janela dele, que continua aberta: atrás dela ninguém o veria.
  const [erroDaUnidade, setErroDaUnidade] = useState("");
  const [erroDoServico, setErroDoServico] = useState("");
  const [salvando, setSalvando] = useState(false);
  // A rede tem dezenas de serviços: filtrar por unidade e por nome evita rolar a lista inteira.
  const [filtroDeUnidade, setFiltroDeUnidade] = useState("");
  const [busca, setBusca] = useState("");

  const servicosVisiveis = servicos.filter((servico) => {
    if (filtroDeUnidade && servico.unidade !== filtroDeUnidade) return false;
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return !termo || servico.nome.toLocaleLowerCase("pt-BR").includes(termo);
  });

  async function carregar() {
    const falhas: string[] = [];
    const [units, services, coords, demands] = await Promise.all([
      lerOuPadrao<Unidade[]>("/institutional/units", [], () => falhas.push("as unidades")),
      lerOuPadrao<Servico[]>("/institutional/services?unidade=todas", [], () => falhas.push("os serviços")),
      lerOuPadrao<Coordenacao[]>("/institutional/coordinations", [], () => falhas.push("as coordenações")),
      lerOuPadrao<Demanda[]>("/institutional/demands", [], () => falhas.push("as categorias")),
    ]);
    setErroCarga(avisoDeCarga(falhas));

    setUnidades(units);
    setServicos(services);
    setCoordenacoes(coords);
    setDemandas(demands);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void carregar();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function criarUnidade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMensagem("");
    setErroDaUnidade("");
    setSalvando(true);

    // Depois do `await` o React já anulou `event.currentTarget`: o formulário é guardado antes.
    // Sem isso, `reset()` lançava erro, e a unidade criada aparecia como "não foi possível".
    const formulario = event.currentTarget;
    const form = new FormData(formulario);
    try {
      await api("/institutional/units", {
        method: "POST",
        body: JSON.stringify({
          nome: form.get("nome"),
          sigla: form.get("sigla"),
          tipo: form.get("tipo"),
          endereco: form.get("endereco") || null,
          telefone: form.get("telefone") || null,
          coordenacao_id: form.get("coordenacao_id") || null,
        }),
      });
      setMensagem("Unidade cadastrada.");
      setModalUnidade(false);
      formulario.reset();
      await carregar();
    } catch (error) {
      setErroDaUnidade(mensagemDaApi(error, "Não foi possível cadastrar a unidade. Confira sigla e campos obrigatórios."));
    } finally {
      setSalvando(false);
    }
  }

  // O administrador classifica os serviços de qualquer unidade; o coordenador, os da sua.
  function podeClassificar(servico: Servico) {
    return user?.papel === "ADMIN" || (user?.papel === "COORDENADOR" && servico.unidade === user.unidade?.id);
  }

  function abrirClassificacao(servico: Servico) {
    setEdicao({ demandaId: servico.demanda_id ?? "", tipo: servico.tipo_de_beneficio ?? "" });
    setErroDaEdicao("");
    setEditando(servico);
  }

  async function salvarClassificacao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editando) return;
    setErroDaEdicao("");
    setSalvando(true);
    try {
      await api(`/institutional/services/${editando.id}`, {
        method: "PATCH",
        body: JSON.stringify(corpoDaClassificacao(edicao, demandas)),
      });
      setEditando(null);
      await carregar();
      setMensagem("Classificação do serviço atualizada.");
    } catch (error) {
      setErroDaEdicao(mensagemDaApi(error, "Não foi possível atualizar o serviço."));
    } finally {
      setSalvando(false);
    }
  }

  async function criarServico(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMensagem("");
    setErroDoServico("");
    setSalvando(true);

    const formulario = event.currentTarget;
    const form = new FormData(formulario);
    try {
      await api("/institutional/services", {
        method: "POST",
        body: JSON.stringify({
          nome: form.get("nome"),
          descricao: form.get("descricao") || null,
          unidade_id: form.get("unidade_id"),
          ...corpoDaClassificacao(classificacao, demandas),
        }),
      });
      setMensagem("Serviço cadastrado.");
      setModalServico(false);
      formulario.reset();
      setClassificacao(SEM_CLASSIFICACAO);
      await carregar();
    } catch (error) {
      setErroDoServico(mensagemDaApi(error, "Não foi possível cadastrar o serviço. Confira unidade e nome."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Institucional"
        description="Gerencie as unidades da rede e os serviços disponíveis para atendimento."
        action={
          <>
            <SecondaryButton type="button" onClick={() => { setErroDaUnidade(""); setModalUnidade(true); }}>
              <Building2 size={16} aria-hidden="true" />
              Nova unidade
            </SecondaryButton>
            <Button type="button" onClick={() => { setErroDoServico(""); setModalServico(true); }} disabled={unidades.length === 0}>
              <Plus size={16} aria-hidden="true" />
              Novo serviço
            </Button>
          </>
        }
      />

      {erroCarga && <div className="notice mb-4" role="alert">{erroCarga}</div>}
      {mensagem && <div className="notice mb-4" role="status">{mensagem}</div>}

      <div className="grid gap-4">
        <TabelaDeUnidades unidades={unidades} />
        <TabelaDeServicos
          servicos={servicos}
          visiveis={servicosVisiveis}
          unidades={unidades}
          filtroDeUnidade={filtroDeUnidade}
          onFiltroDeUnidade={setFiltroDeUnidade}
          busca={busca}
          onBusca={setBusca}
          podeClassificar={podeClassificar}
          onClassificar={abrirClassificacao}
        />
      </div>

      <JanelaNovaUnidade
        aberta={modalUnidade}
        onAbertaChange={setModalUnidade}
        coordenacoes={coordenacoes}
        erro={erroDaUnidade}
        salvando={salvando}
        onSalvar={criarUnidade}
      />

      <JanelaNovoServico
        aberta={modalServico}
        onAbertaChange={setModalServico}
        unidades={unidades}
        demandas={demandas}
        classificacao={classificacao}
        onClassificacao={setClassificacao}
        erro={erroDoServico}
        salvando={salvando}
        onSalvar={criarServico}
      />

      <JanelaClassificar
        servico={editando}
        onFechar={() => setEditando(null)}
        demandas={demandas}
        valor={edicao}
        onChange={setEdicao}
        erro={erroDaEdicao}
        salvando={salvando}
        onSalvar={salvarClassificacao}
      />
    </AppShell>
  );
}
