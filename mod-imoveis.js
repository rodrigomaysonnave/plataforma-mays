// ══════════════════════════════════════════════════════════════════════
// MÓDULO: IMÓVEIS
//
// Duas telas: a LISTA (catálogo, colunas, filtros) e a FICHA (cadastro em
// seções). Ficha em página inteira e não em janela flutuante: são doze
// seções, e formulário longo dentro de modal é desconfortável de usar.
//
// Os seletores são alimentados pelas tabelas de Configurações. Nenhuma lista
// escrita aqui dentro — foi exatamente esse o defeito do sistema anterior,
// onde não existia "Casa" porque os tipos viviam dentro do HTML.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  let apoio = null;      // listas de configuração, carregadas uma vez
  let alvoEl = null;
  let editando = null;   // id do imóvel aberto, ou 'novo'

  const FINALIDADES = [['venda','Venda'],['aluguel','Aluguel'],['venda_aluguel','Venda e aluguel']];
  const SITUACOES   = [['novo','Novo'],['usado','Usado'],['em_construcao','Em construção'],
                       ['na_planta','Na planta'],['reformar','Para reformar']];
  const STATUS      = [['disponivel','Disponível'],['reservado','Reservado'],['vendido','Vendido'],
                       ['alugado','Alugado'],['suspenso','Suspenso']];

  const rotulo = (lista, v) => (lista.find(x => x[0] === v) || [,'—'])[1];

  const moeda = v => v == null ? null :
    Number(v) >= 1e6 ? `R$ ${(v/1e6).toLocaleString('pt-BR',{maximumFractionDigits:2})} M`
                     : `R$ ${(v/1e3).toLocaleString('pt-BR',{maximumFractionDigits:0})} k`;

  const num = v => v == null || v === '' ? null : Number(v);

  // ── SEO ────────────────────────────────────────────────────────────
  // As mesmas regras que o gerador do site aplica quando o campo está vazio.
  // Mostrar aqui como sugestão evita o defeito do site atual dele, onde
  // nenhuma página tem resumo porque o campo era opcional e ninguém preenchia.
  function sugestaoSeo(dados) {
    const t = (apoio.tipos.find(x => x.id === dados.tipo_imovel_id) || {}).nome || 'Imóvel';
    const b = (apoio.bairros.find(x => x.id === dados.bairro_id) || {}).nome;
    const c = (apoio.cidades.find(x => x.id === dados.cidade_id) || {}).nome || 'Pelotas';
    const fin = dados.finalidade === 'aluguel' ? 'para alugar'
              : dados.finalidade === 'venda_aluguel' ? 'à venda ou para alugar' : 'à venda';

    const titulo = [`${t} ${fin}`, b && `no ${b}`, `${c}/RS`].filter(Boolean).join(' ');

    const partes = [];
    if (dados.dormitorios) partes.push(`${dados.dormitorios} dormitório${dados.dormitorios>1?'s':''}`);
    if (dados.suites)      partes.push(`${dados.suites} suíte${dados.suites>1?'s':''}`);
    if (dados.vagas)       partes.push(`${dados.vagas} vaga${dados.vagas>1?'s':''}`);
    if (dados.area_util)   partes.push(`${Number(dados.area_util).toLocaleString('pt-BR')} m²`);
    else if (dados.area_total) partes.push(`terreno de ${Number(dados.area_total).toLocaleString('pt-BR')} m²`);

    const valor = dados.valor
      ? ` Por R$ ${Number(dados.valor).toLocaleString('pt-BR', {maximumFractionDigits:0})}.` : '';

    const desc = `${t} ${fin}${b ? ` no bairro ${b}` : ''}, em ${c}/RS.`
      + (partes.length ? ` ${partes.join(', ')}.` : '')
      + valor
      + ' Fale com Rodrigo Maysonnave, corretor e perito avaliador.';

    return { titulo: titulo.slice(0, 60), descricao: desc.slice(0, 158) };
  }

  async function carregarApoio() {
    if (apoio) return apoio;
    const pega = (t, extra) => supabaseClient.from(t).select(extra || 'id,nome').eq('ativo', true).order('ordem').order('nome');
    const [tipos, subtipos, cidades, bairros, zonas, caracts, origens, props, cfgs] = await Promise.all([
      db(pega('tipo_imovel','id,nome,segmento'), 'carregar tipos'),
      db(supabaseClient.from('subtipo_imovel').select('id,nome,tipo_imovel_id').eq('ativo',true).order('ordem'), 'carregar subtipos'),
      db(pega('cidade'), 'carregar cidades'),
      db(pega('bairro'), 'carregar bairros'),
      db(pega('zona'), 'carregar zonas'),
      db(pega('caracteristica'), 'carregar características'),
      db(pega('origem_captacao'), 'carregar origens'),
      db(supabaseClient.from('proprietario').select('id,nome').eq('ativo',true).order('nome'), 'carregar proprietários'),
      db(supabaseClient.from('configuracao').select('site_url').limit(1), 'carregar configuração'),
    ]);
    apoio = { tipos, subtipos, cidades, bairros, zonas, caracts, origens, props,
              siteUrl: (cfgs[0] && cfgs[0].site_url) || null };
    return apoio;
  }

  const opcoes = (lista, sel, vazio = '—') =>
    `<option value="">${vazio}</option>` + lista.map(o =>
      `<option value="${o.id ?? o[0]}"${String(o.id ?? o[0]) === String(sel ?? '') ? ' selected' : ''}>${esc(o.nome ?? o[1])}</option>`).join('');

  // ══════════════════════════════════════════════════════════════════
  // LISTA
  // ══════════════════════════════════════════════════════════════════
  function selosOnde(im) {
    const s = [];
    if (im.no_mural)            s.push(['mural','Mural']);
    if (im.publicar_no_site)    s.push(['vitrine','Site']);
    if (im.divulgacao_restrita) s.push(['restrito','Restrito']);
    if (im.destaque)            s.push(['autorizado','Destaque']);
    if (im.alto_padrao)         s.push(['vitrine','Alto padrão']);
    if (im.rascunho) return '<span class="cad-selo cad-selo-restrito">Rascunho</span>';
    return s.length ? s.map(([c,t]) => `<span class="cad-selo cad-selo-${c}">${t}</span>`).join('')
                    : '<span class="cad-selo cad-selo-vazio">nenhum</span>';
  }

  function linha(im) {
    const t = apoio.tipos.find(x => x.id === im.tipo_imovel_id);
    const b = apoio.bairros.find(x => x.id === im.bairro_id);
    const det = [
      im.dormitorios ? `${im.dormitorios} dorm` : null,
      im.suites      ? `${im.suites} suíte${im.suites>1?'s':''}` : null,
      im.vagas       ? `${im.vagas} vaga${im.vagas>1?'s':''}` : null,
    ].filter(Boolean).join(' · ');
    const areas = [
      im.area_util  ? `${Number(im.area_util).toLocaleString('pt-BR')} m² úteis` : null,
      im.area_total ? `${Number(im.area_total).toLocaleString('pt-BR')} m² terreno` : null,
    ].filter(Boolean).join(' · ');

    return `
      <tr class="cad-linha" data-id="${im.id}">
        <td class="cad-codigo">${esc(im.codigo || '—')}</td>
        <td><span class="cad-fin">${esc(rotulo(FINALIDADES, im.finalidade))}</span></td>
        <td>${esc(t ? t.nome : '—')}</td>
        <td class="cad-end">
          <div class="cad-end-rua">${esc(im.titulo || im.endereco || 'sem título')}</div>
          <div class="cad-end-sub">${esc(b ? b.nome : '—')}${im.endereco && im.titulo ? ' · ' + esc(im.endereco) : ''}</div>
        </td>
        <td class="cad-num">${areas || '—'}</td>
        <td class="cad-num">${det || '—'}</td>
        <td class="cad-valor">${moeda(im.valor) || '<span class="cad-vazio">sem valor</span>'}</td>
        <td><span class="cad-selo cad-selo-${im.status === 'disponivel' ? 'autorizado' : 'restrito'}">${esc(rotulo(STATUS, im.status))}</span></td>
        <td class="cad-onde">${selosOnde(im)}</td>
      </tr>`;
  }

  function filtrar(lista) {
    const q   = (document.getElementById('imBusca')?.value || '').trim().toLowerCase();
    const fin = document.getElementById('imFinalidade')?.value || '';
    const tp  = document.getElementById('imTipo')?.value || '';
    const st  = document.getElementById('imStatus')?.value || '';
    return lista.filter(im => {
      if (fin && im.finalidade !== fin) return false;
      if (tp  && im.tipo_imovel_id !== tp) return false;
      if (st  && im.status !== st) return false;
      if (q) {
        const b = apoio.bairros.find(x => x.id === im.bairro_id);
        const alvo = [im.codigo, im.titulo, im.endereco, b && b.nome].filter(Boolean).join(' ').toLowerCase();
        if (!alvo.includes(q)) return false;
      }
      return true;
    });
  }

  async function desenharLista() {
    const todos = await db(supabaseClient.from('imovel').select('*').order('created_at', { ascending: false }), 'carregar imóveis');
    const lista = filtrar(todos);
    const corpo = document.getElementById('imCorpo');
    const meta  = document.getElementById('imMeta');

    meta.textContent = lista.length === todos.length
      ? `${todos.length} imóvel${todos.length === 1 ? '' : 'is'} no catálogo`
      : `${lista.length} de ${todos.length} imóveis`;

    if (!todos.length) {
      corpo.innerHTML = `
        <div class="vazio">
          <div class="vazio-ico">◎</div>
          <h3>Nenhum imóvel cadastrado ainda</h3>
          <p>Comece pelo botão <strong>Cadastrar imóvel</strong>, ali em cima à direita.</p>
        </div>`;
      return;
    }
    if (!lista.length) {
      corpo.innerHTML = `<div class="vazio"><div class="vazio-ico">◎</div>
        <h3>Nenhum imóvel com esse filtro</h3><p>Ajuste a busca ou limpe os filtros.</p></div>`;
      return;
    }

    corpo.innerHTML = `
      <div class="cad-tabela-scroll">
        <table class="cad-tabela">
          <thead><tr>
            <th>Código</th><th>Finalidade</th><th>Tipo</th><th>Imóvel</th>
            <th>Áreas</th><th>Detalhes</th><th>Valor</th><th>Situação</th><th>Onde aparece</th>
          </tr></thead>
          <tbody>${lista.map(linha).join('')}</tbody>
        </table>
      </div>`;
    corpo.querySelectorAll('.cad-linha').forEach(tr =>
      tr.addEventListener('click', () => abrirFicha(tr.dataset.id)));
  }

  async function montarLista() {
    await carregarApoio();
    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo">
          <div class="ponto"></div>
          <div><h2>Imóveis</h2><div class="secao-meta" id="imMeta">Carregando…</div></div>
        </div>
        <div class="secao-acoes">
          <input type="search" id="imBusca" placeholder="Código, título, endereço, bairro…">
          <select id="imFinalidade"><option value="">Toda finalidade</option>
            ${FINALIDADES.map(([v,r]) => `<option value="${v}">${r}</option>`).join('')}</select>
          <select id="imTipo"><option value="">Todo tipo</option>
            ${apoio.tipos.map(t => `<option value="${t.id}">${esc(t.nome)}</option>`).join('')}</select>
          <select id="imStatus"><option value="">Toda situação</option>
            ${STATUS.map(([v,r]) => `<option value="${v}">${r}</option>`).join('')}</select>
          <button class="btn btn-primario" id="imNovo">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            Cadastrar imóvel
          </button>
        </div>
      </div>
      <div id="imCorpo"></div>`;

    document.getElementById('imNovo').addEventListener('click', () => abrirFicha('novo'));
    ['imBusca','imFinalidade','imTipo','imStatus'].forEach(id =>
      document.getElementById(id).addEventListener('input', desenharLista));
    await desenharLista();
  }

  // ══════════════════════════════════════════════════════════════════
  // FICHA
  // ══════════════════════════════════════════════════════════════════
  const secao = (titulo, dica, dentro) => `
    <div class="ficha-secao">
      <div class="ficha-secao-topo">
        <h3>${titulo}</h3>${dica ? `<p>${dica}</p>` : ''}
      </div>
      <div class="ficha-grade">${dentro}</div>
    </div>`;

  const campo = (rot, dentro, largo) =>
    `<div class="campo${largo ? ' campo-largo' : ''}">${rot ? `<label>${rot}</label>` : ''}${dentro}</div>`;

  const txt = (id, v, ph = '') => `<input type="text" id="${id}" value="${esc(v ?? '')}" placeholder="${ph}">`;
  const nmr = (id, v, ph = '', passo = '1') =>
    `<input type="number" id="${id}" value="${v ?? ''}" placeholder="${ph}" step="${passo}" min="0">`;

  async function abrirFicha(id) {
    // Imóvel novo nasce JÁ no banco, marcado como rascunho. É o que permite
    // enviar foto durante o cadastro: foto precisa de um imóvel existente pra
    // se ligar, e obrigar a salvar antes quebrava o jeito natural de trabalhar
    // (quem chega com as fotos na mão quer soltar tudo junto).
    if (id === 'novo') {
      const r = await db(supabaseClient.from('imovel')
        .insert({ rascunho: true, finalidade: 'venda', status: 'disponivel' })
        .select('id'), 'iniciar o cadastro');
      id = r[0].id;
    }
    editando = id;
    await carregarApoio();
    const im = (await db(supabaseClient.from('imovel').select('*').eq('id', id).limit(1), 'abrir imóvel'))[0];
    const novo = !!im.rascunho;

    const marcadas = (await db(supabaseClient.from('imovel_caracteristica')
      .select('caracteristica_id').eq('imovel_id', id), 'carregar características')).map(x => x.caracteristica_id);

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo">
          <div class="ponto"></div>
          <div>
            <h2>${esc(im.codigo || 'Imóvel')}${novo ? ' <span class="cad-selo cad-selo-restrito">Rascunho</span>' : ''}</h2>
            <div class="secao-meta">${novo ? 'Rascunho. Já dá para enviar fotos; ele só entra no catálogo ao salvar.' : esc(im.titulo || im.endereco || '')}</div>
          </div>
        </div>
        <div class="secao-acoes">
          ${botaoVerNoSite(im)}
          <button class="btn btn-remover" id="imExcluir">Excluir</button>
          <button class="btn" id="imVoltar">Voltar à lista</button>
          <button class="btn btn-primario" id="imSalvar">Salvar</button>
        </div>
      </div>

      ${secao('Finalidade e tipo', 'O tipo define quais campos fazem sentido adiante.',
        campo('Finalidade', `<select id="fFinalidade">${FINALIDADES.map(([v,r]) => `<option value="${v}"${im.finalidade===v?' selected':''}>${r}</option>`).join('')}</select>`) +
        campo('Tipo', `<select id="fTipo">${opcoes(apoio.tipos, im.tipo_imovel_id, 'Selecione')}</select>`) +
        campo('Subtipo', `<select id="fSubtipo">${opcoes(apoio.subtipos.filter(s => s.tipo_imovel_id === im.tipo_imovel_id), im.subtipo_imovel_id)}</select>`) +
        campo('Situação', `<select id="fSituacao">${opcoes(SITUACOES, im.situacao)}</select>`)
      )}

      ${secao('Localização', '',
        campo('Endereço', txt('fEndereco', im.endereco, 'Rua e nome'), true) +
        campo('Número', txt('fNumero', im.numero)) +
        campo('Complemento', txt('fComplemento', im.complemento)) +
        campo('Bairro', `<select id="fBairro">${opcoes(apoio.bairros, im.bairro_id)}</select>`) +
        campo('Cidade', `<select id="fCidade">${opcoes(apoio.cidades, im.cidade_id)}</select>`) +
        campo('Zona', `<select id="fZona">${opcoes(apoio.zonas, im.zona_id)}</select>`) +
        campo('CEP', txt('fCep', im.cep))
      )}

      ${secao('Proprietário', '',
        campo('Proprietário',
          `<div class="linha-com-botao">
             <select id="fProprietario">${opcoes(apoio.props, im.proprietario_id, 'Nenhum')}</select>
             <button class="btn" id="propNovo" type="button">+ Novo</button>
           </div>
           <div class="prop-form" id="propForm" hidden>
             <input type="text" id="propNome" placeholder="Nome completo">
             <input type="text" id="propTelefone" placeholder="Telefone">
             <input type="email" id="propEmail" placeholder="E-mail (opcional)">
             <button class="btn btn-primario" id="propSalvar" type="button">Salvar proprietário</button>
             <button class="btn" id="propCancelar" type="button">Cancelar</button>
           </div>`, true)
      )}

      ${secao('Valores', 'Guardados como número, então dá para filtrar por faixa e somar a carteira.',
        campo('Valor de venda (R$)', nmr('fValor', im.valor, 'Ex: 850000', '0.01')) +
        campo('Valor de aluguel (R$)', nmr('fValorAluguel', im.valor_aluguel, '', '0.01')) +
        campo('IPTU (R$)', nmr('fIptu', im.iptu, '', '0.01')) +
        campo('Condomínio (R$)', nmr('fCondominio', im.condominio, '', '0.01')) +
        campo('', `<label class="check"><input type="checkbox" id="fFinanciamento"${im.aceita_financiamento?' checked':''}> Aceita financiamento</label>`) +
        campo('', `<label class="check"><input type="checkbox" id="fPermuta"${im.aceita_permuta?' checked':''}> Aceita permuta</label>`)
      )}

      ${secao('Medidas e detalhes', 'Preencha o que fizer sentido para o tipo. Terreno usa testada e profundidade; apartamento usa dormitórios e vagas.',
        campo('Dormitórios', nmr('fDormitorios', im.dormitorios)) +
        campo('Suítes', nmr('fSuites', im.suites)) +
        campo('Banheiros', nmr('fBanheiros', im.banheiros)) +
        campo('Vagas', nmr('fVagas', im.vagas)) +
        campo('Área útil (m²)', nmr('fAreaUtil', im.area_util, 'construída', '0.01')) +
        campo('Área total (m²)', nmr('fAreaTotal', im.area_total, 'terreno', '0.01')) +
        campo('Testada (m)', nmr('fTestada', im.testada, '', '0.01')) +
        campo('Profundidade (m)', nmr('fProfundidade', im.profundidade, '', '0.01')) +
        campo('Ano de construção', nmr('fAno', im.ano_construcao, 'Ex: 2018')) +
        campo('Andar', nmr('fAndar', im.andar)) +
        campo('Total de andares', nmr('fTotalAndares', im.total_andares))
      )}

      ${secao('Características', 'A lista sai das Configurações. Falta alguma? Adicione lá e ela aparece aqui.',
        `<div class="chips" id="fCaracteristicas">${apoio.caracts.map(c => `
          <label class="chip"><input type="checkbox" value="${c.id}"${marcadas.includes(c.id)?' checked':''}> ${esc(c.nome)}</label>`).join('')}</div>`
      )}

      ${secao('Fotos', 'A capa é a que aparece no cartão e no site. Cada foto sobe em duas versões: grande para a galeria e miniatura para as listas.',
            '<div class="fotos" id="fotosImovel" style="grid-column:1/-1"></div>')}

      ${secao('Anúncio', 'O que aparece no site. Diferente das notas internas, que ninguém de fora vê.',
        campo('Título', txt('fTitulo', im.titulo, 'Ex: Apartamento 3 dormitórios no Centro'), true) +
        campo('Selo', txt('fSelo', im.selo, 'Ex: Vista para o mar, Abaixo do preço')) +
        campo('Descrição pública', `<textarea id="fDescricao" rows="5" placeholder="Texto do anúncio">${esc(im.descricao_publica ?? '')}</textarea>`, true)
      )}

      ${secao('Endereço na web e busca',
        'Como este imóvel aparece no Google e no WhatsApp. Deixe em branco para usar o texto automático: assim nenhuma página fica sem resumo.',
        campo('Endereço da página',
          `<div class="seo-url"><span>/imovel/</span>${txt('fSlug', im.slug, 'gerado automaticamente')}</div>
           <p class="campo-dica">Muda o link já compartilhado e o que o Google indexou. Só altere se souber o efeito.</p>`, true) +
        campo('Título na busca', txt('fMetaTitulo', im.meta_titulo, ''), true) +
        campo('Resumo na busca', `<textarea id="fMetaDescricao" rows="3" placeholder="">${esc(im.meta_descricao ?? '')}</textarea>`, true) +
        `<div class="seo-previa" id="seoPrevia" style="grid-column:1/-1"></div>`
      )}

      ${secao('Divulgação', 'Links das peças. Aparecem como botão quando existem.',
        campo('Landing page', txt('fLinkLp', im.link_lp, 'https://')) +
        campo('Vídeo no YouTube', txt('fLinkVideo', im.link_video, 'https://')) +
        campo('Tour 360°', txt('fLinkTour', im.link_tour360, 'https://')) +
        campo('Link do anúncio', txt('fLinkAnuncio', im.link_anuncio, 'https://'))
      )}

      ${secao('Onde este imóvel aparece', 'São quatro marcações independentes e fáceis de confundir. Por isso ficam juntas.',
        `<div class="onde">
          <label class="check"><input type="checkbox" id="fMural"${im.no_mural?' checked':''}>
            <span><strong>No mural</strong><em>Aparece no teu radar de trabalho. Não tem nada a ver com o site.</em></span></label>
          <label class="check"><input type="checkbox" id="fAutorizacao"${im.autorizacao_venda?' checked':''}>
            <span><strong>Autorização de venda registrada</strong><em>Sem isto o imóvel não pode ser publicado. O banco recusa.</em></span></label>
          <label class="check"><input type="checkbox" id="fSite"${im.publicar_no_site?' checked':''}>
            <span><strong>Publicar no site</strong><em>Vai para a vitrine pública. Exige autorização de venda.</em></span></label>
          <label class="check"><input type="checkbox" id="fRestrita"${im.divulgacao_restrita?' checked':''}>
            <span><strong>Divulgação restrita</strong><em>O proprietário não autoriza rede social nem WhatsApp. Mostrar ao vivo. Impede a publicação no site.</em></span></label>
          <label class="check"><input type="checkbox" id="fDestaque"${im.destaque?' checked':''}>
            <span><strong>Destaque</strong><em>Aparece nas seções de destaque do site.</em></span></label>
          <label class="check"><input type="checkbox" id="fAltoPadrao"${im.alto_padrao?' checked':''}>
            <span><strong>Alto padrão</strong><em>Monta a vitrine de alto padrão do site.
              É curadoria sua, não faixa de preço: quem decide o padrão é quem conhece o imóvel.</em></span></label>
        </div>`
      )}

      ${secao('Situação e captação', '',
        campo('Situação comercial', `<select id="fStatus">${STATUS.map(([v,r]) => `<option value="${v}"${im.status===v?' selected':''}>${r}</option>`).join('')}</select>`) +
        campo('Origem da captação', `<select id="fOrigem">${opcoes(apoio.origens, im.origem_captacao_id)}</select>`) +
        campo('Captado em', `<input type="date" id="fCaptadoEm" value="${im.captado_em ?? ''}">`)
      )}

      ${secao('Notas internas', 'Só a equipe vê. Nunca sai daqui, nem para o site nem para portal.',
        campo('', `<textarea id="fObs" rows="4" placeholder="Condições, histórico com o proprietário, o que não vai para o anúncio">${esc(im.obs_internas ?? '')}</textarea>`, true)
      )}

      <div class="ficha-rodape">
        <button class="btn" id="imVoltar2">Voltar à lista</button>
        <button class="btn btn-primario" id="imSalvar2">Salvar</button>
      </div>`;

    function atualizarPrevia() {
      const dados = {
        tipo_imovel_id: document.getElementById('fTipo').value,
        bairro_id: document.getElementById('fBairro').value,
        cidade_id: document.getElementById('fCidade').value,
        finalidade: document.getElementById('fFinalidade').value,
        dormitorios: num(document.getElementById('fDormitorios').value),
        suites: num(document.getElementById('fSuites').value),
        vagas: num(document.getElementById('fVagas').value),
        area_util: num(document.getElementById('fAreaUtil').value),
        area_total: num(document.getElementById('fAreaTotal').value),
        valor: num(document.getElementById('fValor').value),
      };
      const sug = sugestaoSeo(dados);
      const tit = document.getElementById('fMetaTitulo');
      const des = document.getElementById('fMetaDescricao');
      tit.placeholder = sug.titulo;
      des.placeholder = sug.descricao;
      const tituloUsado = tit.value.trim() || sug.titulo;
      const descUsada   = des.value.trim() || sug.descricao;
      const slug = document.getElementById('fSlug').value.trim() || '(gerado ao salvar)';
      document.getElementById('seoPrevia').innerHTML = `
        <div class="seo-cartao">
          <div class="seo-rot">Como fica no Google</div>
          <div class="seo-url-previa">maysimoveis.com › imovel › ${esc(slug)}</div>
          <div class="seo-titulo-previa">${esc(tituloUsado)}</div>
          <div class="seo-desc-previa">${esc(descUsada)}</div>
          <div class="seo-conta">${tituloUsado.length}/60 no título · ${descUsada.length}/158 no resumo</div>
        </div>`;
    }
    ['fTipo','fBairro','fCidade','fFinalidade','fDormitorios','fSuites','fVagas',
     'fAreaUtil','fAreaTotal','fValor','fMetaTitulo','fMetaDescricao','fSlug']
      .forEach(i => document.getElementById(i).addEventListener('input', atualizarPrevia));
    atualizarPrevia();

    Fotos.montar(document.getElementById('fotosImovel'),
                 { tabela: 'imovel_foto', coluna: 'imovel_id', id, pasta: 'imoveis' });

    // Subtipo segue o tipo escolhido
    document.getElementById('fTipo').addEventListener('change', e => {
      const subs = apoio.subtipos.filter(s => s.tipo_imovel_id === e.target.value);
      document.getElementById('fSubtipo').innerHTML = opcoes(subs, null);
    });

    ['imVoltar','imVoltar2'].forEach(i => document.getElementById(i).addEventListener('click', voltar));
    ['imSalvar','imSalvar2'].forEach(i => document.getElementById(i).addEventListener('click', salvar));
    document.getElementById('imExcluir').addEventListener('click', () => excluir(novo));
    ligarProprietario();
    ligarVerNoSite();
  }

  // Diz a verdade sobre o estado em vez de abrir uma página que não existe.
  // Três situações diferentes, três respostas diferentes.
  function botaoVerNoSite(im) {
    if (!apoio.siteUrl) {
      return `<button class="btn" id="imVerSite" data-motivo="sem-site"
                title="O endereço do site ainda não foi configurado">Ver no site</button>`;
    }
    if (!im.publicar_no_site) {
      return `<button class="btn" id="imVerSite" data-motivo="nao-publicado"
                title="Este imóvel não está publicado">Ver no site</button>`;
    }
    const url = `${apoio.siteUrl.replace(/\/$/, '')}/imovel/${im.slug || ''}`;
    return `<a class="btn" id="imVerSite" href="${esc(url)}" target="_blank" rel="noopener">
              Ver no site ↗</a>`;
  }

  function ligarVerNoSite() {
    const b = document.getElementById('imVerSite');
    if (!b || !b.dataset.motivo) return;
    b.addEventListener('click', () => avisar(b.dataset.motivo === 'sem-site'
      ? 'O endereço do site ainda não foi configurado. Configurações → Ajustes gerais.'
      : 'Este imóvel ainda não está publicado. Marque "Publicar no site" e salve.'));
  }

  // Cadastrar proprietário sem sair da ficha do imóvel. Antes era preciso
  // abandonar o cadastro, ir a outra tela que nem existe ainda, e voltar.
  function ligarProprietario() {
    const form = document.getElementById('propForm');
    const sel  = document.getElementById('fProprietario');
    document.getElementById('propNovo').addEventListener('click', () => {
      form.hidden = !form.hidden;
      if (!form.hidden) document.getElementById('propNome').focus();
    });
    document.getElementById('propCancelar').addEventListener('click', () => { form.hidden = true; });
    document.getElementById('propSalvar').addEventListener('click', async () => {
      const nome = document.getElementById('propNome').value.trim();
      if (!nome) { document.getElementById('propNome').focus(); return; }
      const r = await db(supabaseClient.from('proprietario').insert({
        nome,
        telefone: document.getElementById('propTelefone').value.trim() || null,
        email: document.getElementById('propEmail').value.trim() || null,
      }).select('id,nome'), 'cadastrar o proprietário');
      apoio.props.push(r[0]);
      apoio.props.sort((a, b) => a.nome.localeCompare(b.nome));
      sel.innerHTML = opcoes(apoio.props, r[0].id, 'Nenhum');
      form.hidden = true;
      ['propNome','propTelefone','propEmail'].forEach(i => document.getElementById(i).value = '');
      avisar(`Proprietário "${r[0].nome}" cadastrado e selecionado.`);
    });
  }

  // Sair de um rascunho apaga ele: registro pela metade só polui a lista.
  // De um imóvel salvo, sair é só sair.
  async function voltar() {
    const im = (await db(supabaseClient.from('imovel').select('rascunho').eq('id', editando).limit(1), 'conferir'))[0];
    if (im && im.rascunho) {
      const fotos = await db(supabaseClient.from('imovel_foto').select('id').eq('imovel_id', editando), 'conferir fotos');
      if (!fotos.length || confirm('Este cadastro não foi salvo. Sair descarta o rascunho e as fotos enviadas. Continuar?')) {
        await supabaseClient.from('imovel').delete().eq('id', editando);
      } else { return; }
    }
    await montarLista();
  }

  async function excluir(ehRascunho) {
    if (!confirm(ehRascunho ? 'Descartar este rascunho?' : 'Excluir este imóvel? A ação não pode ser desfeita.')) return;
    await db(supabaseClient.from('imovel').delete().eq('id', editando), 'excluir o imóvel');
    avisar(ehRascunho ? 'Rascunho descartado.' : 'Imóvel excluído.');
    await montarLista();
  }

  async function salvar() {
    const v = id => document.getElementById(id).value;
    const c = id => document.getElementById(id).checked;

    const restrita = c('fRestrita'), site = c('fSite'), autoriz = c('fAutorizacao');
    // Única regra que continua travando, e por decisão de negócio: divulgação
    // restrita é vontade do proprietário, não preferência interna. Autorização
    // de venda virou registro, não obrigação.
    if (restrita && site) { avisar('Divulgação restrita impede publicar no site. Desmarque uma das duas.'); return; }

    const dados = {
      finalidade: v('fFinalidade'),
      tipo_imovel_id: v('fTipo') || null,
      subtipo_imovel_id: v('fSubtipo') || null,
      situacao: v('fSituacao') || null,
      endereco: v('fEndereco') || null, numero: v('fNumero') || null,
      complemento: v('fComplemento') || null, cep: v('fCep') || null,
      bairro_id: v('fBairro') || null, cidade_id: v('fCidade') || null, zona_id: v('fZona') || null,
      proprietario_id: v('fProprietario') || null,
      valor: num(v('fValor')), valor_aluguel: num(v('fValorAluguel')),
      iptu: num(v('fIptu')), condominio: num(v('fCondominio')),
      aceita_financiamento: c('fFinanciamento'), aceita_permuta: c('fPermuta'),
      dormitorios: num(v('fDormitorios')), suites: num(v('fSuites')),
      banheiros: num(v('fBanheiros')), vagas: num(v('fVagas')),
      area_util: num(v('fAreaUtil')), area_total: num(v('fAreaTotal')),
      testada: num(v('fTestada')), profundidade: num(v('fProfundidade')),
      ano_construcao: num(v('fAno')), andar: num(v('fAndar')), total_andares: num(v('fTotalAndares')),
      titulo: v('fTitulo') || null, selo: v('fSelo') || null,
      descricao_publica: v('fDescricao') || null, obs_internas: v('fObs') || null,
      link_lp: v('fLinkLp') || null, link_video: v('fLinkVideo') || null,
      link_tour360: v('fLinkTour') || null, link_anuncio: v('fLinkAnuncio') || null,
      no_mural: c('fMural'), publicar_no_site: site,
      divulgacao_restrita: restrita, autorizacao_venda: autoriz, destaque: c('fDestaque'),
      alto_padrao: c('fAltoPadrao'),
      status: v('fStatus'), origem_captacao_id: v('fOrigem') || null,
      captado_em: v('fCaptadoEm') || null,
      slug: v('fSlug').trim() || null,
      meta_titulo: v('fMetaTitulo').trim() || null,
      meta_descricao: document.getElementById('fMetaDescricao').value.trim() || null,
      rascunho: false,
    };

    const idSalvo = editando;
    await db(supabaseClient.from('imovel').update(dados).eq('id', editando), 'salvar o imóvel');
    avisar('Imóvel salvo.');

    const marcadas = [...document.querySelectorAll('#fCaracteristicas input:checked')].map(i => i.value);
    await supabaseClient.from('imovel_caracteristica').delete().eq('imovel_id', idSalvo);
    if (marcadas.length) {
      await db(supabaseClient.from('imovel_caracteristica')
        .insert(marcadas.map(cid => ({ imovel_id: idSalvo, caracteristica_id: cid }))), 'salvar características');
    }
    await montarLista();
  }

  Plataforma.registrar('imoveis', {
    titulo: 'Imóveis',
    async montar(alvo, arg) {
      alvoEl = alvo;
      // Argumento é o id de um imóvel: vem de outro módulo. Site e portais
      // manda pra cá quando ele clica numa linha de "falta alguma coisa".
      if (arg) { await abrirFicha(arg); return; }
      await montarLista();
    },
  });
})();
