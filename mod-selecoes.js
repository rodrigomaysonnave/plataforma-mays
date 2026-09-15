// ══════════════════════════════════════════════════════════════════════
// MÓDULO: PÁGINA DO CLIENTE
//
// O corretor monta uma seleção de imóveis pra um cliente específico — cada
// um com a condição de pagamento que faz sentido pra aquele negócio — e o
// cliente abre um link único e vê só aquilo. Pode incluir qualquer imóvel
// do portfólio, inclusive rascunho ou de divulgação restrita: por isso a
// busca aqui NÃO usa `Crud.listaApoio('imovel')` (que filtra rascunho=false,
// pensado pro cadastro normal) — consulta a tabela direto, sem filtro.
//
// Não tem item no menu lateral. Se abre de dentro de um negócio (Funil) ou
// de um imóvel (Sala de guerra), via `Plataforma.irPara('selecoes', arg)`.
// `arg`:
//   'novo:<contato_id>:<negocio_id>'  — cria e já abre pra editar
//   'novo-imovel:<imovel_id>'         — pergunta o cliente antes de criar
//                                        (não tem negócio nem contato ainda)
//   '<id da seleção>'                 — abre uma existente
//
// Seleção sem negocio_id só nasce pela Sala de guerra: por isso "Voltar"
// checa se tem negócio antes de decidir pra onde ir (ver voltarPara).
//
// A seleção nasce no banco assim que a tela abre (mesmo padrão do imóvel:
// precisa existir uma linha pra poder anexar itens). Sair sem mexer em
// nada apaga o rascunho, também mesmo padrão de mod-imoveis.js.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  let alvoEl = null, selecao = null, itens = [], contato = null;
  let imoveisTodos = null, siteUrl = null, tocou = false;
  let imovelPendente = null, contatosCache = null;

  const brl = v => v == null || v === '' ? '—' :
    'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const nomeImovel = im => `${im.codigo} · ${im.titulo || im.endereco || 'sem título'}`;

  async function carregarImoveisTodos() {
    if (imoveisTodos) return imoveisTodos;
    imoveisTodos = await db(supabaseClient.from('imovel')
      .select('id,codigo,titulo,endereco,valor,rascunho,divulgacao_restrita')
      .order('codigo'), 'carregar imóveis');
    return imoveisTodos;
  }

  async function carregarSiteUrl() {
    if (siteUrl !== null) return siteUrl;
    const [cfg] = await db(supabaseClient.from('configuracao').select('site_url').limit(1), 'carregar configuração');
    siteUrl = (cfg && cfg.site_url) || '';
    return siteUrl;
  }

  function linkPublico() {
    if (!selecao.token || !siteUrl) return null;
    return `${siteUrl.replace(/\/$/, '')}/cliente/?t=${selecao.token}`;
  }

  function voltarPara() {
    if (selecao && selecao.negocio_id) Plataforma.irPara('funil', selecao.negocio_id);
    else Plataforma.irPara('salaguerra');
  }

  async function montar(alvo, arg) {
    alvoEl = alvo; tocou = false;
    document.title = 'Página do cliente · Plataforma Mays';
    const trilha = document.getElementById('trilhaAtual');
    if (trilha) trilha.textContent = 'Página do cliente';

    if (!arg) {
      alvo.innerHTML = `
        <div class="vazio-modulo"><div class="vazio-ico">◎</div>
          <h3>Nenhum contexto</h3>
          <p>Abra pelo botão "Página do cliente" dentro de um negócio no Funil, ou de um imóvel na Sala de guerra.</p></div>`;
      return;
    }

    await Promise.all([carregarImoveisTodos(), carregarSiteUrl()]);

    if (arg.startsWith('novo-imovel:')) {
      imovelPendente = arg.slice('novo-imovel:'.length);
      selecao = null; itens = []; contato = null;
      contatosCache = await Crud.listaApoio('contato');
      desenharEscolherContato();
      return;
    }
    imovelPendente = null;

    if (arg.startsWith('novo:')) {
      const [, contatoId, negocioId] = arg.split(':');
      selecao = (await db(supabaseClient.from('selecao_cliente').insert({
        contato_id: contatoId, negocio_id: negocioId || null, criado_por: Plataforma.perfil.id,
      }).select('*').single(), 'criar a seleção'));
      itens = [];
    } else {
      const [s] = await db(supabaseClient.from('selecao_cliente').select('*').eq('id', arg).limit(1), 'abrir seleção');
      if (!s) { avisar('Seleção não encontrada.'); voltarPara(); return; }
      selecao = s;
      itens = await db(supabaseClient.from('selecao_cliente_item')
        .select('*').eq('selecao_id', s.id).order('ordem'), 'carregar itens');
    }

    const [c] = await db(supabaseClient.from('contato').select('id,nome,telefone')
      .eq('id', selecao.contato_id).limit(1), 'carregar cliente');
    contato = c || { nome: '—' };

    desenhar();
  }

  // Tela intermediária só do fluxo 'novo-imovel': ainda não existe seleção
  // nem contato, então não dá pra cair direto em desenhar() (que assume os
  // dois prontos). Mesmo padrão de busca + "+ Novo" do cadastro rápido de
  // cliente no Funil (mod-funil.js), copiado de propósito em vez de
  // extraído em função comum — os dois lugares evoluem por razões
  // diferentes (aqui não tem negócio pra ligar, lá sim).
  function desenharEscolherContato() {
    const im = imoveisTodos.find(x => x.id === imovelPendente);
    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Página do cliente</h2>
          <div class="secao-meta">Pra qual cliente é ${esc(im ? nomeImovel(im) : 'este imóvel')}?</div></div>
        </div>
        <div class="secao-acoes"><button class="btn" id="ecVoltar">Voltar à sala de guerra</button></div>
      </div>
      <div class="ficha-secao"><div class="ficha-grade">
        <div class="campo campo-largo"><label for="ecContatoBusca">Cliente</label>
          <div class="linha-com-botao">
            <input type="text" id="ecContatoBusca" list="ecContatoLista" autocomplete="off" placeholder="Digite o nome do cliente…">
            <button class="btn" type="button" id="ecContatoNovo">+ Novo</button>
          </div>
          <datalist id="ecContatoLista">${contatosCache.map(c => `<option value="${esc(c.nome)}">`).join('')}</datalist>
          <p class="campo-dica">Não achou? Cadastre com "+ Novo" sem sair daqui.</p>
          <div class="cliente-novo" id="ecNovoPainel" hidden>
            <div class="cliente-novo-titulo">Cadastrar cliente</div>
            <p class="cliente-novo-erro" id="ecNovoErro" hidden></p>
            <div class="cliente-novo-grade">
              <div class="campo campo-largo"><label for="ecNovoNome">Nome <span class="obrigatorio">*</span></label>
                <input type="text" id="ecNovoNome" autocomplete="off" placeholder="Nome completo"></div>
              <div class="campo"><label for="ecNovoTelefone">Telefone / WhatsApp</label>
                <input type="tel" id="ecNovoTelefone" autocomplete="off" placeholder="(53) 99999-9999">
                <p class="campo-dica">Opcional. Pode entrar depois.</p></div>
              <div class="campo"><label for="ecNovoEmail">E-mail</label>
                <input type="email" id="ecNovoEmail" autocomplete="off" placeholder="nome@dominio.com">
                <p class="campo-dica">Opcional. Pode entrar depois.</p></div>
            </div>
            <div class="cliente-novo-acoes">
              <button class="btn btn-mini" type="button" id="ecNovoCancelar">Cancelar</button>
              <button class="btn btn-primario btn-mini" type="button" id="ecNovoSalvar">Cadastrar cliente</button>
            </div>
          </div></div>
        <div class="campo campo-largo">
          <button class="btn btn-primario" type="button" id="ecContinuar">Continuar</button>
        </div>
      </div></div>`;

    document.getElementById('ecVoltar').addEventListener('click', () => Plataforma.irPara('salaguerra'));

    const painelNovo = document.getElementById('ecNovoPainel');
    const erroNovo = document.getElementById('ecNovoErro');
    const campoNovo = i => document.getElementById('ecNovo' + i);
    function limparErrosNovo() {
      erroNovo.hidden = true; erroNovo.textContent = '';
      ['Nome', 'Telefone', 'Email'].forEach(i => campoNovo(i).classList.remove('campo-invalido'));
    }
    function recusar(msg, qual) {
      erroNovo.textContent = msg; erroNovo.hidden = false;
      const el = campoNovo(qual);
      el.classList.add('campo-invalido');
      el.focus();
    }

    document.getElementById('ecContatoNovo').addEventListener('click', () => {
      if (!painelNovo.hidden) { painelNovo.hidden = true; return; }
      limparErrosNovo();
      campoNovo('Nome').value = document.getElementById('ecContatoBusca').value.trim();
      campoNovo('Telefone').value = '';
      campoNovo('Email').value = '';
      painelNovo.hidden = false;
      campoNovo(campoNovo('Nome').value ? 'Telefone' : 'Nome').focus();
    });
    document.getElementById('ecNovoCancelar').addEventListener('click', () => {
      painelNovo.hidden = true;
      limparErrosNovo();
    });
    document.getElementById('ecNovoSalvar').addEventListener('click', async () => {
      limparErrosNovo();
      const nome = campoNovo('Nome').value.trim();
      const telefone = campoNovo('Telefone').value.trim();
      const email = campoNovo('Email').value.trim();
      if (nome.length < 3) return recusar('Escreva o nome completo do cliente.', 'Nome');
      if (telefone && !Plataforma.telefoneValido(telefone)) return recusar('Telefone precisa do DDD. Ex.: (53) 99999-9999', 'Telefone');
      if (email && !Plataforma.emailValido(email)) return recusar('E-mail inválido. Ex.: nome@dominio.com', 'Email');
      const repetido = contatosCache.find(c => (c.nome || '').trim().toLowerCase() === nome.toLowerCase());
      if (repetido) return recusar('Já existe um cliente com esse nome. Escolha ele na lista de sugestões.', 'Nome');

      await db(supabaseClient.from('contato').insert({ nome, telefone: telefone || null, email: email || null }),
               'cadastrar cliente');
      Crud.limparCache();
      contatosCache = await Crud.listaApoio('contato');
      document.getElementById('ecContatoLista').innerHTML = contatosCache.map(c => `<option value="${esc(c.nome)}">`).join('');
      document.getElementById('ecContatoBusca').value = nome;
      painelNovo.hidden = true;
      avisar('Cliente cadastrado.');
    });

    document.getElementById('ecContinuar').addEventListener('click', async () => {
      const nomeDigitado = document.getElementById('ecContatoBusca').value.trim();
      const achado = contatosCache.find(c => c.nome.trim().toLowerCase() === nomeDigitado.toLowerCase());
      if (!achado) { avisar('Escolha um cliente da lista de sugestões, ou cadastre um novo com "+ Novo".'); return; }

      selecao = await db(supabaseClient.from('selecao_cliente').insert({
        contato_id: achado.id, negocio_id: null, criado_por: Plataforma.perfil.id,
      }).select('*').single(), 'criar a seleção');
      await db(supabaseClient.from('selecao_cliente_item').insert({
        selecao_id: selecao.id, imovel_id: imovelPendente, ordem: 0,
      }), 'adicionar imóvel à seleção');
      itens = await db(supabaseClient.from('selecao_cliente_item')
        .select('*').eq('selecao_id', selecao.id).order('ordem'), 'carregar itens');
      contato = { id: achado.id, nome: achado.nome };
      imovelPendente = null;
      avisar(`Página criada para ${achado.nome}.`);
      desenhar();
    });
  }

  function itemHtml(it) {
    const im = imoveisTodos.find(x => x.id === it.imovel_id);
    return `
      <li class="cfg-item sel-item" data-id="${it.id}">
        <span class="midia-alca" title="Arraste para mudar a ordem">⠿</span>
        <div class="sel-item-corpo">
          <div class="sel-item-titulo">${esc(im ? nomeImovel(im) : 'Imóvel removido')}</div>
          <textarea class="sel-item-condicao" data-id="${it.id}" rows="2"
                    placeholder="Condição de pagamento pra este item (opcional)">${esc(it.condicao ?? '')}</textarea>
        </div>
        <button class="btn btn-remover btn-mini" type="button" data-remover="${it.id}">Remover</button>
      </li>`;
  }

  function desenhar() {
    const link = linkPublico();
    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Página do cliente</h2>
          <div class="secao-meta">Para ${esc(contato.nome)} — seleção de imóveis com condição própria.</div></div>
        </div>
        <div class="secao-acoes">
          <button class="btn btn-remover" id="selExcluir">Excluir seleção</button>
          <button class="btn" id="selVoltar">${selecao.negocio_id ? 'Voltar ao negócio' : 'Voltar à sala de guerra'}</button>
          <button class="btn btn-primario" id="selSalvar">Salvar</button>
        </div>
      </div>

      <div class="ficha-secao"><div class="ficha-grade">
        <div class="campo campo-largo"><label for="selTitulo">Título (opcional)</label>
          <input type="text" id="selTitulo" value="${esc(selecao.titulo ?? '')}" placeholder="Ex.: Opções em Porto Belo pra você"></div>
        <div class="campo campo-largo"><label for="selCondicaoGeral">Condição geral (opcional)</label>
          <textarea id="selCondicaoGeral" rows="2" placeholder="Vale pra toda a seleção, se não mudar por item">${esc(selecao.condicao_geral ?? '')}</textarea></div>
        <div class="campo"><label for="selAtivo">Situação</label>
          <select id="selAtivo">
            <option value="1"${selecao.ativo ? ' selected' : ''}>Ativa — o link funciona</option>
            <option value="0"${!selecao.ativo ? ' selected' : ''}>Desativada — o link para de mostrar dado</option>
          </select></div>
        <div class="campo campo-largo"><label>Link pra enviar ao cliente</label>
          ${link
            ? `<div class="linha-com-botao">
                 <input type="text" readonly value="${esc(link)}" id="selLink">
                 <button class="btn" type="button" id="selCopiar">Copiar link</button>
               </div>`
            : `<p class="campo-dica">Endereço do site ainda não configurado em Configurações → Ajustes gerais.</p>`}
        </div>
      </div></div>

      <div class="ficha-secao">
        <div class="secao-titulo" style="margin-bottom:12px">
          <div><h3>Imóveis nesta seleção</h3>
          <div class="secao-meta">Busca em todo o portfólio, inclusive rascunho e divulgação restrita.</div></div>
        </div>
        <div class="linha-com-botao">
          <input type="text" id="selBuscaImovel" list="selImovelLista" autocomplete="off" placeholder="Digite código ou título do imóvel…">
          <datalist id="selImovelLista">${imoveisTodos.map(im => `<option value="${esc(nomeImovel(im))}">`).join('')}</datalist>
          <button class="btn btn-primario" type="button" id="selAdicionar">+ Adicionar</button>
        </div>
        ${itens.length === 0
          ? `<div class="vazio"><p>Nenhum imóvel na seleção ainda.</p></div>`
          : `<ul class="cfg-itens sel-itens">${itens.map(itemHtml).join('')}</ul>`}
      </div>`;

    ligarEventos();
  }

  function ligarEventos() {
    document.getElementById('selVoltar').addEventListener('click', voltar);

    document.getElementById('selCopiar')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(linkPublico()); avisar('Link copiado.'); }
      catch { avisar('Não consegui copiar. Selecione e copie manualmente.'); }
    });

    document.getElementById('selSalvar').addEventListener('click', async () => {
      const dados = {
        titulo: document.getElementById('selTitulo').value.trim() || null,
        condicao_geral: document.getElementById('selCondicaoGeral').value.trim() || null,
        ativo: document.getElementById('selAtivo').value === '1',
      };
      await db(supabaseClient.from('selecao_cliente').update(dados).eq('id', selecao.id), 'salvar a seleção');
      Object.assign(selecao, dados);
      tocou = true;
      avisar('Seleção salva.');
      desenhar();
    });

    document.getElementById('selExcluir').addEventListener('click', async () => {
      if (!confirm('Excluir esta seleção inteira? O link do cliente para de funcionar.')) return;
      await db(supabaseClient.from('selecao_cliente').delete().eq('id', selecao.id), 'excluir a seleção');
      avisar('Seleção excluída.');
      voltarPara();
    });

    const buscaImovel = document.getElementById('selBuscaImovel');
    document.getElementById('selAdicionar').addEventListener('click', async () => {
      const nome = buscaImovel.value.trim();
      const im = imoveisTodos.find(x => nomeImovel(x) === nome);
      if (!im) { avisar('Escolha um imóvel da lista de sugestões.'); return; }
      if (itens.some(it => it.imovel_id === im.id)) { avisar('Esse imóvel já está na seleção.'); return; }
      const novo = await db(supabaseClient.from('selecao_cliente_item').insert({
        selecao_id: selecao.id, imovel_id: im.id, ordem: itens.length,
      }).select('*').single(), 'adicionar imóvel à seleção');
      itens.push(novo);
      tocou = true;
      buscaImovel.value = '';
      avisar('Imóvel adicionado.');
      desenhar();
    });

    alvoEl.querySelectorAll('[data-remover]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.remover;
      await db(supabaseClient.from('selecao_cliente_item').delete().eq('id', id), 'remover item');
      itens = itens.filter(it => it.id !== id);
      tocou = true;
      avisar('Imóvel removido da seleção.');
      desenhar();
    }));

    alvoEl.querySelectorAll('.sel-item-condicao').forEach(t => t.addEventListener('blur', async () => {
      const it = itens.find(x => x.id === t.dataset.id);
      const valor = t.value.trim() || null;
      if (it.condicao === valor) return;
      await db(supabaseClient.from('selecao_cliente_item')
        .update({ condicao: valor }).eq('id', it.id), 'salvar condição');
      it.condicao = valor;
      tocou = true;
      avisar('Condição salva.');
    }));

    alvoEl.querySelectorAll('.sel-itens').forEach(lista => Arrastar.ordenar({
      lista, seletor: '.sel-item', alca: '.midia-alca',
      aoSoltar: async ids => {
        await Promise.all(ids.map((id, i) =>
          db(supabaseClient.from('selecao_cliente_item').update({ ordem: i }).eq('id', id), 'reordenar')));
        itens.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        tocou = true;
        avisar('Ordem salva.');
      },
    }));
  }

  // Rascunho vazio (criado ao abrir, nada mexido) some ao sair — mesmo
  // comportamento de mod-imoveis.js pro imóvel que nasce rascunho.
  async function voltar() {
    if (!tocou && itens.length === 0 && !selecao.titulo && !selecao.condicao_geral) {
      await db(supabaseClient.from('selecao_cliente').delete().eq('id', selecao.id), 'descartar rascunho');
    }
    voltarPara();
  }

  Plataforma.registrar('selecoes', { titulo: 'Página do cliente', montar });
})();
