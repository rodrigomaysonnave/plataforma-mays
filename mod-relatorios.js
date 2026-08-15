// ══════════════════════════════════════════════════════════════════════
// MÓDULO: RELATÓRIOS
//
// Quatro perguntas que mudam decisão, e nada além disso:
//   1. Onde os negócios travam no funil, e quanto vale cada etapa
//   2. De onde vêm os clientes de verdade
//   3. Como está a carteira de imóveis
//   4. O que entra e o que sai
//
// Barras desenhadas em HTML, sem biblioteca de gráfico. Para comparar
// grandeza, largura de barra basta, e não custa nenhuma dependência.
//
// Aviso que fica na tela: relatório sobre cadastro incompleto engana. Por
// isso ele mostra quanto do dado está faltando, em vez de esconder.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc } = Plataforma;

  const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  const pct = (n, t) => t ? Math.round(n / t * 100) : 0;

  function barras(itens, total, cor) {
    if (!itens.length) return '<p class="ini-vazio">Sem dados ainda.</p>';
    const maior = Math.max(...itens.map(i => i.valor), 1);
    return `<div class="barras">${itens.map(i => `
      <div class="barra-linha">
        <span class="barra-rot">${esc(i.rotulo)}</span>
        <span class="barra-trilho">
          <span class="barra-preenche${cor ? ' barra-' + cor : ''}" style="width:${Math.max(2, i.valor / maior * 100)}%"></span>
        </span>
        <span class="barra-num">${i.texto ?? i.valor}${total ? ` <em>${pct(i.valor, total)}%</em>` : ''}</span>
      </div>`).join('')}</div>`;
  }

  async function montar(alvo) {
    // Relatórios mostra entradas e saídas. Sem a mesma trava do Financeiro,
    // o caixa vazaria pela porta dos fundos.
    const eu = Plataforma.perfil;
    if (!eu || eu.papel !== 'admin') {
      alvo.innerHTML = `
        <div class="vazio"><div class="vazio-ico">◎</div>
          <h3>Só administrador acessa os relatórios</h3>
          <p>Eles cruzam carteira, funil e dinheiro. O financeiro é restrito, e o
             relatório que o mostra também.</p></div>`;
      return;
    }

    const [negocios, etapas, contatos, origens, imoveis, tipos, lancamentos] = await Promise.all([
      db(supabaseClient.from('negocio').select('*'), 'carregar negócios'),
      db(supabaseClient.from('etapa_funil').select('*').order('ordem'), 'carregar etapas'),
      db(supabaseClient.from('contato').select('id,origem_id').eq('ativo', true), 'carregar clientes'),
      db(supabaseClient.from('origem_lead').select('id,nome'), 'carregar origens'),
      db(supabaseClient.from('imovel').select('valor,tipo_imovel_id,status,publicar_no_site,rascunho'), 'carregar imóveis'),
      db(supabaseClient.from('tipo_imovel').select('id,nome'), 'carregar tipos'),
      db(supabaseClient.from('lancamento').select('*'), 'carregar lançamentos'),
    ]);

    const reais = imoveis.filter(i => !i.rascunho);
    const nomeOrigem = id => (origens.find(o => o.id === id) || {}).nome || 'Não informada';
    const nomeTipo   = id => (tipos.find(t => t.id === id) || {}).nome || 'Sem tipo';

    // 1. Funil
    const porEtapa = etapas.filter(e => e.resultado === 'andamento').map(e => {
      const meus = negocios.filter(n => n.etapa_id === e.id);
      return { rotulo: e.nome, valor: meus.length,
               texto: `${meus.length} · ${brl(meus.reduce((s,n) => s + Number(n.valor||0), 0))}` };
    });
    const ganhos   = negocios.filter(n => (etapas.find(e=>e.id===n.etapa_id)||{}).resultado === 'ganho');
    const perdidos = negocios.filter(n => (etapas.find(e=>e.id===n.etapa_id)||{}).resultado === 'perda');
    const conversao = ganhos.length + perdidos.length
      ? Math.round(ganhos.length / (ganhos.length + perdidos.length) * 100) : null;

    // 2. Origem dos clientes
    const contagem = {};
    contatos.forEach(c => { const n = nomeOrigem(c.origem_id); contagem[n] = (contagem[n]||0)+1; });
    const porOrigem = Object.entries(contagem).map(([rotulo, valor]) => ({ rotulo, valor }))
                        .sort((a,b) => b.valor - a.valor);

    // 3. Carteira
    const porTipo = {};
    reais.forEach(i => { const n = nomeTipo(i.tipo_imovel_id); porTipo[n] = (porTipo[n]||0)+1; });
    const carteira = Object.entries(porTipo).map(([rotulo, valor]) => ({ rotulo, valor }))
                       .sort((a,b) => b.valor - a.valor);
    const vgvCarteira = reais.reduce((s,i) => s + Number(i.valor||0), 0);
    const semValor = reais.filter(i => i.valor == null).length;
    const semTipo  = reais.filter(i => !i.tipo_imovel_id).length;
    const semOrigem = contatos.filter(c => !c.origem_id).length;

    // 4. Financeiro
    const receitas = lancamentos.filter(l => l.tipo === 'receita');
    const despesas = lancamentos.filter(l => l.tipo === 'despesa');
    const aReceber = receitas.filter(l => !l.pago_em).reduce((s,l) => s + Number(l.valor||0), 0);
    const recebido = receitas.filter(l => l.pago_em).reduce((s,l) => s + Number(l.valor||0), 0);
    const gasto    = despesas.reduce((s,l) => s + Number(l.valor||0), 0);

    const alerta = (n, oQue) => n
      ? `<p class="rel-alerta">${n} ${oQue}. O número acima conta só o que está preenchido.</p>` : '';

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Relatórios</h2>
          <div class="secao-meta">Relatório sobre cadastro incompleto engana. Por isso o que falta aparece junto.</div></div>
        </div>
      </div>

      <div class="painel-numeros">
        <div class="num"><span class="num-v">${reais.length}</span><span class="num-r">Imóveis na carteira</span></div>
        <div class="num"><span class="num-v">${brl(vgvCarteira)}</span><span class="num-r">VGV da carteira</span></div>
        <div class="num"><span class="num-v">${contatos.length}</span><span class="num-r">Clientes ativos</span></div>
        <div class="num"><span class="num-v">${conversao == null ? '—' : conversao + '%'}</span><span class="num-r">Conversão de negócios</span></div>
        <div class="num"><span class="num-v">${brl(aReceber)}</span><span class="num-r">A receber</span></div>
      </div>

      <div class="rel-grade">
        <section class="ficha-secao">
          <div class="ficha-secao-topo"><h3>Onde os negócios estão</h3>
            <p>Quantidade e valor somado por etapa. Etapa que acumula é etapa que trava.</p></div>
          <div style="padding:18px 20px">${barras(porEtapa)}
            <p class="rel-nota">${ganhos.length} ganhos · ${perdidos.length} perdidos</p></div>
        </section>

        <section class="ficha-secao">
          <div class="ficha-secao-topo"><h3>De onde vêm os clientes</h3>
            <p>É o que diz onde vale investir esforço, e onde não vale.</p></div>
          <div style="padding:18px 20px">${barras(porOrigem, contatos.length, 'verde')}
            ${alerta(semOrigem, 'clientes sem origem informada')}</div>
        </section>

        <section class="ficha-secao">
          <div class="ficha-secao-topo"><h3>Carteira por tipo</h3></div>
          <div style="padding:18px 20px">${barras(carteira, reais.length)}
            ${alerta(semTipo, 'imóveis sem tipo')}
            ${alerta(semValor, 'imóveis sem valor')}</div>
        </section>

        <section class="ficha-secao">
          <div class="ficha-secao-topo"><h3>Entradas e saídas</h3></div>
          <div style="padding:18px 20px">
            ${barras([
              { rotulo: 'Recebido', valor: recebido, texto: brl(recebido) },
              { rotulo: 'A receber', valor: aReceber, texto: brl(aReceber) },
              { rotulo: 'Despesas', valor: gasto, texto: brl(gasto) },
            ])}
            <p class="rel-nota">Saldo previsto: ${brl(recebido + aReceber - gasto)}</p>
          </div>
        </section>
      </div>`;
  }

  Plataforma.registrar('relatorios', { titulo: 'Relatórios', montar });
})();
