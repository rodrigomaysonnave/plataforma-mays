// ══════════════════════════════════════════════════════════════════════
// MÓDULO: INÍCIO
//
// Não é painel de vaidade. Mostra o que exige ação hoje e o que está travando,
// na ordem em que se trabalha: compromissos de hoje, tarefas vencidas,
// negócios parados, cadastro incompleto.
//
// Números redondos que ninguém usa (total de imóveis, total de clientes) ficam
// no rodapé, não no topo. O topo é para o que precisa de decisão.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc } = Plataforma;

  const DIAS_PARADO = 7;
  const hoje = () => new Date().toISOString().slice(0, 10);
  const hora = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const vgv = v => !v ? 'R$ 0' :
    v >= 1e6 ? `R$ ${(v/1e6).toLocaleString('pt-BR',{maximumFractionDigits:2})} M`
             : `R$ ${(v/1e3).toLocaleString('pt-BR',{maximumFractionDigits:0})} k`;

  async function montar(alvo) {
    const d = hoje();
    const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const [compromissos, tarefas, negocios, etapas, imoveis, contatos] = await Promise.all([
      db(supabaseClient.from('compromisso').select('*')
         .gte('inicio', d).lt('inicio', amanha).eq('situacao', 'marcado').order('inicio'), 'carregar agenda'),
      db(supabaseClient.from('tarefa').select('*').eq('feita', false).order('prazo'), 'carregar tarefas'),
      db(supabaseClient.from('negocio').select('*'), 'carregar negócios'),
      db(supabaseClient.from('etapa_funil').select('*'), 'carregar etapas'),
      db(supabaseClient.from('imovel').select('id,codigo,titulo,valor,publicar_no_site,rascunho'), 'carregar imóveis'),
      db(supabaseClient.from('contato').select('id,nome').eq('ativo', true), 'carregar clientes'),
    ]);

    const emAndamento = id => (etapas.find(e => e.id === id) || {}).resultado === 'andamento';
    const parados = negocios.filter(n => emAndamento(n.etapa_id) &&
      (Date.now() - new Date(n.updated_at)) / 86400000 >= DIAS_PARADO);
    const abertos = negocios.filter(n => emAndamento(n.etapa_id));
    const vgvAberto = abertos.reduce((s, n) => s + Number(n.valor || 0), 0);
    const vencidas = tarefas.filter(t => t.prazo && t.prazo < d);
    const semValor = imoveis.filter(i => !i.rascunho && i.valor == null);
    const rascunhos = imoveis.filter(i => i.rascunho);
    const nome = id => (contatos.find(c => c.id === id) || {}).nome || 'sem cliente';

    const bloco = (titulo, itens, vazio, render) => `
      <section class="ini-bloco">
        <h3>${esc(titulo)}<span class="ini-conta">${itens.length}</span></h3>
        ${itens.length ? `<ul class="ini-lista">${itens.map(render).join('')}</ul>`
                       : `<p class="ini-vazio">${esc(vazio)}</p>`}
      </section>`;

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Início</h2>
          <div class="secao-meta">${new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long' })}</div></div>
        </div>
      </div>

      <div class="painel-numeros">
        <div class="num${compromissos.length ? ' num-destaque' : ''}"><span class="num-v">${compromissos.length}</span><span class="num-r">Compromissos hoje</span></div>
        <div class="num${vencidas.length ? ' num-alerta' : ''}"><span class="num-v">${vencidas.length}</span><span class="num-r">Tarefas vencidas</span></div>
        <div class="num${parados.length ? ' num-alerta' : ''}"><span class="num-v">${parados.length}</span><span class="num-r">Negócios parados</span></div>
        <div class="num"><span class="num-v">${abertos.length}</span><span class="num-r">Negócios em aberto</span></div>
        <div class="num"><span class="num-v">${vgv(vgvAberto)}</span><span class="num-r">VGV em aberto</span></div>
      </div>

      <div class="ini-grade">
        ${bloco('Agenda de hoje', compromissos, 'Nada marcado para hoje.',
          c => `<li><span class="ini-hora">${hora(c.inicio)}</span>
                    <span class="ini-txt">${esc(c.titulo)}</span>
                    <span class="ini-sub">${esc(c.local || nome(c.contato_id))}</span></li>`)}

        ${bloco('Tarefas em aberto', tarefas.slice(0, 8), 'Nenhuma tarefa pendente.',
          t => `<li><span class="ini-hora${t.prazo && t.prazo < d ? ' ini-vencida' : ''}">
                      ${t.prazo ? new Date(t.prazo + 'T12:00:00').toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit'}) : '—'}</span>
                    <span class="ini-txt">${esc(t.titulo)}</span></li>`)}

        ${bloco('Negócios parados', parados.slice(0, 8), 'Nenhum negócio estagnado. Bom sinal.',
          n => `<li><span class="ini-hora ini-vencida">${Math.floor((Date.now()-new Date(n.updated_at))/86400000)}d</span>
                    <span class="ini-txt">${esc(nome(n.contato_id))}</span>
                    <span class="ini-sub">${n.valor ? vgv(n.valor) : 'sem valor'}</span></li>`)}

        ${bloco('Cadastro para completar', [...rascunhos, ...semValor].slice(0, 8),
          'Nenhum cadastro pendente.',
          i => `<li><span class="ini-hora">${esc(i.codigo || '—')}</span>
                    <span class="ini-txt">${esc(i.titulo || 'sem título')}</span>
                    <span class="ini-sub">${i.rascunho ? 'rascunho' : 'sem valor'}</span></li>`)}
      </div>

      <div class="ini-rodape">
        ${imoveis.filter(i => !i.rascunho).length} imóveis ·
        ${imoveis.filter(i => i.publicar_no_site).length} publicados ·
        ${contatos.length} clientes
      </div>`;
  }

  Plataforma.registrar('inicio', { titulo: 'Início', montar });
})();
