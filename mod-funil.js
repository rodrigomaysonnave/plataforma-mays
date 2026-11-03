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
  let alvoEl = null, etapas = [], contatos = [], imoveis = [], empreendimentos = [];

  // Temperatura é o nível de intenção do prospect — diferente da etapa,
  // que é onde ele está no processo. Cor dinâmica via --c, mesma receita
  // de .lead-etapa-selo (estilo.css). Sem azul no design system, frio usa
  // o neutro (--texto-fraco) em vez de inventar token novo.
  const TEMP_COR   = { frio: 'var(--texto-fraco)', morno: 'var(--amarelo)', quente: 'var(--vermelho)' };
  const TEMP_LABEL = { frio: 'Frio', morno: 'Morno', quente: 'Quente' };

  // Próxima ação do negócio: cada uma vira compromisso na Agenda, ligado ao
  // negócio, e fica no histórico da ficha. Negócio sem próxima ação marcada
  // é negócio esquecido.
  const TIPOS_ACAO = [['ligacao', 'Ligação'], ['visita', 'Visita'], ['reuniao', 'Reunião'],
                      ['outro', 'Outro']];
  const ROTULO_TIPO = { ligacao: 'Ligação', visita: 'Visita', reuniao: 'Reunião',
                        vistoria: 'Vistoria', outro: 'Outro' };
  const quandoCurto = iso => new Date(iso).toLocaleString('pt-BR',
    { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const vgv = v => !v ? 'R$ 0' :
    v >= 1e6 ? `R$ ${(v/1e6).toLocaleString('pt-BR',{maximumFractionDigits:2})} M`
             : `R$ ${(v/1e3).toLocaleString('pt-BR',{maximumFractionDigits:0})} k`;

  const diasDe = iso => Math.floor((Date.now() - new Date(iso)) / 86400000);

  async function carregar() {
    const [e, n, c, i, emp] = await Promise.all([
      db(supabaseClient.from('etapa_funil').select('*').eq('ativo', true).order('ordem'), 'carregar etapas'),
      db(supabaseClient.from('negocio').select('*').order('updated_at', { ascending: false }), 'carregar negócios'),
      Crud.listaApoio('contato'),
      Crud.listaApoio('imovel'),
      Crud.listaApoio('empreendimento'),
    ]);
    etapas = e; contatos = c; imoveis = i; empreendimentos = emp;
    return n;
  }

  const nomeDe = (lista, id) => (lista.find(x => x.id === id) || {}).nome || '—';

  function cartao(n) {
    const parado = diasDe(n.updated_at);
    return `
      <article class="kan-cartao${parado >= DIAS_PARADO ? ' kan-parado' : ''}" data-id="${n.id}" draggable="true">
        <div class="kan-cliente">${esc(nomeDe(contatos, n.contato_id))}</div>
        ${n.imovel_id ? `<div class="kan-imovel">${esc(nomeDe(imoveis, n.imovel_id))}</div>`
          : n.empreendimento_id ? `<div class="kan-imovel">${esc(nomeDe(empreendimentos, n.empreendimento_id))}</div>` : ''}
        <div class="kan-rodape">
          <span class="kan-valor">${n.valor ? vgv(n.valor) : '<span class="cad-vazio">sem valor</span>'}</span>
          ${n.temperatura ? `<span class="kan-temp-selo" style="--c:${TEMP_COR[n.temperatura]}">${TEMP_LABEL[n.temperatura]}</span>` : ''}
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
    // Seleção já existente pra este negócio, se houver — evita criar uma
    // "Página do cliente" nova a cada clique no botão.
    const [selecaoExistente] = id === 'novo' ? [] : await db(supabaseClient
      .from('selecao_cliente').select('id').eq('negocio_id', id)
      .order('created_at', { ascending: false }).limit(1), 'verificar página do cliente');
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
          ${id === 'novo' ? '' : `<button class="btn" id="negSelecao" title="Link único pra este cliente, com a seleção de imóveis e condição que você montar">Página do cliente</button>`}
          <button class="btn" id="negAgendar" title="Marca visita ou reunião deste negócio e manda para o seu Google">Agendar</button>
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
        <div class="campo campo-largo"><label for="negEmpreendimento">Empreendimento</label>
          <select id="negEmpreendimento">${op(empreendimentos, n.empreendimento_id, 'Nenhum ainda')}</select>
          <p class="campo-dica">Pra quando o interesse é no lançamento, antes de fechar numa unidade.</p></div>
        <div class="campo campo-largo"><label for="negImovel">Imóvel</label>
          <select id="negImovel">${op(imoveis, n.imovel_id, 'Nenhum ainda')}</select></div>
        <div class="campo"><label for="negEtapa">Etapa</label>
          <select id="negEtapa">${op(etapas, n.etapa_id || (etapas[0] || {}).id, 'Selecione')}</select></div>
        <div class="campo"><label for="negTemp">Temperatura</label>
          <select id="negTemp">
            <option value="">Sem classificação</option>
            <option value="frio"${n.temperatura === 'frio' ? ' selected' : ''}>Frio</option>
            <option value="morno"${n.temperatura === 'morno' ? ' selected' : ''}>Morno</option>
            <option value="quente"${n.temperatura === 'quente' ? ' selected' : ''}>Quente</option>
          </select>
          <p class="campo-dica">Intenção do prospect — diferente da etapa, que é onde ele está no funil.</p></div>
        <div class="campo"><label for="negValor">Valor do negócio (R$)</label>
          <input type="number" id="negValor" value="${n.valor ?? ''}" step="0.01" min="0">
          <p class="campo-dica">É o que soma no VGV de cada etapa.</p></div>
        <div class="campo"><label for="negMotivo">Motivo da perda</label>
          <select id="negMotivo">${op(motivos, n.motivo_perda_id, '—')}</select>
          <p class="campo-dica">Só faz sentido quando o negócio cai.</p></div>
        <div class="campo campo-largo"><label for="negObs">Observações</label>
          <textarea id="negObs" rows="3">${esc(n.obs ?? '')}</textarea></div>
        <div class="campo campo-largo">
          <div class="acoes-cabeca"><label>Próximas ações</label>
            <button class="btn btn-mini" type="button" id="negAcaoNova">+ Ação</button></div>
          <div class="cliente-novo" id="negAcaoPainel" hidden>
            <div class="cliente-novo-titulo">Nova ação</div>
            <div class="cliente-novo-grade acao-grade">
              <div class="campo campo-largo"><label for="negAcaoTexto">O que fazer</label>
                <input type="text" id="negAcaoTexto" autocomplete="off" placeholder="Ligar para mandar a proposta"></div>
              <div class="campo"><label for="negAcaoTipo">Tipo</label>
                <select id="negAcaoTipo">${TIPOS_ACAO.map(t =>
                  `<option value="${t[0]}"${t[0] === 'ligacao' ? ' selected' : ''}>${t[1]}</option>`).join('')}</select></div>
              <div class="campo"><label for="negAcaoQuando">Data e hora</label>
                <input type="datetime-local" id="negAcaoQuando"></div>
            </div>
            <p class="campo-dica" style="margin:0 0 10px">Vai para a Agenda e para o seu Google, com lembrete 1 hora antes.</p>
            <div class="cliente-novo-acoes">
              <button class="btn btn-mini" type="button" id="negAcaoCancelar">Cancelar</button>
              <button class="btn btn-primario btn-mini" type="button" id="negAcaoSalvar">Agendar ação</button>
            </div>
          </div>
          <div id="negAcoes" class="acoes-lista"></div></div>
      </div></div>`;

    document.getElementById('negVoltar').addEventListener('click', desenhar);

    // Mesmos campos do botão Salvar, num lugar só: quem cria o negócio a
    // partir de Agendar ou de "+ Ação" grava exatamente o que está na tela.
    const dadosDaTela = contatoId => {
      const v = i => document.getElementById(i).value;
      return {
        contato_id: contatoId, imovel_id: v('negImovel') || null,
        empreendimento_id: v('negEmpreendimento') || null,
        etapa_id: v('negEtapa') || null, valor: v('negValor') === '' ? null : Number(v('negValor')),
        motivo_perda_id: v('negMotivo') || null, obs: v('negObs').trim() || null,
        temperatura: v('negTemp') || null,
      };
    };
    const contatoDaTela = () => {
      const nomeDigitado = document.getElementById('negContatoBusca').value.trim();
      const achado = contatos.find(c => c.nome.trim().toLowerCase() === nomeDigitado.toLowerCase());
      return achado ? achado.id : (nomeDigitado === nomeContatoAtual ? n.contato_id : null);
    };

    // ── Próximas ações ────────────────────────────────────────────────
    // Pendentes primeiro (a mais próxima no topo), depois o histórico do que
    // já foi feito, mais recente primeiro. Atrasada fica em vermelho: é o
    // que precisa de atenção hoje.
    async function desenharAcoes() {
      const caixa = document.getElementById('negAcoes');
      if (!caixa) return;
      if (id === 'novo') {
        caixa.innerHTML = '<p class="campo-dica">Nenhuma ação ainda. "+ Ação" salva o negócio e já agenda.</p>';
        return;
      }
      const lista = await db(supabaseClient.from('compromisso')
        .select('id,titulo,tipo,situacao,inicio').eq('negocio_id', id)
        .order('inicio', { ascending: true }), 'carregar as ações');
      const pend = lista.filter(c => c.situacao === 'marcado' || c.situacao === 'remarcado');
      const hist = lista.filter(c => !pend.includes(c)).reverse();
      if (!lista.length) {
        caixa.innerHTML = '<p class="campo-dica">Nenhuma ação marcada. Negócio sem próximo passo esfria.</p>';
        return;
      }
      const agora = Date.now();
      const linha = c => {
        const aberta = pend.includes(c);
        const atrasada = aberta && new Date(c.inicio).getTime() < agora;
        const selo = !aberta
          ? (c.situacao === 'realizado' ? '<span class="cad-selo cad-selo-vitrine">FEITA</span>'
                                        : '<span class="cad-selo cad-selo-restrito">CANCELADA</span>')
          : atrasada ? '<span class="cad-selo cad-selo-restrito">ATRASADA</span>'
                     : '<span class="cad-selo cad-selo-mural">PENDENTE</span>';
        return `<div class="acao-item${aberta ? '' : ' acao-feita'}">
          <div class="acao-quando">${esc(quandoCurto(c.inicio))}</div>
          <div class="acao-texto">${selo}<span class="acao-tipo">${esc(ROTULO_TIPO[c.tipo] || 'Ação')}</span> ${esc(c.titulo)}</div>
          ${aberta ? `<button class="btn btn-mini" type="button" data-feita="${c.id}">Feita</button>` : ''}
        </div>`;
      };
      caixa.innerHTML = pend.map(linha).join('') +
        (hist.length ? `<div class="acoes-hist-titulo">Histórico</div>` + hist.map(linha).join('') : '');
      caixa.querySelectorAll('[data-feita]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        await db(supabaseClient.from('compromisso')
          .update({ situacao: 'realizado' }).eq('id', b.dataset.feita), 'marcar como feita');
        avisar('Ação feita.');
        await desenharAcoes();
      }));
    }
    desenharAcoes();

    const painelAcao = document.getElementById('negAcaoPainel');
    document.getElementById('negAcaoNova').addEventListener('click', () => {
      if (!painelAcao.hidden) { painelAcao.hidden = true; return; }
      document.getElementById('negAcaoTexto').value = '';
      document.getElementById('negAcaoQuando').value = Plataforma.paraCampoDataHora(Plataforma.proximaHoraCheia());
      painelAcao.hidden = false;
      document.getElementById('negAcaoTexto').focus();
    });
    document.getElementById('negAcaoCancelar').addEventListener('click', () => { painelAcao.hidden = true; });

    document.getElementById('negAcaoSalvar').addEventListener('click', async () => {
      const botao = document.getElementById('negAcaoSalvar');
      const texto = document.getElementById('negAcaoTexto').value.trim();
      const quando = document.getElementById('negAcaoQuando').value;
      if (!texto) { avisar('Escreva o que deve ser feito.'); document.getElementById('negAcaoTexto').focus(); return; }
      const dtInicio = new Date(quando);
      if (!quando || isNaN(dtInicio)) { avisar('Informe a data e a hora.'); return; }
      const contatoId = contatoDaTela();
      if (!contatoId) { avisar('Escolha o cliente antes de agendar a ação.'); return; }

      // Mesma trava contra clique duplo da janela de agendar.
      if (botao.dataset.salvando) return;
      botao.dataset.salvando = '1'; botao.disabled = true; botao.textContent = 'Agendando…';
      try {
        let negocioId = id;
        if (id === 'novo') {
          const salvo = await db(supabaseClient.from('negocio')
            .insert(dadosDaTela(contatoId)).select('id').single(), 'salvar o negócio');
          negocioId = salvo.id;
        }
        await Plataforma.gravarCompromisso({
          titulo: texto, tipo: document.getElementById('negAcaoTipo').value, situacao: 'marcado',
          inicio: dtInicio.toISOString(), fim: new Date(dtInicio.getTime() + 30 * 60000).toISOString(),
          contato_id: contatoId,
          imovel_id: document.getElementById('negImovel').value || null,
          negocio_id: negocioId,
          corretor_id: (Plataforma.perfil || {}).id || null,
          lembrete_min: 60,
        });
        if (id === 'novo') { await abrirNegocio(negocioId); return; }
        painelAcao.hidden = true;
        await desenharAcoes();
      } finally {
        delete botao.dataset.salvando; botao.disabled = false; botao.textContent = 'Agendar ação';
      }
    });

    const selBtn = document.getElementById('negSelecao');
    if (selBtn) selBtn.addEventListener('click', () => {
      const nomeDigitado = document.getElementById('negContatoBusca').value.trim();
      const achado = contatos.find(c => c.nome.trim().toLowerCase() === nomeDigitado.toLowerCase());
      const contatoId = achado ? achado.id : n.contato_id;
      if (!contatoId) { avisar('Escolha o cliente antes de montar a página dele.'); return; }
      Plataforma.irPara('selecoes', selecaoExistente ? selecaoExistente.id : `novo:${contatoId}:${id}`);
    });
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
        empreendimento_id: v('negEmpreendimento') || null,
        etapa_id: v('negEtapa') || null, valor: v('negValor') === '' ? null : Number(v('negValor')),
        motivo_perda_id: v('negMotivo') || null, obs: v('negObs').trim() || null,
        temperatura: v('negTemp') || null,
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
    //
    // Negócio recém-aberto ("novo") ainda não tem id, e sem id o compromisso
    // não teria pra onde apontar. Em vez de obrigar Salvar → reabrir →
    // Agendar, o clique aqui salva o negócio com o que já estiver preenchido
    // (mesmos campos do botão Salvar) e segue direto pra janela de agendar.
    const ag = document.getElementById('negAgendar');
    if (ag) ag.addEventListener('click', async () => {
      const nomeDigitado = document.getElementById('negContatoBusca').value.trim();
      const achado = contatos.find(c => c.nome.trim().toLowerCase() === nomeDigitado.toLowerCase());
      const contatoId = achado ? achado.id : (id === 'novo' ? null : n.contato_id);
      if (!contatoId) { avisar('Escolha o cliente antes de agendar.'); return; }

      const imovelId = document.getElementById('negImovel').value || null;
      const empId = document.getElementById('negEmpreendimento').value || null;

      if (id === 'novo') {
        const salvo = await db(supabaseClient.from('negocio')
          .insert(dadosDaTela(contatoId)).select('id').single(), 'salvar o negócio');
        avisar('Negócio criado.');
        await abrirNegocio(salvo.id);
        document.getElementById('negAgendar').click();
        return;
      }

      const [cli] = await db(supabaseClient.from('contato')
        .select('nome,telefone,email').eq('id', contatoId).limit(1), 'carregar o cliente');
      const im = imovelId ? (await db(supabaseClient.from('imovel')
        .select('codigo,titulo,endereco').eq('id', imovelId).limit(1), 'carregar o imóvel'))[0] : null;
      const emp = (!im && empId) ? empreendimentos.find(e => e.id === empId) : null;

      Plataforma.agendar({
        titulo: im ? `Visita: ${im.titulo || im.codigo}` : emp ? `Visita: ${emp.nome}` : `Visita com ${(cli || {}).nome || 'cliente'}`,
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
    // `arg` = id de um negócio pra abrir direto na ficha (ex.: voltando da
    // Página do cliente) — sem isso, cai no kanban normal.
    async montar(alvo, arg) {
      alvoEl = alvo;
      if (arg) { await carregar(); await abrirNegocio(arg); return; }
      await desenhar();
    },
  });
})();
