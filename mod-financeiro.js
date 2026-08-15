// ══════════════════════════════════════════════════════════════════════
// MÓDULO: FINANCEIRO
//
// Caixa da imobiliária. Só administrador entra, e a trava está no banco, não
// só nesta tela: as políticas de `lancamento`, `conta_financeira` e
// `categoria_financeira` exigem admin. Esconder o menu sem travar o banco
// seria teatro.
//
// Seis vistas: Visão geral, A receber, A pagar, Lançamentos, Contas e
// cartões, Categorias.
//
// "A receber" e "A pagar" não são um filtro bonitinho de Lançamentos: são a
// tela de trabalho do dia. Ali cada linha tem o botão que fecha a pendência,
// e a lista vem ordenada por urgência, não por data de cadastro.
//
// O que o painel prioriza: VENCIDO acima de tudo. Receita e despesa do mês
// são informação; vencido é a única coisa daquela tela que exige ação hoje.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  let alvoEl = null, vista = 'visao';

  const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const brlCurto = v => {
    const n = Number(v || 0);
    return Math.abs(n) >= 1000
      ? 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil'
      : brl(n);
  };
  const dataBr = v => v ? new Date(v + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
  const hoje = () => new Date().toISOString().slice(0, 10);
  const mesAtual = () => hoje().slice(0, 7);

  const PERIODOS = [
    ['mensal', 'Todo mês', 1], ['bimestral', 'A cada 2 meses', 2],
    ['trimestral', 'A cada 3 meses', 3], ['semestral', 'A cada 6 meses', 6],
    ['anual', 'Uma vez por ano', 12],
  ];
  // Teto de parcelas geradas de uma vez. Sem ele, "todo mês até 2050" viraria
  // 300 linhas num clique sem querer.
  const MAX_PARCELAS = 60;

  // Somar mês preservando o dia, e grudando no último dia quando ele não
  // existe: vencimento dia 31 em fevereiro precisa cair em 28, não virar
  // 3 de março, que é o que o Date faz sozinho.
  function somarMeses(iso, n) {
    const [a, m, d] = iso.split('-').map(Number);
    const alvo = new Date(a, m - 1 + n, 1);
    const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
    alvo.setDate(Math.min(d, ultimo));
    return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(alvo.getDate()).padStart(2, '0')}`;
  }

  const TIPOS_CONTA = [
    ['banco', 'Conta bancária'], ['cartao', 'Cartão de crédito'],
    ['dinheiro', 'Dinheiro em caixa'], ['aplicacao', 'Aplicação'],
  ];

  async function montar(alvo, sub) {
    alvoEl = alvo;
    if (sub) vista = sub;

    const eu = Plataforma.perfil;
    if (!eu || eu.papel !== 'admin') {
      alvo.innerHTML = `
        <div class="vazio"><div class="vazio-ico">◎</div>
          <h3>Só administrador acessa o financeiro</h3>
          <p>O caixa da imobiliária fica restrito. A trava está no banco, então
             nem por caminho indireto o dado aparece para outro papel.</p></div>`;
      return;
    }

    if (vista === 'receber')     return montarAgenda(alvo, 'receita');
    if (vista === 'pagar')       return montarAgenda(alvo, 'despesa');
    if (vista === 'lancamentos') return montarLancamentos(alvo);
    if (vista === 'contas')      return montarContas(alvo);
    if (vista === 'categorias')  return montarCategorias(alvo);
    return montarVisao(alvo);
  }

  // ── Visão geral ─────────────────────────────────────────────────────
  async function montarVisao(alvo) {
    const [lanc, contas] = await Promise.all([
      db(supabaseClient.from('lancamento').select('*'), 'carregar lançamentos'),
      db(supabaseClient.from('conta_financeira').select('*').eq('ativo', true).order('ordem'), 'carregar contas'),
    ]);

    const d = hoje(), m = mesAtual();
    const doMes = l => (l.vencimento || '').slice(0, 7) === m;
    const receita = l => l.tipo === 'receita';
    const emAberto = l => !l.pago_em;
    const vencido = l => emAberto(l) && l.vencimento && l.vencimento < d;

    const soma = f => lanc.filter(f).reduce((s, l) => s + Number(l.valor || 0), 0);
    const recMes = soma(l => receita(l) && doMes(l));
    const despMes = soma(l => !receita(l) && doMes(l));
    const recVenc = soma(l => receita(l) && vencido(l));
    const despVenc = soma(l => !receita(l) && vencido(l));

    // Saldo por conta: inicial mais o que já foi efetivamente pago ou recebido.
    // Previsto não entra: saldo que conta com dinheiro que não chegou engana.
    const saldoDe = c => Number(c.saldo_inicial || 0) + lanc
      .filter(l => l.conta_id === c.id && l.pago_em)
      .reduce((s, l) => s + (l.tipo === 'receita' ? 1 : -1) * Number(l.valor || 0), 0);
    const saldoTotal = contas.filter(c => c.tipo !== 'cartao').reduce((s, c) => s + saldoDe(c), 0);

    // Projeção dos próximos seis meses pelo que já está lançado.
    const meses = [];
    for (let i = 0; i < 6; i++) {
      const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() + i);
      const chave = dt.toISOString().slice(0, 7);
      meses.push({
        rotulo: dt.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
        receita: soma(l => receita(l) && (l.vencimento || '').slice(0, 7) === chave),
        despesa: soma(l => !receita(l) && (l.vencimento || '').slice(0, 7) === chave),
      });
    }
    const maior = Math.max(...meses.flatMap(x => [x.receita, x.despesa]), 1);

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Financeiro</h2>
          <div class="secao-meta">Caixa da imobiliária. Visível só para administrador.</div></div>
        </div>
        <div class="secao-acoes">
          <button class="btn btn-primario" id="fiNovo">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            Novo lançamento
          </button>
        </div>
      </div>

      <div class="painel-numeros">
        <div class="num fi-receita"><span class="num-v">${brlCurto(recMes)}</span><span class="num-r">Receitas deste mês</span></div>
        <div class="num fi-despesa"><span class="num-v">${brlCurto(despMes)}</span><span class="num-r">Despesas deste mês</span></div>
        <div class="num${recMes - despMes >= 0 ? ' num-destaque' : ' num-alerta'}"><span class="num-v">${brlCurto(recMes - despMes)}</span><span class="num-r">Resultado do mês</span></div>
        <div class="num${recVenc ? ' fi-atencao' : ''}"><span class="num-v">${brlCurto(recVenc)}</span><span class="num-r">A receber vencido</span></div>
        <div class="num${despVenc ? ' num-alerta' : ''}"><span class="num-v">${brlCurto(despVenc)}</span><span class="num-r">A pagar vencido</span></div>
      </div>

      ${(recVenc || despVenc) ? `
        <div class="ficha-secao" style="border-color:rgba(224,82,82,.4)">
          <div style="padding:14px 20px">
            <p class="campo-dica" style="color:var(--vermelho)">
              <strong>Isto é o que pede ação hoje.</strong> O resto da tela é história;
              vencido é presente. ${lanc.filter(vencido).length} lançamento(s) passaram da data.</p>
          </div>
        </div>` : ''}

      <div class="rel-grade">
        <section class="ficha-secao">
          <div class="ficha-secao-topo">
            <h3>Contas e cartões</h3>
            <p>Saldo com o que já entrou ou saiu de fato. Previsto não entra aqui.</p>
          </div>
          <div style="padding:16px 20px">
            ${contas.length ? `
              <ul class="ini-lista">
                ${contas.map(c => `<li>
                  <span class="ini-hora">${esc((TIPOS_CONTA.find(t => t[0] === c.tipo) || [, c.tipo])[1].slice(0, 8))}</span>
                  <span class="ini-txt">${esc(c.nome)}</span>
                  <span class="ini-sub ${saldoDe(c) < 0 ? 'ini-vencida' : ''}">${brl(saldoDe(c))}</span>
                </li>`).join('')}
              </ul>
              <p class="rel-nota">Saldo somado (sem cartões): <strong>${brl(saldoTotal)}</strong></p>`
            : `<p class="ini-vazio">Nenhuma conta cadastrada. Sem conta, o lançamento não sabe
                de onde o dinheiro saiu.</p>
               <button class="btn btn-mini" id="fiIrContas" style="margin-top:10px">Cadastrar conta</button>`}
          </div>
        </section>

        <section class="ficha-secao">
          <div class="ficha-secao-topo"><h3>Próximos seis meses</h3>
            <p>Pelo que já está lançado. Comissão é receita irregular, então ver o vale antes
               dele chegar vale mais que o resultado do mês.</p></div>
          <div style="padding:16px 20px">
            <div class="fi-proj">
              ${meses.map(x => `
                <div class="fi-mes">
                  <div class="fi-barras">
                    <span class="fi-b fi-b-rec" style="height:${Math.round(x.receita / maior * 100)}%"
                          title="Receita ${brl(x.receita)}"></span>
                    <span class="fi-b fi-b-desp" style="height:${Math.round(x.despesa / maior * 100)}%"
                          title="Despesa ${brl(x.despesa)}"></span>
                  </div>
                  <div class="fi-rot">${esc(x.rotulo)}</div>
                </div>`).join('')}
            </div>
            <p class="rel-nota"><span class="fi-leg fi-b-rec"></span> entra
               <span class="fi-leg fi-b-desp" style="margin-left:14px"></span> sai</p>
          </div>
        </section>
      </div>`;

    document.getElementById('fiNovo').addEventListener('click', () => abrirLancamento('novo'));
    const ir = document.getElementById('fiIrContas');
    if (ir) ir.addEventListener('click', () => Plataforma.irPara('financeiro', 'contas'));
  }

  // ── A receber / A pagar ─────────────────────────────────────────────
  // A mesma tela serve para os dois lados: só muda o sinal e o verbo. Manter
  // duas cópias quase iguais seria garantir que uma corrige e a outra não.
  async function montarAgenda(alvo, tipo) {
    const eReceita = tipo === 'receita';
    const [todos, contas, cats] = await Promise.all([
      db(supabaseClient.from('lancamento').select('*').eq('tipo', tipo)
        .order('vencimento'), 'carregar lançamentos'),
      db(supabaseClient.from('conta_financeira').select('id,nome,tipo').eq('ativo', true).order('ordem'), 'carregar contas'),
      db(supabaseClient.from('categoria_financeira').select('id,nome'), 'carregar categorias'),
    ]);
    const nomeDe = (lista, id) => (lista.find(x => x.id === id) || {}).nome || '—';
    const d = hoje();

    const aberto   = todos.filter(l => !l.pago_em);
    const vencido  = aberto.filter(l => l.vencimento && l.vencimento < d);
    const eHoje    = aberto.filter(l => l.vencimento === d);
    const aVencer  = aberto.filter(l => !l.vencimento || l.vencimento > d);
    const quitado  = todos.filter(l => l.pago_em)
      .sort((a, b) => (b.pago_em || '').localeCompare(a.pago_em || '')).slice(0, 25);

    const soma = lista => lista.reduce((x, l) => x + Number(l.valor || 0), 0);
    // Próximos sete dias: é a janela em que dá pra fazer alguma coisa a
    // respeito. Trinta dias vira paisagem e ninguém age.
    const limite7 = new Date(); limite7.setDate(limite7.getDate() + 7);
    const semana = aVencer.filter(l => l.vencimento && l.vencimento <= limite7.toISOString().slice(0, 10));

    const verbo   = eReceita ? 'recebimento' : 'pagamento';
    const feito   = eReceita ? 'Recebido'    : 'Pago';
    const titulo  = eReceita ? 'Contas a receber' : 'Contas a pagar';

    const linha = (l, quitada) => {
      const atrasada = !quitada && l.vencimento && l.vencimento < d;
      const serie = l.recorrente || l.lancamento_pai_id;
      const acao = quitada
        ? `<button class="btn btn-mini" data-desfazer="${l.id}" title="Voltar para em aberto">Desfazer</button>`
        : `<button class="btn btn-mini btn-primario" data-confirmar="${l.id}">Confirmar</button>`;
      return `<tr class="fi-ag-linha" data-id="${l.id}">
        <td class="cad-num${atrasada ? ' ini-vencida' : ''}">${dataBr(l.vencimento)}${
          atrasada ? `<div class="cad-end-sub">${diasDe(l.vencimento)} em atraso</div>` : ''}</td>
        <td><div class="cad-end-rua">${esc(l.descricao)}</div>
            <div class="cad-end-sub">${esc(nomeDe(cats, l.categoria_id) || l.categoria || 'sem categoria')}${
              serie ? ' · <span class="fi-serie">série</span>' : ''}</div></td>
        <td>${l.conta_id ? esc(nomeDe(contas, l.conta_id)) : '<span class="cad-vazio">sem conta</span>'}</td>
        <td class="cad-valor" style="color:${eReceita ? 'var(--verde)' : 'var(--vermelho)'}">${brl(l.valor)}</td>
        <td class="fi-ag-acao">${quitada ? `<span class="cad-selo cad-selo-vitrine">${esc(feito.toLowerCase())} ${dataBr(l.pago_em)}</span> ` : ''}${acao}</td>
      </tr>`;
    };

    const bloco = (rot, itens, dica, quitada) => `
      <section class="ficha-secao${itens === vencido && itens.length ? ' fi-secao-alerta' : ''}">
        <div class="ficha-secao-topo">
          <h3>${esc(rot)}<span class="ini-conta">${itens.length}</span>
            ${itens.length ? `<span class="fi-soma">${brl(soma(itens))}</span>` : ''}</h3>
          ${dica ? `<p>${esc(dica)}</p>` : ''}
        </div>
        ${itens.length
          ? `<div class="cad-tabela-scroll" style="border:none;border-radius:0">
               <table class="cad-tabela"><tbody>${itens.map(l => linha(l, quitada)).join('')}</tbody></table></div>`
          : `<p class="ini-vazio" style="padding:16px 20px">Nada aqui.</p>`}
      </section>`;

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>${titulo}</h2>
          <div class="secao-meta">Ordenado por urgência, não por data de cadastro.
            Cada linha tem o botão que fecha a pendência.</div></div>
        </div>
        <div class="secao-acoes">
          <button class="btn btn-primario" id="fiNovoAg">Nova conta ${eReceita ? 'a receber' : 'a pagar'}</button>
        </div>
      </div>

      <div class="painel-numeros">
        <div class="num${vencido.length ? ' num-alerta' : ''}">
          <span class="num-v">${brlCurto(soma(vencido))}</span><span class="num-r">Vencido</span></div>
        <div class="num${eHoje.length ? ' fi-atencao' : ''}">
          <span class="num-v">${brlCurto(soma(eHoje))}</span><span class="num-r">Vence hoje</span></div>
        <div class="num"><span class="num-v">${brlCurto(soma(semana))}</span><span class="num-r">Próximos 7 dias</span></div>
        <div class="num"><span class="num-v">${brlCurto(soma(aberto))}</span><span class="num-r">Total em aberto</span></div>
      </div>

      ${bloco('Vencido', vencido, 'Passou da data e ninguém baixou. É o único bloco que pede ação hoje.')}
      ${bloco('Vence hoje', eHoje, '')}
      ${bloco('A vencer', aVencer, '')}
      ${bloco(`Já ${feito.toLowerCase()}`, quitado, 'Os 25 mais recentes. Confirmou errado? Desfaz aqui.', true)}`;

    document.getElementById('fiNovoAg').addEventListener('click', () => abrirLancamento('novo', tipo));

    // Clicar na linha abre a ficha; clicar no botão resolve ali mesmo, sem
    // abrir nada. Por isso o stopPropagation.
    alvo.querySelectorAll('.fi-ag-linha').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.closest('button') || e.target.closest('select')) return;
        abrirLancamento(tr.dataset.id, tipo);
      });
    });

    alvo.querySelectorAll('[data-desfazer]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      await db(supabaseClient.from('lancamento').update({ pago_em: null })
        .eq('id', b.dataset.desfazer), 'desfazer');
      avisar('Voltou para em aberto.');
      await montarAgenda(alvo, tipo);
    }));

    alvo.querySelectorAll('[data-confirmar]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const id = b.dataset.confirmar;
      const l = todos.find(x => x.id === id);
      // Confirmar sem dizer a conta faria o saldo mentir em silêncio: o
      // dinheiro entrou, mas nenhuma conta subiu. Então quando falta conta,
      // ela é perguntada aqui mesmo, na linha, e não em outra tela.
      if (!l.conta_id && contas.length) {
        const cel = b.closest('td');
        cel.innerHTML = `
          <select class="fi-ag-conta">${contas.map(c =>
            `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select>
          <button class="btn btn-mini btn-primario" data-ok="${id}">Confirmar</button>`;
        cel.querySelector('[data-ok]').addEventListener('click', async ev => {
          ev.stopPropagation();
          await baixar(id, cel.querySelector('.fi-ag-conta').value);
        });
        return;
      }
      await baixar(id, null);
    }));

    async function baixar(id, contaId) {
      const dados = { pago_em: hoje() };
      if (contaId) dados.conta_id = contaId;
      await db(supabaseClient.from('lancamento').update(dados).eq('id', id), `confirmar ${verbo}`);
      avisar(`${feito} confirmado.`);
      await montarAgenda(alvo, tipo);
    }
  }

  function diasDe(iso) {
    const dias = Math.round((Date.parse(hoje()) - Date.parse(iso)) / 86400000);
    return dias === 1 ? '1 dia' : `${dias} dias`;
  }

  // ── Lançamentos ─────────────────────────────────────────────────────
  async function montarLancamentos(alvo) {
    const [lanc, contas, cats] = await Promise.all([
      db(supabaseClient.from('lancamento').select('*').order('vencimento', { ascending: false }), 'carregar lançamentos'),
      db(supabaseClient.from('conta_financeira').select('id,nome'), 'carregar contas'),
      db(supabaseClient.from('categoria_financeira').select('id,nome'), 'carregar categorias'),
    ]);
    const nomeDe = (lista, id) => (lista.find(x => x.id === id) || {}).nome || '—';
    const d = hoje();

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Lançamentos</h2><div class="secao-meta" id="fiMeta">${lanc.length} lançamentos</div></div>
        </div>
        <div class="secao-acoes">
          <input type="search" id="fiBusca" placeholder="Descrição, parceiro…">
          <select id="fiFiltro">
            <option value="">Tudo</option>
            <option value="receita">Receitas</option>
            <option value="despesa">Despesas</option>
            <option value="vencido">Vencidos</option>
            <option value="aberto">Em aberto</option>
          </select>
          <button class="btn btn-primario" id="fiNovo2">Novo lançamento</button>
        </div>
      </div>
      <div id="fiCorpo"></div>`;

    function desenhar() {
      const q = (document.getElementById('fiBusca').value || '').toLowerCase().trim();
      const f = document.getElementById('fiFiltro').value;
      const lista = lanc.filter(l => {
        if (f === 'receita' && l.tipo !== 'receita') return false;
        if (f === 'despesa' && l.tipo !== 'despesa') return false;
        if (f === 'vencido' && !(!l.pago_em && l.vencimento && l.vencimento < d)) return false;
        if (f === 'aberto' && l.pago_em) return false;
        if (q && ![l.descricao, l.parceiro].some(x => (x || '').toLowerCase().includes(q))) return false;
        return true;
      });
      document.getElementById('fiMeta').textContent =
        lista.length === lanc.length ? `${lanc.length} lançamentos` : `${lista.length} de ${lanc.length}`;

      document.getElementById('fiCorpo').innerHTML = lista.length ? `
        <div class="cad-tabela-scroll"><table class="cad-tabela">
          <thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Conta</th>
            <th>Valor</th><th>Situação</th></tr></thead>
          <tbody>${lista.map(l => {
            const venc = !l.pago_em && l.vencimento && l.vencimento < d;
            return `<tr class="cad-linha" data-id="${l.id}">
              <td class="cad-num${venc ? ' ini-vencida' : ''}">${dataBr(l.vencimento)}</td>
              <td><div class="cad-end-rua">${esc(l.descricao)}</div>
                  ${l.parceiro ? `<div class="cad-end-sub">parceiro: ${esc(l.parceiro)}${l.parceiro_pct ? ` · ${l.parceiro_pct}%` : ''}</div>` : ''}</td>
              <td>${esc(nomeDe(cats, l.categoria_id) || l.categoria || '—')}</td>
              <td>${esc(nomeDe(contas, l.conta_id))}</td>
              <td class="cad-valor" style="color:${l.tipo === 'receita' ? 'var(--verde)' : 'var(--vermelho)'}">
                ${l.tipo === 'receita' ? '+' : '−'} ${brl(l.valor)}</td>
              <td>${l.pago_em
                ? `<span class="cad-selo cad-selo-vitrine">${l.tipo === 'receita' ? 'recebido' : 'pago'}</span>`
                : venc ? '<span class="cad-selo cad-selo-restrito">vencido</span>'
                : '<span class="cad-selo cad-selo-autorizado">em aberto</span>'}</td>
            </tr>`;
          }).join('')}</tbody></table></div>`
        : `<div class="vazio"><div class="vazio-ico">◎</div><h3>Nada com esse filtro</h3></div>`;

      document.querySelectorAll('#fiCorpo .cad-linha').forEach(tr =>
        tr.addEventListener('click', () => abrirLancamento(tr.dataset.id)));
    }

    ['fiBusca', 'fiFiltro'].forEach(i =>
      document.getElementById(i).addEventListener('input', desenhar));
    document.getElementById('fiNovo2').addEventListener('click', () => abrirLancamento('novo'));
    desenhar();
  }

  // ── Ficha do lançamento ─────────────────────────────────────────────
  async function abrirLancamento(id, tipoPadrao) {
    const [contas, cats, imoveis] = await Promise.all([
      db(supabaseClient.from('conta_financeira').select('id,nome,tipo').eq('ativo', true).order('ordem'), 'contas'),
      db(supabaseClient.from('categoria_financeira').select('*').eq('ativo', true).order('tipo').order('ordem'), 'categorias'),
      Crud.listaApoio('imovel'),
    ]);
    const l = id === 'novo' ? { tipo: tipoPadrao || 'despesa', vencimento: hoje() }
      : (await db(supabaseClient.from('lancamento').select('*').eq('id', id).limit(1), 'abrir'))[0];

    // Só a criação gera série. Editar uma parcela já existente muda aquela
    // parcela, e não reescreve o passado da série inteira — que é o que a
    // pessoa espera quando corrige o valor de um mês só.
    const podeRepetir = id === 'novo';

    const ops = (lista, sel, vazio = '—') => `<option value="">${vazio}</option>` +
      lista.map(o => `<option value="${o.id}"${o.id === sel ? ' selected' : ''}>${esc(o.nome)}</option>`).join('');

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>${id === 'novo' ? 'Novo lançamento' : esc(l.descricao)}</h2></div>
        </div>
        <div class="secao-acoes">
          ${id === 'novo' ? '' : '<button class="btn btn-remover" id="flExcluir">Excluir</button>'}
        ${id !== 'novo' && (l.recorrente || l.lancamento_pai_id)
          ? '<button class="btn btn-remover" id="flExcluirFuturos">Excluir este e os futuros</button>' : ''}
          <button class="btn" id="flVoltar">Voltar</button>
          <button class="btn btn-primario" id="flSalvar">Salvar</button>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-grade">
          <div class="campo"><label for="flTipo">Tipo</label>
            <select id="flTipo">
              <option value="receita"${l.tipo === 'receita' ? ' selected' : ''}>Receita (entra)</option>
              <option value="despesa"${l.tipo === 'despesa' ? ' selected' : ''}>Despesa (sai)</option>
            </select></div>
          <div class="campo"><label for="flCategoria">Categoria</label>
            <select id="flCategoria"></select></div>
          <div class="campo campo-largo"><label for="flDescricao">Descrição</label>
            <input type="text" id="flDescricao" value="${esc(l.descricao ?? '')}"
                   placeholder="Comissão da venda do MI-103"></div>
          <div class="campo"><label for="flValor">Valor (R$)</label>
            <input type="number" id="flValor" value="${l.valor ?? ''}" step="0.01" min="0"></div>
          <div class="campo"><label for="flConta">Conta ou cartão</label>
            <select id="flConta">${ops(contas, l.conta_id, 'Não informado')}</select></div>
          <div class="campo"><label for="flVenc">Vencimento</label>
            <input type="date" id="flVenc" value="${l.vencimento ?? ''}"></div>
          <div class="campo"><label for="flPago">Pago ou recebido em</label>
            <input type="date" id="flPago" value="${l.pago_em ?? ''}">
            <p class="campo-dica">Em branco = ainda em aberto.</p></div>
          <div class="campo"><label for="flComp">Competência</label>
            <input type="month" id="flComp" value="${(l.competencia || '').slice(0, 7)}">
            <p class="campo-dica">Mês a que se refere. Comissão fechada em março e paga em maio
              pertence a março.</p></div>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Vínculos e divisão</h3></div>
        <div class="ficha-grade">
          <div class="campo campo-largo"><label for="flImovel">Imóvel</label>
            <select id="flImovel">${ops(imoveis, l.imovel_id, 'Nenhum')}</select></div>
          <div class="campo"><label for="flParceiro">Parceiro</label>
            <input type="text" id="flParceiro" value="${esc(l.parceiro ?? '')}"
                   placeholder="Imobiliária ou corretor"></div>
          <div class="campo"><label for="flParceiroPct">Percentual do parceiro</label>
            <input type="number" id="flParceiroPct" value="${l.parceiro_pct ?? ''}" step="0.01" min="0" max="100"></div>
          <div class="campo campo-largo"><label for="flObs">Observações</label>
            <textarea id="flObs" rows="2">${esc(l.obs ?? '')}</textarea></div>
        </div>
      </div>

      ${podeRepetir ? `
      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Repetição</h3>
          <p>Aluguel de sala, mensalidade do sistema, CRECI: o que volta sempre
             não deveria ser digitado toda vez.</p></div>
        <div class="ficha-grade">
          <div class="campo campo-largo">
            <label class="campo-check"><input type="checkbox" id="flRecorrente">
              <span>Este lançamento se repete</span></label>
          </div>
          <div class="campo"><label for="flPeriodo">Frequência</label>
            <select id="flPeriodo">${PERIODOS.map(([v, r]) =>
              `<option value="${v}">${r}</option>`).join('')}</select></div>
          <div class="campo"><label for="flAte">Repetir até</label>
            <input type="date" id="flAte" value="${l.recorrencia_ate ?? ''}">
            <p class="campo-dica" id="flPrevia">Cada repetição vira um lançamento próprio,
              com vencimento e confirmação separados.</p></div>
        </div>
      </div>` : `
      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Repetição</h3></div>
        <div style="padding:14px 20px">
          <p class="campo-dica">${l.lancamento_pai_id
            ? 'Este lançamento é uma parcela de uma série. Alterar aqui muda só este mês.'
            : 'Esta é a primeira parcela de uma série já gerada. Para mudar a frequência, exclua as futuras e gere de novo.'}</p>
        </div>
      </div>`}`;

    function encherCategorias() {
      const t = document.getElementById('flTipo').value;
      document.getElementById('flCategoria').innerHTML =
        ops(cats.filter(c => c.tipo === t), l.categoria_id);
    }
    document.getElementById('flTipo').addEventListener('change', encherCategorias);
    encherCategorias();

    // Quantas parcelas vão nascer, dito antes de salvar. Descobrir depois que
    // criou 48 linhas é o tipo de surpresa que faz perder a confiança na tela.
    function datasDaSerie() {
      if (!podeRepetir || !document.getElementById('flRecorrente').checked) return [];
      const inicio = document.getElementById('flVenc').value;
      const ate = document.getElementById('flAte').value;
      const passo = (PERIODOS.find(x => x[0] === document.getElementById('flPeriodo').value) || [, , 1])[2];
      if (!inicio || !ate || ate < inicio) return [];
      const datas = [];
      for (let i = 0; i < MAX_PARCELAS; i++) {
        const dt = somarMeses(inicio, passo * i);
        if (dt > ate) break;
        datas.push(dt);
      }
      return datas;
    }

    function atualizarPrevia() {
      if (!podeRepetir) return;
      const ligado = document.getElementById('flRecorrente').checked;
      ['flPeriodo', 'flAte'].forEach(i => document.getElementById(i).disabled = !ligado);
      const datas = datasDaSerie();
      const previa = document.getElementById('flPrevia');
      previa.textContent = !ligado
        ? 'Cada repetição vira um lançamento próprio, com vencimento e confirmação separados.'
        : !datas.length
        ? 'Informe o vencimento e a data final para eu calcular as parcelas.'
        : datas.length >= MAX_PARCELAS
        ? `Vou gerar ${MAX_PARCELAS} parcelas (o teto). A primeira em ${dataBr(datas[0])}, a última em ${dataBr(datas[datas.length - 1])}.`
        : `Vou gerar ${datas.length} lançamento(s): ${dataBr(datas[0])} até ${dataBr(datas[datas.length - 1])}.`;
    }
    if (podeRepetir) {
      ['flRecorrente', 'flPeriodo', 'flAte', 'flVenc'].forEach(i =>
        document.getElementById(i).addEventListener('change', atualizarPrevia));
      atualizarPrevia();
    }

    const voltarPara = tipoPadrao === 'receita' ? 'receber'
                     : tipoPadrao === 'despesa' ? 'pagar' : 'lancamentos';
    document.getElementById('flVoltar').addEventListener('click', () => montar(alvoEl, voltarPara));
    document.getElementById('flSalvar').addEventListener('click', async () => {
      const v = i => document.getElementById(i).value.trim();
      if (!v('flDescricao')) { avisar('O lançamento precisa de descrição.'); return; }
      if (!v('flValor')) { avisar('Informe o valor.'); return; }
      const dados = {
        tipo: v('flTipo'), descricao: v('flDescricao'), valor: Number(v('flValor')),
        categoria_id: v('flCategoria') || null, conta_id: v('flConta') || null,
        vencimento: v('flVenc') || null, pago_em: v('flPago') || null,
        competencia: v('flComp') ? v('flComp') + '-01' : null,
        imovel_id: v('flImovel') || null, parceiro: v('flParceiro') || null,
        parceiro_pct: v('flParceiroPct') ? Number(v('flParceiroPct')) : null,
        obs: v('flObs') || null,
      };
      if (id !== 'novo') {
        await db(supabaseClient.from('lancamento').update(dados).eq('id', id), 'salvar');
        avisar('Lançamento salvo.');
        return montar(alvoEl, voltarPara);
      }

      const datas = datasDaSerie();
      if (!datas.length) {
        await db(supabaseClient.from('lancamento').insert(dados), 'salvar');
        avisar('Lançamento salvo.');
        return montar(alvoEl, voltarPara);
      }

      // A primeira parcela é a mãe da série; as outras apontam para ela. Sem
      // esse vínculo não daria pra excluir "as futuras" sem sair adivinhando
      // por descrição parecida.
      const periodo = document.getElementById('flPeriodo').value;
      const mae = await db(supabaseClient.from('lancamento').insert({
        ...dados, vencimento: datas[0], recorrente: true,
        recorrencia: periodo, recorrencia_ate: document.getElementById('flAte').value,
      }).select('id').single(), 'criar a série');

      const filhas = datas.slice(1).map(dt => ({
        ...dados, vencimento: dt, pago_em: null, lancamento_pai_id: mae.id,
        // Competência acompanha o vencimento nas repetições: aluguel de
        // setembro é competência de setembro, não do mês em que foi cadastrado.
        competencia: dados.competencia ? dt.slice(0, 8) + '01' : null,
      }));
      if (filhas.length) await db(supabaseClient.from('lancamento').insert(filhas), 'gerar as parcelas');
      avisar(`${datas.length} lançamentos criados.`);
      await montar(alvoEl, voltarPara);
    });
    const ex = document.getElementById('flExcluir');
    if (ex) ex.addEventListener('click', async () => {
      if (!confirm('Excluir este lançamento?')) return;
      await db(supabaseClient.from('lancamento').delete().eq('id', id), 'excluir');
      avisar('Excluído.');
      await montar(alvoEl, voltarPara);
    });

    const exf = document.getElementById('flExcluirFuturos');
    if (exf) exf.addEventListener('click', async () => {
      // Raiz da série: se este é filho, a raiz é o pai; se é a mãe, é ele mesmo.
      const raiz = l.lancamento_pai_id || id;
      const irmaos = await db(supabaseClient.from('lancamento').select('id,vencimento')
        .or(`id.eq.${raiz},lancamento_pai_id.eq.${raiz}`), 'ler a série');
      const alvos = irmaos.filter(x => (x.vencimento || '') >= (l.vencimento || '')).map(x => x.id);
      if (!confirm(`Excluir ${alvos.length} lançamento(s) desta série, de ${dataBr(l.vencimento)} em diante? O que já passou fica.`)) return;
      await db(supabaseClient.from('lancamento').delete().in('id', alvos), 'excluir a série');
      avisar(`${alvos.length} excluídos.`);
      await montar(alvoEl, voltarPara);
    });
  }

  // ── Contas e cartões ────────────────────────────────────────────────
  async function montarContas(alvo, abrir) {
    const contas = await db(supabaseClient.from('conta_financeira').select('*')
      .order('ordem').order('nome'), 'carregar contas');

    if (abrir) {
      const c = contas.find(x => x.id === abrir) || { tipo: 'banco', saldo_inicial: 0 };
      alvo.innerHTML = `
        <div class="secao-topo">
          <div class="secao-titulo"><div class="ponto"></div>
            <div><h2>${esc(c.nome || 'Nova conta')}</h2></div>
          </div>
          <div class="secao-acoes">
            ${c.id ? '<button class="btn btn-remover" id="coExcluir">Excluir</button>' : ''}
            <button class="btn" id="coVoltar">Voltar</button>
            <button class="btn btn-primario" id="coSalvar">Salvar</button>
          </div>
        </div>
        <div class="ficha-secao">
          <div class="ficha-grade">
            <div class="campo"><label for="coTipo">Tipo</label>
              <select id="coTipo">${TIPOS_CONTA.map(([v, r]) =>
                `<option value="${v}"${c.tipo === v ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
            <div class="campo"><label for="coNome">Nome</label>
              <input type="text" id="coNome" value="${esc(c.nome ?? '')}" placeholder="Banco do Brasil"></div>
            <div class="campo"><label for="coBanco">Instituição</label>
              <input type="text" id="coBanco" value="${esc(c.banco ?? '')}"></div>
            <div class="campo"><label for="coAgencia">Agência</label>
              <input type="text" id="coAgencia" value="${esc(c.agencia ?? '')}"></div>
            <div class="campo"><label for="coNumero">Número</label>
              <input type="text" id="coNumero" value="${esc(c.numero ?? '')}"></div>
            <div class="campo"><label for="coSaldo">Saldo inicial (R$)</label>
              <input type="number" id="coSaldo" value="${c.saldo_inicial ?? 0}" step="0.01">
              <p class="campo-dica">O que havia quando você começou a usar o sistema.</p></div>
          </div>
        </div>
        <div class="ficha-secao" id="coCartao">
          <div class="ficha-secao-topo"><h3>Só para cartão</h3>
            <p>Fechamento e vencimento mudam o mês em que a despesa pesa no caixa.</p></div>
          <div class="ficha-grade">
            <div class="campo"><label for="coFech">Dia do fechamento</label>
              <input type="number" id="coFech" value="${c.dia_fechamento ?? ''}" min="1" max="31"></div>
            <div class="campo"><label for="coVenc">Dia do vencimento</label>
              <input type="number" id="coVenc" value="${c.dia_vencimento ?? ''}" min="1" max="31"></div>
            <div class="campo"><label for="coLimite">Limite (R$)</label>
              <input type="number" id="coLimite" value="${c.limite ?? ''}" step="0.01"></div>
          </div>
        </div>`;

      const alternar = () => {
        document.getElementById('coCartao').style.display =
          document.getElementById('coTipo').value === 'cartao' ? '' : 'none';
      };
      document.getElementById('coTipo').addEventListener('change', alternar);
      alternar();

      document.getElementById('coVoltar').addEventListener('click', () => montarContas(alvo));
      document.getElementById('coSalvar').addEventListener('click', async () => {
        const v = i => document.getElementById(i).value.trim();
        if (!v('coNome')) { avisar('A conta precisa de nome.'); return; }
        const dados = {
          nome: v('coNome'), tipo: v('coTipo'), banco: v('coBanco') || null,
          agencia: v('coAgencia') || null, numero: v('coNumero') || null,
          saldo_inicial: Number(v('coSaldo') || 0),
          dia_fechamento: v('coFech') ? Number(v('coFech')) : null,
          dia_vencimento: v('coVenc') ? Number(v('coVenc')) : null,
          limite: v('coLimite') ? Number(v('coLimite')) : null,
        };
        if (c.id) await db(supabaseClient.from('conta_financeira').update(dados).eq('id', c.id), 'salvar');
        else await db(supabaseClient.from('conta_financeira').insert(dados), 'criar');
        avisar('Conta salva.');
        await montarContas(alvo);
      });
      const ex = document.getElementById('coExcluir');
      if (ex) ex.addEventListener('click', async () => {
        if (!confirm(`Excluir "${c.nome}"? Os lançamentos ligados a ela ficam sem conta.`)) return;
        await db(supabaseClient.from('conta_financeira').delete().eq('id', c.id), 'excluir');
        avisar('Conta excluída.');
        await montarContas(alvo);
      });
      return;
    }

    const bancos = contas.filter(c => c.tipo !== 'cartao');
    const cartoes = contas.filter(c => c.tipo === 'cartao');

    const tabela = (titulo, itens, vazio) => `
      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>${esc(titulo)}<span class="ini-conta">${itens.length}</span></h3></div>
        ${itens.length ? `<div class="cad-tabela-scroll" style="border:none;border-radius:0">
          <table class="cad-tabela"><tbody>${itens.map(c => `
            <tr class="cad-linha" data-id="${c.id}">
              <td><div class="cad-end-rua">${esc(c.nome)}</div>
                  <div class="cad-end-sub">${esc([c.banco, c.agencia, c.numero].filter(Boolean).join(' · ') || '—')}</div></td>
              <td>${esc((TIPOS_CONTA.find(t => t[0] === c.tipo) || [, c.tipo])[1])}</td>
              <td class="cad-valor">${brl(c.saldo_inicial)}</td>
              <td>${c.ativo ? '' : '<span class="cad-selo cad-selo-restrito">inativa</span>'}</td>
            </tr>`).join('')}</tbody></table></div>`
          : `<p class="ini-vazio" style="padding:18px 20px">${esc(vazio)}</p>`}
      </section>`;

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Contas e cartões</h2>
          <div class="secao-meta">De onde o dinheiro sai e para onde entra. Sem isso o
            lançamento é só um número solto.</div></div>
        </div>
        <div class="secao-acoes"><button class="btn btn-primario" id="coNova">Nova conta</button></div>
      </div>
      ${tabela('Contas', bancos, 'Nenhuma conta cadastrada.')}
      ${tabela('Cartões de crédito', cartoes, 'Nenhum cartão cadastrado.')}`;

    document.getElementById('coNova').addEventListener('click', () => montarContas(alvo, 'novo'));
    alvo.querySelectorAll('.cad-linha').forEach(tr =>
      tr.addEventListener('click', () => montarContas(alvo, tr.dataset.id)));
  }

  // ── Categorias ──────────────────────────────────────────────────────
  async function montarCategorias(alvo) {
    const cats = await db(supabaseClient.from('categoria_financeira').select('*')
      .order('tipo').order('ordem').order('nome'), 'carregar categorias');

    const bloco = tipo => {
      const meus = cats.filter(c => c.tipo === tipo);
      return `
        <section class="ficha-secao">
          <div class="ficha-secao-topo">
            <h3>${tipo === 'receita' ? 'Receitas' : 'Despesas'}<span class="ini-conta">${meus.length}</span></h3>
          </div>
          <div class="cfg-novo">
            <input type="text" id="cat_${tipo}" placeholder="Nome da categoria">
            <button class="btn btn-primario" data-add="${tipo}">Adicionar</button>
          </div>
          ${meus.length ? `<ul class="cfg-itens">${meus.map(c => `
            <li class="cfg-item${c.ativo ? '' : ' inativo'}" data-id="${c.id}">
              <span class="cfg-item-nome">
                <input type="text" value="${esc(c.nome)}" data-nome></span>
              <span class="cfg-item-acoes">
                <button class="btn btn-mini" data-alt>${c.ativo ? 'Desativar' : 'Reativar'}</button>
              </span></li>`).join('')}</ul>` : ''}
        </section>`;
    };

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Categorias</h2>
          <div class="secao-meta">Antes isto era texto livre, e em três meses existiriam
            "Comissão", "comissão" e "Comissões" como coisas diferentes.</div></div>
        </div>
      </div>
      ${bloco('receita')}
      ${bloco('despesa')}`;

    alvo.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', async () => {
      const campo = document.getElementById('cat_' + b.dataset.add);
      const nome = campo.value.trim();
      if (!nome) { campo.focus(); return; }
      await db(supabaseClient.from('categoria_financeira')
        .insert({ nome, tipo: b.dataset.add, ordem: 99 }), 'adicionar categoria');
      avisar('Categoria adicionada.');
      await montarCategorias(alvo);
    }));

    alvo.querySelectorAll('.cfg-item').forEach(li => {
      const id = li.dataset.id;
      const campo = li.querySelector('[data-nome]');
      const antes = campo.value;
      campo.addEventListener('blur', async () => {
        if (campo.value.trim() && campo.value !== antes) {
          await db(supabaseClient.from('categoria_financeira')
            .update({ nome: campo.value.trim() }).eq('id', id), 'renomear');
          avisar('Renomeada.');
        }
      });
      li.querySelector('[data-alt]').addEventListener('click', async () => {
        await db(supabaseClient.from('categoria_financeira')
          .update({ ativo: li.classList.contains('inativo') }).eq('id', id), 'alterar');
        await montarCategorias(alvo);
      });
    });
  }

  Plataforma.registrar('financeiro', { titulo: 'Financeiro', montar });
})();
