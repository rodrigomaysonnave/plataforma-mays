// ══════════════════════════════════════════════════════════════════════
// MÓDULO: SALA DE GUERRA
//
// Venda ativa, não cadastro. O corretor cura uma lista curta de imóveis em
// foco (não é kanban por etapa — é curadoria, cartões soltos numa grade) e
// cada card agrega o que importa pra empurrar aquele imóvel: negócios
// abertos ligados a ele, última interação, alerta de estagnação.
//
// Compartilhada pela equipe inteira (mesmo padrão de negocio/contato — RLS
// aberta pra qualquer autenticado). A agregação vem da view
// `sala_guerra_resumo` (sql/51_sala_guerra.sql) — a mesma que a extensão de
// Chrome vai consultar depois, pra não duplicar a lógica em dois lugares.
//
// `interacao.contato_id` é obrigatório no banco — não existe "nota solta"
// sobre um imóvel sem cliente por trás. Por isso registrar interação aqui
// sempre nasce de um negócio já listado no card (que já sabe o cliente).
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  const DIAS_PARADO = 7;   // mesmo limiar do Funil (mod-funil.js) e do Início
  let alvoEl = null, focos = [], imoveisTodos = null, tiposCache = null, painelAberto = null, painelEl = null;

  const brl = v => !v ? '<span class="cad-vazio">sem valor</span>' :
    'R$ ' + Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  const nomeImovel = im => `${im.codigo} · ${im.titulo || im.endereco || 'sem título'}`;

  const CANAIS = [['whatsapp', 'WhatsApp'], ['ligacao', 'Ligação'], ['email', 'E-mail'],
                  ['presencial', 'Presencial'], ['visita', 'Visita'], ['outro', 'Outro']];
  const TEMP_LABEL = { frio: 'Frio', morno: 'Morno', quente: 'Quente' };

  async function carregarImoveisTodos() {
    if (imoveisTodos) return imoveisTodos;
    imoveisTodos = await db(supabaseClient.from('imovel')
      .select('id,codigo,titulo,endereco,tipo_imovel_id').order('codigo'), 'carregar imóveis');
    return imoveisTodos;
  }

  // Mesma lista de tipos do cadastro de imóvel (Apartamento, Casa, Terreno,
  // Loja…), pra filtrar a busca de adicionar sem precisar saber o código.
  async function carregarTipos() {
    if (tiposCache) return tiposCache;
    tiposCache = await Crud.listaApoio('tipo_imovel');
    return tiposCache;
  }

  async function carregarFocos() {
    focos = await db(supabaseClient.from('sala_guerra_resumo')
      .select('*').order('foco_desde', { ascending: false }), 'carregar a sala de guerra');
  }

  function estagnado(f) {
    return f.negocios_estagnados > 0 || f.dias_sem_interacao == null || f.dias_sem_interacao >= DIAS_PARADO;
  }

  function card(f) {
    const alerta = estagnado(f);
    const motivoAlerta = f.negocios_estagnados > 0
      ? `${f.negocios_estagnados} negócio(s) parado(s)`
      : f.dias_sem_interacao == null ? 'sem interação registrada' : `${f.dias_sem_interacao}d sem interação`;
    return `
      <article class="kan-cartao sala-cartao${alerta ? ' kan-parado' : ''}" data-id="${f.foco_id}" data-imovel="${f.imovel_id}">
        <div class="kan-cliente">${esc(f.codigo)} · ${esc(f.titulo || 'sem título')}</div>
        <div class="kan-rodape">
          <span class="kan-valor">${brl(f.valor)}</span>
          <span class="cad-fin">${f.negocios_abertos} negócio(s) aberto(s)</span>
          ${alerta ? `<span class="kan-alerta" title="${esc(motivoAlerta)}">⚠</span>` : ''}
        </div>
      </article>`;
  }

  // Recalculada a cada chamada (não uma vez só) porque o filtro de tipo e
  // a própria lista de focos podem ter mudado desde o último desenho.
  function disponiveisFiltrados() {
    const jaEmFoco = new Set(focos.map(f => f.imovel_id));
    const tipoSel = document.getElementById('sgFiltroTipo')?.value || '';
    return imoveisTodos.filter(im => !jaEmFoco.has(im.id) && (!tipoSel || im.tipo_imovel_id === tipoSel));
  }

  function atualizarDatalist() {
    document.getElementById('sgImovelLista').innerHTML =
      disponiveisFiltrados().map(im => `<option value="${esc(nomeImovel(im))}">`).join('');
  }

  async function desenhar() {
    await Promise.all([carregarFocos(), carregarImoveisTodos(), carregarTipos()]);
    const abertosSoma = focos.reduce((s, f) => s + Number(f.negocios_abertos || 0), 0);
    const estagnados = focos.filter(estagnado);

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Sala de guerra</h2>
          <div class="secao-meta">Imóveis em foco pra venda ativa. Compartilhada com a equipe.
            Marque "Sala de guerra" no cadastro do imóvel, ou traga um aqui.</div></div>
        </div>
        <div class="secao-acoes">
          <select id="sgFiltroTipo"><option value="">Todo tipo</option>
            ${tiposCache.map(t => `<option value="${t.id}">${esc(t.nome)}</option>`).join('')}</select>
          <input type="text" id="sgBuscaImovel" list="sgImovelLista" autocomplete="off" placeholder="Buscar por código, título ou endereço…">
          <datalist id="sgImovelLista">${disponiveisFiltrados().map(im => `<option value="${esc(nomeImovel(im))}">`).join('')}</datalist>
          <button class="btn" id="sgAdicionar">+ Adicionar</button>
          <button class="btn" id="sgRelatorio">Relatório de atividade</button>
        </div>
      </div>

      <div class="painel-numeros">
        <div class="num"><span class="num-v">${focos.length}</span><span class="num-r">Imóveis em foco</span></div>
        <div class="num"><span class="num-v">${abertosSoma}</span><span class="num-r">Negócios abertos ligados</span></div>
        <div class="num${estagnados.length ? ' num-alerta' : ''}"><span class="num-v">${estagnados.length}</span><span class="num-r">Pedindo atenção</span></div>
      </div>

      ${focos.length === 0 ? `
        <div class="vazio"><div class="vazio-ico">◎</div>
          <h3>Nenhum imóvel em foco ainda</h3>
          <p>Traga pra cá os imóveis que a equipe está empurrando agora.
             Marque "Sala de guerra" no cadastro do imóvel, ou busque aqui em cima.</p></div>` : `
        <div class="sala-grade">${focos.map(card).join('')}</div>`}`;

    document.getElementById('sgFiltroTipo').addEventListener('change', () => {
      document.getElementById('sgBuscaImovel').value = '';
      atualizarDatalist();
    });
    document.getElementById('sgAdicionar').addEventListener('click', adicionar);
    document.getElementById('sgBuscaImovel').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); adicionar(); }
    });
    document.getElementById('sgRelatorio').addEventListener('click', gerarRelatorio);
    alvoEl.querySelectorAll('.sala-cartao').forEach(c =>
      c.addEventListener('click', () => abrirPainel(c.dataset.id, c.dataset.imovel)));
  }

  async function adicionar() {
    const campo = document.getElementById('sgBuscaImovel');
    const nome = campo.value.trim();
    if (!nome) { avisar('Digite ou escolha um imóvel na busca.'); return; }
    const disponiveis = disponiveisFiltrados();
    const achado = disponiveis.find(im => nomeImovel(im) === nome) ||
      disponiveis.find(im => nomeImovel(im).toLowerCase().includes(nome.toLowerCase()));
    if (!achado) { avisar('Não achei esse imóvel na lista (ou ele já está em foco). Escolha uma sugestão da busca.'); return; }

    // Reaproveita a linha se ela já existiu e foi desativada, em vez de
    // empilhar histórico duplicado — mesma disciplina de "não apaga,
    // desativa" do resto da plataforma.
    const [existente] = await db(supabaseClient.from('imovel_foco')
      .select('id').eq('imovel_id', achado.id).eq('ativo', false).limit(1), 'verificar foco anterior');
    if (existente) {
      await db(supabaseClient.from('imovel_foco').update({ ativo: true }).eq('id', existente.id), 'reativar foco');
    } else {
      await db(supabaseClient.from('imovel_foco').insert({
        imovel_id: achado.id, adicionado_por: Plataforma.perfil.id,
      }), 'adicionar à sala de guerra');
    }
    avisar(`${nomeImovel(achado)} entrou na sala de guerra.`);
    await desenhar();
  }

  // Painel lateral (drawer), não modal centrado: fica anexado direto no
  // body (mesmo precedente do .cp-modal em mod-corretores.js/mod-
  // campanhas.js), pra cobrir só uma faixa da tela e deixar a grade visível
  // ao lado. Único cuidado que esse precedente não tinha: como ele muda de
  // tela por conta própria (Página do cliente, ir pro negócio), toda
  // navegação daqui pra fora fecha o painel primeiro — sem isso ele fica
  // flutuando por cima do módulo seguinte.
  function garantirPainel() {
    if (painelEl) return painelEl;
    const fundo = document.createElement('div');
    fundo.className = 'sg-painel-fundo';
    fundo.innerHTML = '<div class="sg-painel" id="sgPainel"></div>';
    fundo.addEventListener('click', e => { if (e.target === fundo) fecharPainel(); });
    document.body.appendChild(fundo);
    painelEl = fundo;
    requestAnimationFrame(() => fundo.querySelector('.sg-painel').classList.add('aberto'));
    return painelEl;
  }

  function fecharPainel() {
    if (painelEl) { painelEl.remove(); painelEl = null; }
    painelAberto = null;
  }

  const quando = iso => {
    if (!iso) return null;
    const dias = Math.floor((Date.now() - new Date(iso)) / 86400000);
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'ontem';
    if (dias < 30) return `há ${dias} dias`;
    return new Date(iso).toLocaleDateString('pt-BR');
  };

  function envioHtml(e, etapas) {
    const visitas = e.selecao.visualizacoes > 0
      ? `visto ${e.selecao.visualizacoes}× · última vez ${quando(e.selecao.ultima_visualizacao_em)}`
      : 'ainda não abriu o link';
    const badge = e.item.interesse ? '<span class="sg-envio-badge sg-envio-interesse">◆ Interesse</span>' : '';
    const desativada = e.selecao.ativo ? '' : ' <span class="secao-meta">(link desativado)</span>';
    let acao;
    if (e.negocio) {
      acao = `<select class="sg-etapa-select">${etapas.map(et =>
        `<option value="${et.id}"${et.id === e.negocio.etapa_id ? ' selected' : ''}>${esc(et.nome)}</option>`).join('')}</select>
        <button class="btn btn-mini" type="button" data-salvar-etapa="${e.negocio.id}">Salvar etapa</button>`;
    } else if (e.item.interesse) {
      acao = `<button class="btn btn-mini btn-primario" type="button" data-colocar-funil="${e.item.id}" data-contato="${e.selecao.contato_id}">Colocar no funil</button>`;
    } else {
      acao = '<span class="secao-meta">Aguardando interesse</span>';
    }
    return `
      <li class="cfg-item sg-envio-item">
        <div class="cfg-item-nome"><strong>${esc(e.contatoNome)}</strong>${badge}${desativada}
          <br><span class="secao-meta">Enviado ${quando(e.selecao.created_at)} · ${esc(visitas)}</span></div>
        <div class="linha-com-botao">${acao}</div>
      </li>`;
  }

  async function abrirPainel(focoId, imovelId) {
    if (painelAberto === focoId) { fecharPainel(); return; }
    painelAberto = focoId;
    garantirPainel();
    const conteudo = document.getElementById('sgPainel');
    conteudo.innerHTML = '<div class="vazio"><p>Carregando…</p></div>';

    const f = focos.find(x => x.foco_id === focoId) || {};

    const [negocios, interacoes, etapas, itensImovel] = await Promise.all([
      db(supabaseClient.from('negocio').select('*').eq('imovel_id', imovelId)
        .order('updated_at', { ascending: false }), 'carregar negócios do imóvel'),
      db(supabaseClient.from('interacao').select('*').eq('imovel_id', imovelId)
        .order('quando', { ascending: false }).limit(20), 'carregar interações do imóvel'),
      Crud.listaApoio('etapa_funil'),
      db(supabaseClient.from('selecao_cliente_item').select('id,selecao_id,interesse,interesse_em')
        .eq('imovel_id', imovelId), 'carregar envios do imóvel'),
    ]);

    const selecaoIds = itensImovel.map(i => i.selecao_id);
    const selecoes = selecaoIds.length ? await db(supabaseClient.from('selecao_cliente')
      .select('id,contato_id,ativo,visualizacoes,ultima_visualizacao_em,created_at')
      .in('id', selecaoIds), 'carregar seleções do imóvel') : [];

    const contatoIds = [...new Set([
      ...negocios.map(n => n.contato_id), ...interacoes.map(i => i.contato_id), ...selecoes.map(s => s.contato_id),
    ].filter(Boolean))];
    const contatos = contatoIds.length ? await db(supabaseClient.from('contato')
      .select('id,nome').in('id', contatoIds), 'carregar clientes') : [];
    const nomeContato = id => (contatos.find(c => c.id === id) || {}).nome || '—';
    const nomeEtapa = id => (etapas.find(e => e.id === id) || {}).nome || '—';

    // Negócio mais recente de cada cliente ligado a ESTE imóvel (a query já
    // veio filtrada por imovel_id, e ordenada do mais novo pro mais velho —
    // por isso só grava se ainda não tinha visto o cliente).
    const negocioPorContato = new Map();
    negocios.forEach(n => { if (!negocioPorContato.has(n.contato_id)) negocioPorContato.set(n.contato_id, n); });

    const envios = itensImovel.map(it => {
      const selecao = selecoes.find(s => s.id === it.selecao_id);
      if (!selecao) return null; // seleção excluída depois do envio
      return { item: it, selecao, contatoNome: nomeContato(selecao.contato_id), negocio: negocioPorContato.get(selecao.contato_id) };
    }).filter(Boolean).sort((a, b) => new Date(b.selecao.created_at) - new Date(a.selecao.created_at));

    conteudo.innerHTML = `
      <div class="sg-painel-topo">
        <div><h2>${esc(f.codigo || '')} · ${esc(f.titulo || 'sem título')}</h2>
          <div class="secao-meta">${brl(f.valor)}</div></div>
        <button class="sg-painel-fechar" id="sgFechar" type="button" aria-label="Fechar">×</button>
      </div>

      <div class="ficha-secao">
        <div class="secao-titulo" style="margin-bottom:12px"><div><h3>Enviado para</h3></div></div>
        <button class="btn btn-primario" id="sgPaginaCliente" style="margin-bottom:12px">+ Página do cliente</button>
        ${envios.length === 0 ? '<div class="vazio"><p>Ainda não foi enviado pra ninguém.</p></div>' : `
          <ul class="cfg-itens">${envios.map(e => envioHtml(e, etapas)).join('')}</ul>`}
      </div>

      <div class="ficha-secao">
        <div class="secao-titulo" style="margin-bottom:12px">
          <div><h3>Negócios ligados a este imóvel</h3></div>
        </div>
        ${negocios.length === 0 ? '<div class="vazio"><p>Nenhum negócio aberto neste imóvel ainda.</p></div>' : `
          <table class="cad-tabela"><thead><tr>
            <th>Cliente</th><th>Etapa</th><th>Temperatura</th><th>Valor</th><th></th>
          </tr></thead><tbody>
            ${negocios.map(n => `
              <tr class="cad-linha" data-ir-negocio="${n.id}">
                <td>${esc(nomeContato(n.contato_id))}</td>
                <td>${esc(nomeEtapa(n.etapa_id))}</td>
                <td>${n.temperatura ? esc(TEMP_LABEL[n.temperatura]) : '—'}</td>
                <td>${n.valor ? brl(n.valor) : '—'}</td>
                <td><button class="btn btn-mini" type="button" data-registrar="${n.id}" data-contato="${n.contato_id}">+ Registrar</button></td>
              </tr>`).join('')}
          </tbody></table>`}
      </div>

      <div class="ficha-secao">
        <div class="secao-titulo" style="margin-bottom:12px">
          <div><h3>Histórico de interação</h3></div>
        </div>
        ${interacoes.length === 0 ? '<div class="vazio"><p>Nenhuma interação registrada neste imóvel.</p></div>' : `
          <ul class="cfg-itens">${interacoes.map(i => `
            <li class="cfg-item">
              <div class="cfg-item-nome"><strong>${esc(nomeContato(i.contato_id))}</strong> · ${esc(quando(i.quando))}
                <br><span class="secao-meta">${esc(i.resumo)}</span></div>
            </li>`).join('')}</ul>`}
      </div>

      <div class="ficha-secao">
        <button class="btn btn-remover" id="sgRemover">Remover da sala de guerra</button>
      </div>`;

    document.getElementById('sgFechar').addEventListener('click', fecharPainel);

    document.getElementById('sgPaginaCliente').addEventListener('click', () => {
      fecharPainel();
      Plataforma.irPara('selecoes', `novo-imovel:${imovelId}`);
    });

    document.getElementById('sgRemover').addEventListener('click', async () => {
      if (!confirm('Remover este imóvel da sala de guerra?')) return;
      await db(supabaseClient.from('imovel_foco').update({ ativo: false }).eq('id', focoId), 'remover foco');
      avisar('Removido da sala de guerra.');
      fecharPainel();
      await desenhar();
    });

    conteudo.querySelectorAll('[data-registrar]').forEach(b => b.addEventListener('click', () => {
      const linha = b.closest('tr');
      if (linha.querySelector('.sg-registrar-form')) return;
      const form = document.createElement('tr');
      form.innerHTML = `<td colspan="5" class="sg-registrar-form">
        <div class="linha-com-botao">
          <select class="sg-canal">${CANAIS.map(([v, r]) => `<option value="${v}">${r}</option>`).join('')}</select>
          <input type="text" class="sg-resumo" placeholder="O que aconteceu…">
          <button class="btn btn-primario btn-mini" type="button">Salvar</button>
        </div></td>`;
      linha.after(form);
      form.querySelector('button').addEventListener('click', async () => {
        const resumo = form.querySelector('.sg-resumo').value.trim();
        if (!resumo) { avisar('Descreva o que aconteceu.'); return; }
        await db(supabaseClient.from('interacao').insert({
          contato_id: b.dataset.contato, imovel_id: imovelId, negocio_id: b.dataset.registrar,
          canal: form.querySelector('.sg-canal').value, resumo, quem: Plataforma.perfil.id,
        }), 'registrar a interação');
        avisar('Interação registrada.');
        await reabrirPainel(focoId, imovelId);
      });
    }));

    // "Colocar no funil" só aparece quando já tem interesse marcado (o
    // cliente clicou "Tenho interesse" na página pública). Etapa entra
    // pré-marcada em "Proposta" — é a etapa que já corresponde a "cliente
    // confirmou interesse num imóvel específico" — mas o corretor escolhe
    // antes de confirmar.
    conteudo.querySelectorAll('[data-colocar-funil]').forEach(b => b.addEventListener('click', () => {
      const li = b.closest('li');
      if (li.nextElementSibling?.classList.contains('sg-funil-form')) return;
      const propostaId = (etapas.find(e => e.nome === 'Proposta') || etapas[0] || {}).id;
      const form = document.createElement('li');
      form.className = 'cfg-item sg-funil-form';
      form.innerHTML = `
        <div class="linha-com-botao">
          <select class="sg-nova-etapa">${etapas.map(et =>
            `<option value="${et.id}"${et.id === propostaId ? ' selected' : ''}>${esc(et.nome)}</option>`).join('')}</select>
          <select class="sg-nova-temp">
            <option value="">Sem classificação</option>
            <option value="frio">Frio</option>
            <option value="morno">Morno</option>
            <option value="quente" selected>Quente</option>
          </select>
          <button class="btn btn-primario btn-mini" type="button">Criar negócio</button>
        </div>`;
      li.after(form);
      form.querySelector('button').addEventListener('click', async () => {
        await db(supabaseClient.from('negocio').insert({
          contato_id: b.dataset.contato, imovel_id: imovelId,
          etapa_id: form.querySelector('.sg-nova-etapa').value,
          temperatura: form.querySelector('.sg-nova-temp').value || null,
        }), 'criar o negócio');
        avisar('Negócio criado.');
        await reabrirPainel(focoId, imovelId);
      });
    }));

    conteudo.querySelectorAll('[data-salvar-etapa]').forEach(b => b.addEventListener('click', async () => {
      const select = b.closest('.linha-com-botao').querySelector('.sg-etapa-select');
      await db(supabaseClient.from('negocio').update({ etapa_id: select.value }).eq('id', b.dataset.salvarEtapa), 'mudar a etapa');
      avisar('Etapa atualizada.');
      await reabrirPainel(focoId, imovelId);
    }));

    conteudo.querySelectorAll('[data-ir-negocio]').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('[data-registrar]') || e.target.closest('.sg-registrar-form')) return;
      fecharPainel();
      Plataforma.irPara('funil', tr.dataset.irNegocio);
    }));
  }

  // Recarrega o painel depois de uma ação feita nele (registrar interação,
  // criar negócio, mudar etapa), sem o efeito de "clicar de novo fecha" que
  // abrirPainel tem por padrão pro clique no card.
  async function reabrirPainel(focoId, imovelId) {
    painelAberto = null;
    await abrirPainel(focoId, imovelId);
  }

  function gerarRelatorio() {
    if (!focos.length) { avisar('Nenhum imóvel em foco pra gerar relatório.'); return; }
    const linhas = focos.map(f => `
      <tr>
        <td>${esc(f.codigo)} · ${esc(f.titulo || 'sem título')}</td>
        <td>${f.negocios_abertos}</td>
        <td>${f.negocios_estagnados}</td>
        <td>${f.dias_sem_interacao == null ? 'sem interação' : f.dias_sem_interacao + ' dia(s)'}</td>
      </tr>`).join('');

    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <title>Sala de guerra — relatório de atividade</title>
      <style>
        @page{size:A4 portrait;margin:18mm}
        body{font-family:system-ui,sans-serif;font-size:11pt;color:#1a1a1a;max-width:900px;margin:0 auto;padding:20px}
        h1{font-size:16pt;margin-bottom:4px}
        .data{color:#666;font-size:10pt;margin-bottom:24px}
        table{width:100%;border-collapse:collapse}
        th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #ddd;font-size:10.5pt}
        th{color:#555;font-weight:600}
      </style></head><body>
      <h1>Sala de guerra — relatório de atividade</h1>
      <div class="data">Gerado em ${new Date().toLocaleString('pt-BR')}</div>
      <table><thead><tr>
        <th>Imóvel</th><th>Negócios abertos</th><th>Estagnados</th><th>Última interação</th>
      </tr></thead><tbody>${linhas}</tbody></table>
      </body></html>`);
    w.document.close();
  }

  Plataforma.registrar('salaguerra', {
    titulo: 'Sala de guerra',
    async montar(alvo) { alvoEl = alvo; fecharPainel(); await desenhar(); },
  });
})();
