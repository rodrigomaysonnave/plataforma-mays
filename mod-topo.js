// ══════════════════════════════════════════════════════════════════════
// BARRA SUPERIOR — atalhos de acesso rápido
//
// A sidebar já navega pro sistema inteiro. Isto aqui não substitui ela: é
// atalho pra quatro ações que se repetem o dia inteiro (Início, Imóveis,
// Clientes, CRM), abrindo ao passar o mouse, do jeito que o Tecimob faz.
//
// Início não navega pra lugar nenhum — mostra um painel com números.
// mod-inicio.js deixa esses números fora da tela de Início de propósito
// ("Números redondos que ninguém usa ficam no rodapé, não no topo"); aqui é
// uma superfície diferente e complementar, então cabem: são o resumo pra
// quem só quer bater o olho sem entrar em módulo nenhum.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, irPara } = Plataforma;

  const DIAS_DESATUALIZADO = 60;
  const ATRASO_FECHAR = 180; // ms — dá tempo de mover o mouse do botão até o painel

  const vgv = v => !v ? 'R$ 0' :
    v >= 1e6 ? `R$ ${(v/1e6).toLocaleString('pt-BR',{maximumFractionDigits:2})} M`
             : `R$ ${(v/1e3).toLocaleString('pt-BR',{maximumFractionDigits:0})} k`;

  let panorama = null; // cache — mesmo painel, não busca de novo a cada hover

  async function carregarPanorama() {
    if (panorama) return panorama;
    const limite = new Date(Date.now() - DIAS_DESATUALIZADO * 86400000).toISOString();
    const [publicados, desatualizados, negocios, etapas] = await Promise.all([
      db(supabaseClient.from('imovel').select('valor,finalidade')
         .eq('publicar_no_site', true).eq('rascunho', false), 'carregar imóveis publicados'),
      db(supabaseClient.from('imovel').select('id')
         .eq('rascunho', false).lt('updated_at', limite), 'carregar imóveis desatualizados'),
      db(supabaseClient.from('negocio').select('etapa_id'), 'carregar negócios'),
      db(supabaseClient.from('etapa_funil').select('id,resultado'), 'carregar etapas'),
    ]);
    const emAndamento = new Set(etapas.filter(e => e.resultado === 'andamento').map(e => e.id));
    panorama = {
      totalPublicados: publicados.length,
      valorTotal: publicados.filter(i => (i.finalidade || 'venda') !== 'aluguel')
                             .reduce((s, i) => s + Number(i.valor || 0), 0),
      desatualizados: desatualizados.length,
      clientesEmAtendimento: negocios.filter(n => emAndamento.has(n.etapa_id)).length,
    };
    return panorama;
  }

  async function desenharPanorama() {
    const alvo = document.getElementById('flyoutInicio');
    if (!alvo || alvo.dataset.pronto) return;
    try {
      const p = await carregarPanorama();
      alvo.dataset.pronto = '1';
      alvo.innerHTML = `
        <div class="topo-numeros">
          <div class="topo-num"><span class="topo-num-v">${p.totalPublicados}</span><span class="topo-num-r">Imóveis anunciados</span></div>
          <div class="topo-num"><span class="topo-num-v">${esc(vgv(p.valorTotal))}</span><span class="topo-num-r">Valor total à venda</span></div>
          <div class="topo-num${p.desatualizados ? ' topo-num-alerta' : ''}"><span class="topo-num-v">${p.desatualizados}</span><span class="topo-num-r">Imóveis desatualizados</span></div>
          <div class="topo-num"><span class="topo-num-v">${p.clientesEmAtendimento}</span><span class="topo-num-r">Clientes em atendimento</span></div>
        </div>
        <button class="topo-flyout-item topo-flyout-ver" data-ir="inicio">Ver painel completo</button>`;
      alvo.querySelectorAll('[data-ir]').forEach(ligarClique);
    } catch (e) {
      alvo.innerHTML = `<p class="flyout-erro">Não consegui carregar os números.</p>`;
    }
  }

  function ligarClique(el) {
    el.addEventListener('click', () => {
      irPara(el.dataset.ir, el.dataset.arg);
      document.querySelectorAll('.topo-atalho.aberto').forEach(a => a.classList.remove('aberto'));
    });
  }

  function ligarHover() {
    document.querySelectorAll('.topo-atalho').forEach(atalho => {
      let fecharEm = null;
      const abrir = () => {
        clearTimeout(fecharEm);
        document.querySelectorAll('.topo-atalho.aberto').forEach(a => { if (a !== atalho) a.classList.remove('aberto'); });
        atalho.classList.add('aberto');
        if (atalho.querySelector('#flyoutInicio')) desenharPanorama();
      };
      const fechar = () => { fecharEm = setTimeout(() => atalho.classList.remove('aberto'), ATRASO_FECHAR); };
      atalho.addEventListener('mouseenter', abrir);
      atalho.addEventListener('mouseleave', fechar);
      atalho.addEventListener('focusin', abrir);
      atalho.addEventListener('focusout', fechar);
    });
    document.querySelectorAll('.topo-atalhos [data-ir]').forEach(ligarClique);
  }

  document.addEventListener('DOMContentLoaded', ligarHover);
})();
