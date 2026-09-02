// ══════════════════════════════════════════════════════════════════════
// MÓDULO: FUNIL DE VENDAS
//
// Kanban por etapa, com VGV somado em cada uma. O CRM que ele usa hoje mostra
// justamente isso — "Contato: 8 negócios, R$ 859.000" — e é o número que
// importa: oito negócios de R$ 50 mil e oito de R$ 5 milhões não são a mesma
// carteira.
//
// As etapas vêm de `etapa_funil`, configurável. Mudar a etapa na tela de
// Configurações muda o kanban inteiro, sem tocar em código.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  const DIAS_PARADO = 7;   // acima disso, o negócio é "estagnado"
  let alvoEl = null, etapas = [], contatos = [], imoveis = [];

  const vgv = v => !v ? 'R$ 0' :
    v >= 1e6 ? `R$ ${(v/1e6).toLocaleString('pt-BR',{maximumFractionDigits:2})} M`
             : `R$ ${(v/1e3).toLocaleString('pt-BR',{maximumFractionDigits:0})} k`;

  const diasDe = iso => Math.floor((Date.now() - new Date(iso)) / 86400000);

  async function carregar() {
    const [e, n, c, i] = await Promise.all([
      db(supabaseClient.from('etapa_funil').select('*').eq('ativo', true).order('ordem'), 'carregar etapas'),
      db(supabaseClient.from('negocio').select('*').order('updated_at', { ascending: false }), 'carregar negócios'),
      Crud.listaApoio('contato'),
      Crud.listaApoio('imovel'),
    ]);
    etapas = e; contatos = c; imoveis = i;
    return n;
  }

  const nomeDe = (lista, id) => (lista.find(x => x.id === id) || {}).nome || '—';

  function cartao(n) {
    const parado = diasDe(n.updated_at);
    return `
      <article class="kan-cartao${parado >= DIAS_PARADO ? ' kan-parado' : ''}" data-id="${n.id}" draggable="true">
        <div class="kan-cliente">${esc(nomeDe(contatos, n.contato_id))}</div>
        ${n.imovel_id ? `<div class="kan-imovel">${esc(nomeDe(imoveis, n.imovel_id))}</div>` : ''}
        <div class="kan-rodape">
          <span class="kan-valor">${n.valor ? vgv(n.valor) : '<span class="cad-vazio">sem valor</span>'}</span>
          ${parado >= DIAS_PARADO ? `<span class="kan-alerta" title="Sem movimento há ${parado} dias">${parado}d</span>` : ''}
        </div>
      </article>`;
  }

  async function desenhar() {
    const negocios = await carregar();
    const emAndamento = etapas.filter(e => e.resultado === 'andamento');
    const parados = negocios.filter(n => {
      const e = etapas.find(x => x.id === n.etapa_id);
      return e && e.resultado === 'andamento' && diasDe(n.updated_at) >= DIAS_PARADO;
    });
    const ganhos  = negocios.filter(n => (etapas.find(x => x.id === n.etapa_id) || {}).resultado === 'ganho');
    const perdidos = negocios.filter(n => (etapas.find(x => x.id === n.etapa_id) || {}).resultado === 'perda');
    const abertos = negocios.filter(n => (etapas.find(x => x.id === n.etapa_id) || {}).resultado === 'andamento');
    const vgvAberto = abertos.reduce((s, n) => s + Number(n.valor || 0), 0);

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Funil de vendas</h2>
          <div class="secao-meta">Arraste o cartão para mover de etapa. As etapas saem das Configurações.</div></div>
        </div>
        <div class="secao-acoes">
          <button class="btn btn-primario" id="funNovo">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            Novo negócio
          </button>
        </div>
      </div>

      <div class="painel-numeros">
        <div class="num"><span class="num-v">${abertos.length}</span><span class="num-r">Negócios em aberto</span></div>
        <div class="num"><span class="num-v">${vgv(vgvAberto)}</span><span class="num-r">VGV em aberto</span></div>
        <div class="num${parados.length ? ' num-alerta' : ''}"><span class="num-v">${parados.length}</span><span class="num-r">Estagnados (${DIAS_PARADO}+ dias)</span></div>
        <div class="num"><span class="num-v">${ganhos.length}</span><span class="num-r">Ganhos</span></div>
        <div class="num"><span class="num-v">${perdidos.length}</span><span class="num-r">Perdidos</span></div>
      </div>

      ${negocios.length === 0 ? `
        <div class="vazio"><div class="vazio-ico">◎</div>
          <h3>Nenhum negócio ainda</h3>
          <p>Um negócio liga um cliente a um imóvel e caminha pelas etapas até fechar.
             Comece por <strong>Novo negócio</strong>.</p></div>` : ''}

      <div class="kanban">
        ${emAndamento.map(e => {
          const meus = negocios.filter(n => n.etapa_id === e.id);
          const soma = meus.reduce((s, n) => s + Number(n.valor || 0), 0);
          return `
            <section class="kan-coluna" data-etapa="${e.id}">
              <header class="kan-topo">
                <span class="kan-nome">${esc(e.nome)}</span>
                <span class="kan-conta">${meus.length}</span>
                <span class="kan-vgv">${vgv(soma)}</span>
              </header>
              <div class="kan-corpo">${meus.map(cartao).join('')}</div>
            </section>`;
        }).join('')}
      </div>`;

    document.getElementById('funNovo').addEventListener('click', () => abrirNegocio('novo'));
    ligarArrastar();
    alvoEl.querySelectorAll('.kan-cartao').forEach(c =>
      c.addEventListener('dblclick', () => abrirNegocio(c.dataset.id)));
  }

  // Arrastar entre colunas grava a etapa nova. `updated_at` muda sozinho pelo
  // gatilho, então mover um cartão também tira ele de "estagnado" — que é o
  // comportamento certo: mexeu, não está mais parado.
  function ligarArrastar() {
    let arrastando = null;
    alvoEl.querySelectorAll('.kan-cartao').forEach(c => {
      c.addEventListener('dragstart', () => { arrastando = c; c.classList.add('kan-arrastando'); });
      c.addEventListener('dragend', () => { c.classList.remove('kan-arrastando'); arrastando = null; });
    });
    alvoEl.querySelectorAll('.kan-coluna').forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('kan-alvo'); });
      col.addEventListener('dragleave', () => col.classList.remove('kan-alvo'));
      col.addEventListener('drop', async e => {
        e.preventDefault(); col.classList.remove('kan-alvo');
        if (!arrastando) return;
        await db(supabaseClient.from('negocio')
          .update({ etapa_id: col.dataset.etapa }).eq('id', arrastando.dataset.id), 'mover o negócio');
        avisar('Negócio movido.');
        await desenhar();
      });
    });
  }

  const listaContatos = () => contatos.map(c => `<option value="${esc(c.nome)}">`).join('');

  async function abrirNegocio(id) {
    const n = id === 'novo' ? {} :
      (await db(supabaseClient.from('negocio').select('*').eq('id', id).limit(1), 'abrir negócio'))[0];
    const motivos = await Crud.listaApoio('motivo_perda');
    const op = (lista, sel, vazio) => `<option value="">${vazio}</option>` + lista.map(o =>
      `<option value="${o.id}"${o.id === sel ? ' selected' : ''}>${esc(o.nome)}</option>`).join('');
    // Nome do cliente já ligado, pra preencher o campo de busca — a lista de
    // clientes cresce sem limite, então digitar o nome bate mais rápido do
    // que rolar um <select> gigante procurando.
    const nomeContatoAtual = n.contato_id ? nomeDe(contatos, n.contato_id) : '';

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>${id === 'novo' ? 'Novo negócio' : 'Negócio'}</h2>
          <div class="secao-meta">Liga um cliente a um imóvel e caminha pelo funil.</div></div>
        </div>
        <div class="secao-acoes">
          ${id === 'novo' ? '' : '<button class="btn btn-remover" id="negExcluir">Excluir</button>'}
          ${id === 'novo' ? '' : '<button class="btn" id="negAgendar" title="Marca visita ou reunião deste negócio e manda para o seu Google">Agendar</button>'}
          <button class="btn" id="negVoltar">Voltar ao funil</button>
          <button class="btn btn-primario" id="negSalvar">Salvar</button>
        </div>
      </div>
      <div class="ficha-secao"><div class="ficha-grade">
        <div class="campo campo-largo"><label for="negContatoBusca">Cliente</label>
          <div class="linha-com-botao">
            <input type="text" id="negContatoBusca" list="negContatoLista" autocomplete="off"
                   placeholder="Digite o nome do cliente…" value="${esc(nomeContatoAtual)}">
            <button class="btn" type="button" id="negContatoNovo">+ Novo</button>
          </div>
          <datalist id="negContatoLista">${listaContatos()}</datalist>
          <p class="campo-dica">Não achou? Cadastre com "+ Novo" sem sair daqui.</p>
          <div class="cliente-novo" id="negNovoPainel" hidden>
            <div class="cliente-novo-titulo">Cadastrar cliente</div>
            <p class="cliente-novo-erro" id="negNovoErro" hidden></p>
            <div class="cliente-novo-grade">
              <div class="campo campo-largo"><label for="negNovoNome">Nome <span class="obrigatorio">*</span></label>
                <input type="text" id="negNovoNome" autocomplete="off" placeholder="Nome completo"></div>
              <div class="campo"><label for="negNovoTelefone">Telefone / WhatsApp</label>
                <input type="tel" id="negNovoTelefone" autocomplete="off" placeholder="(53) 99999-9999">
                <p class="campo-dica">Opcional. Pode entrar depois.</p></div>
              <div class="campo"><label for="negNovoEmail">E-mail</label>
                <input type="email" id="negNovoEmail" autocomplete="off" placeholder="nome@dominio.com">
                <p class="campo-dica">Opcional. Pode entrar depois.</p></div>
            </div>
            <div class="cliente-novo-acoes">
              <button class="btn btn-mini" type="button" id="negNovoCancelar">Cancelar</button>
              <button class="btn btn-primario btn-mini" type="button" id="negNovoSalvar">Cadastrar cliente</button>
            </div>
          </div></div>
        <div class="campo campo-largo"><label for="negImovel">Imóvel</label>
          <select id="negImovel">${op(imoveis, n.imovel_id, 'Nenhum ainda')}</select></div>
        <div class="campo"><label for="negEtapa">Etapa</label>
          <select id="negEtapa">${op(etapas, n.etapa_id || (etapas[0] || {}).id, 'Selecione')}</select></div>
        <div class="campo"><label for="negValor">Valor do negócio (R$)</label>
          <input type="number" id="negValor" value="${n.valor ?? ''}" step="0.01" min="0">
          <p class="campo-dica">É o que soma no VGV de cada etapa.</p></div>
        <div class="campo"><label for="negMotivo">Motivo da perda</label>
          <select id="negMotivo">${op(motivos, n.motivo_perda_id, '—')}</select>
          <p class="campo-dica">Só faz sentido quando o negócio cai.</p></div>
        <div class="campo campo-largo"><label for="negObs">Observações</label>
          <textarea id="negObs" rows="3">${esc(n.obs ?? '')}</textarea></div>
      </div></div>`;

    document.getElementById('negVoltar').addEventListener('click', desenhar);
    // Cadastro rápido de cliente. Só o nome é obrigatório: no meio de um
    // atendimento nem sempre se tem o telefone à mão, e barrar o cadastro
    // fazia o negócio ficar sem cliente nenhum, que é pior que um cliente
    // com contato incompleto. Telefone e e-mail, quando vierem, continuam
    // sendo conferidos: o que não se aceita é dado errado, não dado vazio.
    const painelNovo = document.getElementById('negNovoPainel');
    const erroNovo   = document.getElementById('negNovoErro');
    const campoNovo  = i => document.getElementById('negNovo' + i);

    function limparErrosNovo() {
      erroNovo.hidden = true; erroNovo.textContent = '';
      ['Nome','Telefone','Email'].forEach(i => campoNovo(i).classList.remove('campo-invalido'));
    }
    function recusar(msg, qual) {
      erroNovo.textContent = msg; erroNovo.hidden = false;
      const el = campoNovo(qual);
      el.classList.add('campo-invalido');
      el.focus();
    }

    document.getElementById('negContatoNovo').addEventListener('click', () => {
      if (!painelNovo.hidden) { painelNovo.hidden = true; return; }
      limparErrosNovo();
      // Aproveita o que já foi digitado na busca em vez de fazer redigitar.
      campoNovo('Nome').value = document.getElementById('negContatoBusca').value.trim();
      campoNovo('Telefone').value = '';
      campoNovo('Email').value = '';
      painelNovo.hidden = false;
      campoNovo(campoNovo('Nome').value ? 'Telefone' : 'Nome').focus();
    });

    document.getElementById('negNovoCancelar').addEventListener('click', () => {
      painelNovo.hidden = true;
      limparErrosNovo();
    });

    document.getElementById('negNovoSalvar').addEventListener('click', async () => {
      limparErrosNovo();
      const nome     = campoNovo('Nome').value.trim();
      const telefone = campoNovo('Telefone').value.trim();
      const email    = campoNovo('Email').value.trim();

      if (nome.length < 3) return recusar('Escreva o nome completo do cliente.', 'Nome');
      if (telefone && !Plataforma.telefoneValido(telefone)) return recusar('Telefone precisa do DDD. Ex.: (53) 99999-9999', 'Telefone');
      if (email && !Plataforma.emailValido(email)) return recusar('E-mail inválido. Ex.: nome@dominio.com', 'Email');

      const repetido = contatos.find(c => (c.nome || '').trim().toLowerCase() === nome.toLowerCase());
      if (repetido) return recusar('Já existe um cliente com esse nome. Escolha ele na lista de sugestões.', 'Nome');

      await db(supabaseClient.from('contato').insert({ nome, telefone: telefone || null, email: email || null }).select('id'),
               'cadastrar cliente');
      Crud.limparCache();
      contatos = await Crud.listaApoio('contato');
      document.getElementById('negContatoLista').innerHTML = listaContatos();
      document.getElementById('negContatoBusca').value = nome;
      painelNovo.hidden = true;
      avisar('Cliente cadastrado.');
    });
    document.getElementById('negSalvar').addEventListener('click', async () => {
      const v = i => document.getElementById(i).value;
      const nomeDigitado = document.getElementById('negContatoBusca').value.trim();
      const achado = contatos.find(c => c.nome.trim().toLowerCase() === nomeDigitado.toLowerCase());
      // Reabrir sem mexer no nome mantém o cliente já ligado, mesmo que ele
      // não apareça mais na lista (inativado, por exemplo).
      const contatoId = achado ? achado.id : (nomeDigitado === nomeContatoAtual ? n.contato_id : null);
      if (!contatoId) { avisar('Escolha um cliente da lista de sugestões, ou cadastre um novo com "+ Novo".'); return; }
      const dados = {
        contato_id: contatoId, imovel_id: v('negImovel') || null,
        etapa_id: v('negEtapa') || null, valor: v('negValor') === '' ? null : Number(v('negValor')),
        motivo_perda_id: v('negMotivo') || null, obs: v('negObs').trim() || null,
      };
      if (id === 'novo') await db(supabaseClient.from('negocio').insert(dados), 'salvar o negócio');
      else await db(supabaseClient.from('negocio').update(dados).eq('id', id), 'salvar o negócio');
      avisar('Negócio salvo.');
      await desenhar();
    });
    // Agendar a partir do negócio: aqui o cliente já existe na carteira, então
    // não há contato para criar. O imóvel vem do que está SELECIONADO na tela,
    // e não do que está salvo: quem acabou de trocar o imóvel e vai marcar a
    // visita está falando do novo, mesmo sem ter clicado em Salvar ainda.
    const ag = document.getElementById('negAgendar');
    if (ag) ag.addEventListener('click', async () => {
      const nomeDigitado = document.getElementById('negContatoBusca').value.trim();
      const achado = contatos.find(c => c.nome.trim().toLowerCase() === nomeDigitado.toLowerCase());
      const contatoId = achado ? achado.id : n.contato_id;
      if (!contatoId) { avisar('Escolha o cliente antes de agendar.'); return; }

      const imovelId = document.getElementById('negImovel').value || null;
      const [cli] = await db(supabaseClient.from('contato')
        .select('nome,telefone,email').eq('id', contatoId).limit(1), 'carregar o cliente');
      const im = imovelId ? (await db(supabaseClient.from('imovel')
        .select('codigo,titulo,endereco').eq('id', imovelId).limit(1), 'carregar o imóvel'))[0] : null;

      Plataforma.agendar({
        titulo: im ? `Visita: ${im.titulo || im.codigo}` : `Visita com ${(cli || {}).nome || 'cliente'}`,
        tipo: 'visita',
        local: im ? (im.endereco || '') : '',
        contato_id: contatoId,
        imovel_id: imovelId,
        negocio_id: id,
        nome: (cli || {}).nome || null,
        email: (cli || {}).email || null,
      });
    });

    const ex = document.getElementById('negExcluir');
    if (ex) ex.addEventListener('click', async () => {
      if (!confirm('Excluir este negócio?')) return;
      await db(supabaseClient.from('negocio').delete().eq('id', id), 'excluir');
      avisar('Negócio excluído.');
      await desenhar();
    });
  }

  Plataforma.registrar('funil', {
    titulo: 'Funil de vendas',
    async montar(alvo) { alvoEl = alvo; await desenhar(); },
  });
})();
