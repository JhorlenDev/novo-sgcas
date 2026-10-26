import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const scenario of ['sucesso', 'vazia', 'sem-permissao', 'sem-unidade', 'recepcionista', 'servidor', 'recuperacao-indisponivel']) {
    const page = await browser.newPage();
    let calls = 0;
    let queueUrl;
    let current = null;
    const senha = { id: 's1', senha: 'A001', cidadao_nome: 'Pessoa de teste', servico: 'Orientação', prioridade: 'NORMAL', criado_em: '2026-09-09T12:00:00Z' };
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      let data = [];
      let status = 200;
      if (url.pathname === '/api/auth/me') data = { id: 'u1', nome: 'Operador teste', papel: scenario === 'recepcionista' ? 'RECEPCIONISTA' : 'ADMIN', ativo: true, unidade: scenario === 'sem-unidade' ? null : { id: 'unidade-1', nome: 'Unidade teste' } };
      if (url.pathname === '/api/queues/') { queueUrl = url; data = calls && scenario === 'sucesso' ? [] : [senha]; }
      if (url.pathname.startsWith('/api/queues/painel/')) {
        const group = url.pathname.split('/').pop();
        data = group === 'aguardando_na_fila' ? { tipo: 'senhas', registros: [] } : group === 'atendidos_hoje' ? { tipo: 'senhas', registros: [senha] } : { tipo: 'casos', registros: [{ id: 'c1', protocolo: 'CASO-001', cidadao_nome: 'Pessoa de teste', situacao: 'CONCLUIDO', unidade_nome: 'Unidade teste' }] };
      }
      if (url.pathname === '/api/queues/em-atendimento') data = [{ ...senha, id: 'antiga', senha: 'A002', operador_nome: 'Operador teste', pode_retomar: true }, { ...senha, id: 'outra', senha: 'A003', operador_nome: 'Outro operador', pode_retomar: false }];
      if (url.pathname === '/api/queues/antiga/retomar') data = { senha: { ...senha, id: 'antiga', senha: 'A002' }, cidadao: { nome: 'Pessoa de teste' }, caso: null, historico: [] };
      if (url.pathname === '/api/queues/atendimento-atual') { data = current; if (scenario === 'recuperacao-indisponivel') status = 500; }
      if (url.pathname === '/api/queues/painel') data = { aguardando_na_fila: 1, ultimos_atendimentos: [] };
      if (url.pathname === '/api/queues/chamar-proximo') {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 150));
        if (scenario === 'sucesso') { data = { senha, cidadao: { nome: 'Pessoa de teste' }, caso: null, historico: [] }; current = data; }
        if (scenario === 'vazia') { status = 404; data = { detalhe: 'Não há ninguém aguardando' }; }
        if (scenario === 'sem-permissao') { status = 403; data = { detail: 'Sem permissão para chamar.' }; }
        if (scenario === 'servidor') return route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad Gateway</html>' });
      }
      await route.fulfill({ status, json: data });
    });
    await page.goto(`${process.env.TEST_BASE_URL ?? 'http://localhost:3000'}/fila/`);
    const button = page.getByRole('button', { name: 'Chamar próximo', exact: true });
    await expect(button).toBeVisible();
    if (scenario === 'sem-unidade' || scenario === 'recepcionista' || scenario === 'recuperacao-indisponivel') {
      await expect(button).toBeDisabled();
      expect(calls).toBe(0);
    } else {
      await expect(page.getByText('A001', { exact: true })).toBeVisible();
      expect(queueUrl.searchParams.get('unidade')).toBe('unidade-1');
      await button.dblclick();
      if (scenario === 'sucesso') {
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Conferir senha A001' })).toBeVisible();
        await page.getByRole('button', { name: 'Conferir depois' }).click();
        await expect(button).toBeDisabled();
        await page.goto(`${process.env.TEST_BASE_URL ?? 'http://localhost:3000'}/dashboard/`);
        await page.goto(`${process.env.TEST_BASE_URL ?? 'http://localhost:3000'}/fila/`);
        await expect(page.getByRole('button', { name: 'Abrir conferência' })).toBeVisible();
        await page.reload();
        await page.getByRole('button', { name: 'Abrir conferência' }).click();
        await expect(page.getByRole('heading', { name: 'Conferir senha A001' })).toBeVisible();
        await page.getByRole('button', { name: 'Conferir depois' }).click();
        await page.getByRole('button', { name: 'Ver em atendimento' }).click();
        await expect(page.getByRole('button', { name: /A003/ })).toBeDisabled();
        await page.getByRole('button', { name: /A002/ }).click();
        await expect(page.getByRole('status')).toHaveText('Senha A002 recuperada em Atendimento atual.');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.getByRole('button', { name: 'Abrir conferência' }).click();
        await expect(page.getByRole('heading', { name: 'Conferir senha A002' })).toBeVisible();
        await page.getByRole('button', { name: 'Conferir depois' }).click();
        for (const label of ['atendidos hoje', 'aguardando na fila', 'finalizados', 'acompanhamento']) {
          await page.getByRole('button', { name: `Ver ${label}`, exact: true }).click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible();
          await expect(dialog).toContainText(label === 'aguardando na fila' ? 'Nenhum registro neste indicador.' : label === 'atendidos hoje' ? 'A001' : 'CASO-001');
          await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
        }
      } else {
        const message = scenario === 'vazia' ? 'Não há ninguém aguardando' : scenario === 'sem-permissao' ? 'Sem permissão para chamar.' : 'O servidor retornou uma resposta inválida. Tente novamente.';
        await expect(page.getByRole('status')).toHaveText(message);
        await expect(button).toBeEnabled();
      }
      expect(calls).toBe(1);
    }
    console.log(`PASS: ${scenario}`);
    await page.close();
  }
} finally {
  await browser.close();
}
