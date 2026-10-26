"use client";

export function TermoLGPD() {
  return (
    <div className="space-y-5 text-sm leading-relaxed text-meta-charcoal">
      <h3 className="text-lg font-bold text-meta-near-black">Termo de Consentimento e Autorização</h3>

      <section>
        <h4 className="font-semibold">1. Controlador dos Dados</h4>
        <p>
          Prefeitura Municipal de Tefé, inscrita no CNPJ sob o nº
          [XX.XXX.XXX/XXXX-XX], com sede em [ENDEREÇO COMPLETO],
          doravante denominada &quot;Controlador&quot;.
        </p>
      </section>

      <section>
        <h4 className="font-semibold">2. Dados Coletados</h4>
        <p>Os seguintes dados pessoais serão coletados:</p>
        <ul className="ml-5 list-disc">
          <li>Nome completo</li>
          <li>CPF (Cadastro de Pessoa Física)</li>
          <li>NIS (Número de Identificação Social)</li>
          <li>RG (Registro Geral)</li>
          <li>Data de nascimento</li>
          <li>Sexo</li>
          <li>Endereço completo</li>
          <li>E-mail</li>
          <li>Telefone</li>
        </ul>
      </section>

      <section>
        <h4 className="font-semibold">3. Finalidade do Tratamento</h4>
        <p>Os dados serão utilizados exclusivamente para:</p>
        <ul className="ml-5 list-disc">
          <li>Cadastro e controle de acesso às instalações</li>
          <li>Registro de atendimentos e uso de serviços</li>
          <li>Gestão administrativa e estatística</li>
          <li>Cumprimento de obrigações legais</li>
        </ul>
      </section>

      <section>
        <h4 className="font-semibold">4. Base Legal (Art. 7 da LGPD)</h4>
        <p>O tratamento dos seus dados é realizado com base em:</p>
        <ul className="ml-5 list-disc">
          <li><strong>Art. 7, III</strong> - Execução de políticas públicas</li>
          <li><strong>Art. 11, II, &quot;b&quot;</strong> - Tratamento de dados sensíveis quando indispensável</li>
        </ul>
      </section>

      <section>
        <h4 className="font-semibold">5. Compartilhamento de Dados</h4>
        <p>Os dados poderão ser compartilhados com:</p>
        <ul className="ml-5 list-disc">
          <li>Órgãos públicos quando exigido por lei</li>
          <li>Sistema Tefé Cidadão para criação de conta (apenas com seu consentimento)</li>
        </ul>
      </section>

      <section>
        <h4 className="font-semibold">6. Seus Direitos (Art. 18 da LGPD)</h4>
        <p>Você tem direito a:</p>
        <ul className="ml-5 list-disc">
          <li>Confirmar a existência de tratamento</li>
          <li>Acessar seus dados</li>
          <li>Corrigir dados incompletos ou desatualizados</li>
          <li>Anonimizar, bloquear ou eliminar dados desnecessários</li>
          <li>Portabilidade dos dados</li>
          <li>Eliminar dados tratados com consentimento</li>
          <li>Revogar o consentimento a qualquer momento</li>
        </ul>
      </section>

      <section>
        <h4 className="font-semibold">7. Prazo de Retenção</h4>
        <p>
          Os dados serão mantidos pelo período necessário ao cumprimento
          das finalidades descritas, observados os prazos legais aplicáveis.
        </p>
      </section>

      <section>
        <h4 className="font-semibold">8. Segurança dos Dados</h4>
        <p>
          Adotamos medidas técnicas e administrativas para proteger seus
          dados, incluindo criptografia, controle de acesso e auditoria.
        </p>
      </section>

      <section>
        <h4 className="font-semibold">9. Encarregado de Dados (DPO)</h4>
        <p>
          Em caso de dúvidas, entre em contato com nosso Encarregado:<br />
          Nome: [NOME DO DPO]<br />
          E-mail: [EMAIL DO DPO]<br />
          Telefone: [TELEFONE DO DPO]
        </p>
      </section>

      <section>
        <h4 className="font-semibold">10. Consentimento para Criação de Conta</h4>
        <p>
          <strong>ATENÇÃO:</strong> Ao marcar a opção &quot;Criar acesso no portal&quot;,
          você autoriza o envio dos seguintes dados mínimos para criação da sua conta:
        </p>
        <ul className="ml-5 list-disc">
          <li>Nome e sobrenome</li>
          <li>CPF</li>
          <li>E-mail</li>
          <li>Telefone</li>
          <li>Data de nascimento</li>
          <li>Sexo</li>
          <li>Endereço</li>
        </ul>
        <p>
          <strong>Este consentimento é OPCIONAL.</strong> Se não desejar criar
          conta, basta desmarcar a opção. Isso não afetará seu atendimento.
        </p>
      </section>
    </div>
  );
}
