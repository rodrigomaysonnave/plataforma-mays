// ══════════════════════════════════════════════════════════════════════
// PENDÊNCIAS — o que o sino conta e o Início mostra no topo
//
// O sino contava só lead do site. Em 18/11/2026 entrou um imóvel pelo
// /anunciar e a Plataforma não deu um pio: o aviso veio só por e-mail.
// Agora existe uma lista única do que está esperando alguém agir, e as
// duas superfícies leem dela. O que aparece no sino é exatamente o que
// aparece no Início, nunca um número diferente do outro.
//
// Entra aqui só o que pede AÇÃO e some quando a ação é feita. Negócio
// parado fica fora de propósito: são dezenas, mudam devagar, e um sino que
// nunca zera vira decoração que ninguém olha depois da primeira semana.
// Esses continuam nos blocos do Início.
//
// Cada fonte é uma contagem (head: true, não traz linha nenhuma). O RLS
// decide o que cada pessoa enxerga; as fontes marcadas `admin` nem são
// consultadas para corretor, porque para ele dariam zero de qualquer jeito.
// ══════════════════════════════════════════════════════════════════════

const Pendencias = (() => {
  'use strict';
  const { esc, irPara, hoje } = Plataforma;

  const contar = tabela => supabaseClient.from(tabela).select('id', { count: 'exact', head: true });
  const plural = (n, um, varios) => n === 1 ? um : varios;

  // A ordem é a de prioridade: gente esperando resposta primeiro, dinheiro
  // em seguida, rotina por último. `urgente` pinta de vermelho.
  const FONTES = [
    { chave: 'anuncios', admin: true, urgente: true, ir: ['anuncios'],
      rotulo: n => plural(n, 'Imóvel enviado por proprietário', 'Imóveis enviados por proprietários'),
      dica: 'Esperando a sua análise',
      consulta: () => contar('anuncio_proprietario').eq('situacao', 'em_analise') },

    { chave: 'leads', urgente: true, ir: ['leads'],
      rotulo: n => plural(n, 'Lead do site sem resposta', 'Leads do site sem resposta'),
      dica: 'Quanto antes, maior a chance',
      // `excluido_em` é a lixeira da migração 39.
      consulta: () => contar('lead_site').eq('atendido', false).is('excluido_em', null) },

    { chave: 'conversas', urgente: true, ir: ['sdr', 'conversas'],
      rotulo: n => plural(n, 'Conversa no WhatsApp esperando você', 'Conversas no WhatsApp esperando você'),
      dica: 'A IA pediu ajuda ou ela está desligada',
      // Mesmo critério do filtro "Preciso responder" de mod-conversas.js.
      consulta: () => contar('wa_conversa').eq('ativo', true)
        .or('precisa_humano.is.true,and(nao_lidas.gt.0,sdr_modo.neq.automatico)') },

    { chave: 'cobrancas', urgente: true, ir: ['locacoes', 'painel'],
      rotulo: n => plural(n, 'Aluguel atrasado', 'Aluguéis atrasados'),
      dica: 'Passou do vencimento sem pagamento',
      consulta: () => contar('locacao_cobranca').not('cancelada', 'is', true)
        .is('pago_em', null).lt('vencimento', hoje()) },

    { chave: 'repasses', ir: ['locacoes', 'painel'],
      rotulo: n => plural(n, 'Repasse ao proprietário a fazer', 'Repasses aos proprietários a fazer'),
      dica: 'Aluguel recebido, falta repassar',
      consulta: () => contar('locacao_repasse').is('repassado_em', null) },

    { chave: 'pagar', admin: true, ir: ['financeiro', 'pagar'],
      rotulo: n => plural(n, 'Conta a pagar vencida', 'Contas a pagar vencidas'),
      dica: 'Financeiro',
      consulta: () => contar('lancamento').neq('tipo', 'receita').is('pago_em', null).lt('vencimento', hoje()) },

    { chave: 'receber', admin: true, ir: ['financeiro', 'receber'],
      rotulo: n => plural(n, 'Valor a receber vencido', 'Valores a receber vencidos'),
      dica: 'Financeiro',
      consulta: () => contar('lancamento').eq('tipo', 'receita').is('pago_em', null).lt('vencimento', hoje()) },

    { chave: 'tarefas', ir: ['inicio'],
      rotulo: n => plural(n, 'Tarefa vencida', 'Tarefas vencidas'),
      dica: 'Prazo já passou',
      consulta: () => contar('tarefa').eq('feita', false).lt('prazo', hoje()) },

    { chave: 'posts_revisao', admin: true, ir: ['redes', 'calendario'],
      rotulo: n => plural(n, 'Post esperando aprovação', 'Posts esperando aprovação'),
      dica: 'Redes sociais',
      consulta: () => contar('rede_post').eq('status', 'revisao') },

    { chave: 'posts_falhou', ir: ['redes', 'calendario'],
      rotulo: n => plural(n, 'Post que não foi publicado', 'Posts que não foram publicados'),
      dica: 'Redes sociais',
      consulta: () => contar('rede_post').eq('status', 'falhou') },

    { chave: 'acessos', admin: true, ir: ['corretores', 'equipe'],
      rotulo: n => plural(n, 'Pedido de acesso para aprovar', 'Pedidos de acesso para aprovar'),
      dica: 'Equipe',
      consulta: () => contar('perfil').eq('aprovado', false).eq('ativo', true) },
  ];

  // Início e sino pedem a lista quase ao mesmo tempo quando se entra no
  // Início (o sino reconsulta a cada troca de módulo). A consulta em
  // andamento serve aos dois; depois dela, cada pedido conta de novo, porque
  // quem pede costuma ter acabado de resolver alguma coisa.
  let emAndamento = null;

  async function buscar() {
    const perfil = Plataforma.perfil;
    if (!perfil) return [];
    const admin = perfil.papel === 'admin';
    const fontes = FONTES.filter(f => admin || !f.admin);
    const contagens = await Promise.all(fontes.map(async f => {
      try {
        const { count, error } = await f.consulta();
        // Uma fonte que falha (rede, tabela sem acesso) some da lista em vez
        // de derrubar as outras.
        if (error) { console.warn('pendência', f.chave, error.message); return 0; }
        return count || 0;
      } catch (e) { console.warn('pendência', f.chave, e); return 0; }
    }));
    return fontes.map((f, i) => ({ ...f, n: contagens[i] })).filter(p => p.n > 0);
  }

  function carregar() {
    if (!emAndamento) emAndamento = buscar().finally(() => { emAndamento = null; });
    return emAndamento;
  }

  const total = lista => lista.reduce((s, p) => s + p.n, 0);

  // ── Lista clicável, a mesma no sino e no Início ───────────────────
  function itemHtml(p, i, classe) {
    return `<button type="button" class="${classe}${p.urgente ? ' pend-urgente' : ''}" data-pend="${i}">
        <span class="pend-n">${p.n > 99 ? '99+' : p.n}</span>
        <span class="pend-txt"><b>${esc(p.rotulo(p.n))}</b><small>${esc(p.dica)}</small></span>
        <span class="pend-seta" aria-hidden="true">›</span>
      </button>`;
  }

  function ligarItens(caixa, lista, depois) {
    caixa.querySelectorAll('[data-pend]').forEach(b => b.addEventListener('click', () => {
      const p = lista[Number(b.dataset.pend)];
      if (depois) depois();
      irPara(p.ir[0], p.ir[1]);
    }));
  }

  // ── Bloco do Início ───────────────────────────────────────────────
  async function blocoInicio(alvo) {
    let lista;
    try { lista = await carregar(); }
    catch (e) { alvo.innerHTML = ''; return; }
    const n = total(lista);
    alvo.innerHTML = lista.length ? `
      <section class="pend-inicio">
        <h3>Precisa de você agora<span class="pend-total">${n}</span></h3>
        <div class="pend-grade">${lista.map((p, i) => itemHtml(p, i, 'pend-cartao')).join('')}</div>
      </section>` : `
      <div class="pend-inicio pend-em-dia"><span class="pend-ok" aria-hidden="true">✓</span>
        Nada esperando você no sistema agora.</div>`;
    ligarItens(alvo, lista);
    pintarSino(lista);
  }

  // ── Sino ──────────────────────────────────────────────────────────
  let painel = null;

  function pintarSino(lista) {
    const botao = document.getElementById('topoSino');
    const rot = document.getElementById('topoSinoN');
    if (!botao || !rot) return;
    const n = total(lista);
    rot.hidden = n === 0;
    rot.textContent = n > 99 ? '99+' : String(n);
    botao.classList.toggle('tem-pendente', n > 0);
    botao.title = n ? `${n} pendência${n > 1 ? 's' : ''}` : 'Nada pendente';
    botao.setAttribute('aria-label', botao.title);
    // Número também na aba do navegador: com a Plataforma atrás de outra
    // janela, é o único lugar onde dá pra ver que chegou coisa.
    const semNumero = document.title.replace(/^\(\d+\+?\) /, '');
    document.title = n ? `(${n > 99 ? '99+' : n}) ${semNumero}` : semNumero;
    if (painel && !painel.hidden) desenharPainel(lista);
  }

  async function atualizarSino() {
    try { pintarSino(await carregar()); } catch (e) { /* rede: tenta de novo no próximo ciclo */ }
  }

  function desenharPainel(lista) {
    painel.innerHTML = `
      <div class="sino-cab">Pendências${lista.length ? `<span class="pend-total">${total(lista)}</span>` : ''}</div>
      ${lista.length
        ? `<div class="sino-lista">${lista.map((p, i) => itemHtml(p, i, 'sino-item')).join('')}</div>`
        : '<p class="sino-vazio"><span class="pend-ok" aria-hidden="true">✓</span> Tudo em dia. Nada esperando você.</p>'}
      <button type="button" class="sino-ver">Abrir o Início</button>`;
    ligarItens(painel, lista, fecharPainel);
    painel.querySelector('.sino-ver').addEventListener('click', () => { fecharPainel(); irPara('inicio'); });
  }

  // Posição calculada a partir do sino. No computador ele fica à direita e
  // o painel abre alinhado a ele; no celular a barra quebra e o sino vai
  // para a esquerda, onde o mesmo alinhamento jogava o painel para fora da
  // tela. Por isso a borda esquerda é presa entre 16 px e o limite direito.
  function posicionar() {
    const r = document.getElementById('topoSino').getBoundingClientRect();
    // clientWidth desconta a barra de rolagem; 100vw no CSS não desconta.
    const tela = document.documentElement.clientWidth;
    const largura = Math.min(380, tela - 32);
    painel.style.width = `${largura}px`;
    const esquerda = Math.max(16, Math.min(r.right - largura, tela - 16 - largura));
    painel.style.top = `${Math.round(r.bottom + 8)}px`;
    painel.style.left = `${Math.round(esquerda)}px`;
  }

  async function abrirPainel() {
    if (!painel) {
      painel = document.createElement('div');
      painel.className = 'sino-painel';
      painel.setAttribute('role', 'dialog');
      painel.setAttribute('aria-label', 'Pendências');
      document.body.appendChild(painel);
    }
    painel.innerHTML = '<p class="sino-vazio">Carregando…</p>';
    painel.hidden = false;
    posicionar();
    document.getElementById('topoSino').setAttribute('aria-expanded', 'true');
    try {
      const lista = await carregar();
      desenharPainel(lista);
      pintarSino(lista);
    } catch (e) {
      painel.innerHTML = '<p class="sino-vazio">Não consegui carregar as pendências.</p>';
    }
  }

  function fecharPainel() {
    if (!painel || painel.hidden) return;
    painel.hidden = true;
    document.getElementById('topoSino').setAttribute('aria-expanded', 'false');
  }

  function iniciar() {
    const botao = document.getElementById('topoSino');
    if (!botao) return;
    botao.setAttribute('aria-haspopup', 'dialog');
    botao.setAttribute('aria-expanded', 'false');
    botao.addEventListener('click', e => {
      e.stopPropagation();
      if (painel && !painel.hidden) fecharPainel(); else abrirPainel();
    });
    document.addEventListener('click', e => {
      if (painel && !painel.hidden && !painel.contains(e.target)) fecharPainel();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharPainel(); });
    window.addEventListener('resize', () => { if (painel && !painel.hidden) posicionar(); });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { carregar, atualizarSino, blocoInicio };
})();
