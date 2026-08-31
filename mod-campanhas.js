// ══════════════════════════════════════════════════════════════════════
// MÓDULO: CAMPANHAS DE PROSPECÇÃO
//
// Porte do módulo de campanhas do Dashboard, com as mesmas funcionalidades e
// nenhuma das campanhas de lá. O que ele resolve: uma lista de leads frios
// precisa virar trabalho dividido entre corretores, com etapa, histórico e
// uma ponte para o funil quando alguém demonstra interesse.
//
// Três telas: a lista de campanhas, o formulário e a campanha aberta. A
// campanha aberta tem duas vistas, lista de leads e quadro por etapa.
//
// Diferenças em relação ao Dashboard, todas por causa deste banco:
//   · a campanha vincula a um empreendimento OU a um imóvel (migração 38)
//   · `clientes` é `contato`, `ofertas` é `negocio` com `etapa_funil`
//   · o formulário é tela cheia, não modal, como o resto da plataforma
//
// O rodízio de modelos de mensagem não é enfeite: três textos alternados
// evitam que o WhatsApp leia a campanha como disparo em massa de texto
// idêntico e derrube o número.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  // ── Estado ──────────────────────────────────────────────────────────
  let alvoEl = null;
  let filtro = 'andamento';
  let aberta = null;          // { id, nome, vinculoNome, templates, … }
  let leads = [];
  let leadAtivoId = null;
  let visitasLp = new Map();
  let editandoAnotacao = null;
  let buscaLead = '', etapaFiltro = 'todos';
  let vistaCamp = 'leads';
  let crmSelecionado = null;
  let rodizio1 = 0, rodizio2 = 0;
  let leadsImportados = [];
  let imagemUrl = null;

  const ETAPAS = {
    contatado:       'Contatado',
    contatado_2:     'Contatado 2',
    atendendo:       'Atendendo',
    nao_atendeu:     'Não atendeu',
    numero_invalido: 'Número inválido',
    sem_perfil:      'Sem perfil',
    sem_interesse:   'Sem interesse',
    interesse:       'Tem interesse',
    outro_negocio:   'Outro negócio',
  };

  const COR_ETAPA = {
    contatado: '#42a5f5', contatado_2: '#1e88e5', atendendo: '#5c6bc0', nao_atendeu: '#ff9100',
    numero_invalido: '#795548', sem_perfil: '#ba68c8', sem_interesse: '#e05252',
    interesse: '#7cb342', outro_negocio: '#26c6da',
  };

  // Etapas em que o agente se recusa a redigir: número inválido, fora do
  // perfil, ou já disse que não quer. Insistir aí queima a lista.
  const SEM_AGENTE = ['numero_invalido', 'sem_perfil', 'sem_interesse'];

  // Mandar a LP promove o lead para "Atendendo", mas só se ele ainda não
  // estiver adiante disso. Reenviar não pode fazer ninguém voltar no funil.
  const PROMOVIVEIS = [null, 'contatado', 'contatado_2', 'nao_atendeu'];

  // Mandar o vídeo promove para "Contatado 2", que fica antes de "Atendendo".
  // Por isso a lista é mais curta: quem já está atendendo não volta para cá.
  const PROMOVIVEIS_YT = [null, 'contatado', 'nao_atendeu'];

  const TEXTO_LP_PADRAO = 'Nesse site tem as informações e as imagens do imóvel\n{link}';
  const TEXTO_YT_PADRAO = 'Gravei um vídeo do imóvel, {nome}. Dá uma olhada\n{video}';

  const hoje = () => new Date().toISOString().slice(0, 10);
  const dataBr = v => v ? new Date(v.length <= 10 ? v + 'T12:00:00' : v).toLocaleDateString('pt-BR') : '—';
  const dataHora = v => v ? new Date(v).toLocaleDateString('pt-BR') + ' ' +
    new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const souAdmin = () => Plataforma.perfil && Plataforma.perfil.papel === 'admin';
  const meuId = () => Plataforma.perfil && Plataforma.perfil.id;

  // O PostgREST corta em 1000 linhas por requisição. Campanha de 4 mil leads
  // chegaria truncada e o progresso ficaria errado sem ninguém perceber.
  async function todasLinhas(construir) {
    const PAG = 1000;
    let tudo = [], de = 0;
    for (;;) {
      const parte = await db(construir().range(de, de + PAG - 1), 'carregar leads');
      tudo = tudo.concat(parte || []);
      if (!parte || parte.length < PAG) break;
      de += PAG;
    }
    return tudo;
  }

  // ══ 1. LISTA DE CAMPANHAS ═══════════════════════════════════════════

  async function montar(alvo) {
    alvoEl = alvo;
    aberta = null;
    await renderLista();
  }

  // "Vencida" não é status gravado: é campanha ativa cujo prazo passou. Assim
  // ela sai sozinha de "Em andamento" no dia seguinte, sem depender de alguém
  // lembrar de marcar.
  function estadoDa(c) {
    if (c.status === 'concluida') return 'concluida';
    return (c.meta_atendimento && c.meta_atendimento < hoje()) ? 'vencida' : 'andamento';
  }

  async function renderLista() {
    const admin = souAdmin();
    const todas = await db(supabaseClient.from('campanha').select('*')
      .order('created_at', { ascending: false }), 'carregar campanhas');

    // Corretor só vê campanha em que está atribuído, e nunca uma vencida:
    // prazo estourado é assunto de quem administra, não trabalho a fazer.
    let minhas = todas;
    if (!admin) {
      const vinc = await db(supabaseClient.from('campanha_corretor')
        .select('campanha_id').eq('corretor_id', meuId()), 'carregar minhas campanhas');
      const ids = (vinc || []).map(v => v.campanha_id);
      minhas = todas.filter(c => ids.includes(c.id) &&
        !(c.meta_atendimento && c.meta_atendimento < hoje()));
    }
    const visiveis = filtro === 'todas' ? minhas : minhas.filter(c => estadoDa(c) === filtro);

    // Contagem de leads e nomes dos corretores: duas consultas para o conjunto
    // todo, não uma por cartão.
    const ids = visiveis.map(c => c.id);
    let porCampanha = new Map(), equipePorCampanha = new Map();
    if (ids.length) {
      let q = () => supabaseClient.from('campanha_lead').select('campanha_id,classificacao').in('campanha_id', ids);
      const linhas = await todasLinhas(admin ? q : () => q().eq('corretor_id', meuId()));
      linhas.forEach(l => {
        const a = porCampanha.get(l.campanha_id) || { total: 0, feitos: 0 };
        a.total++; if (l.classificacao) a.feitos++;
        porCampanha.set(l.campanha_id, a);
      });
      if (admin) {
        const [vinculos, equipe] = await Promise.all([
          db(supabaseClient.from('campanha_corretor').select('campanha_id,corretor_id').in('campanha_id', ids), 'vínculos'),
          db(supabaseClient.from('perfil').select('id,nome').order('nome'), 'equipe'),
        ]);
        const nomePorId = new Map((equipe || []).map(p => [p.id, p.nome || 'sem nome']));
        (vinculos || []).forEach(v => {
          const l = equipePorCampanha.get(v.campanha_id) || [];
          l.push(nomePorId.get(v.corretor_id) || 'desconhecido');
          equipePorCampanha.set(v.campanha_id, l);
        });
      }
    }

    const abas = [
      ['andamento', 'Em andamento'], ['vencida', 'Vencidas'],
      ['concluida', 'Concluídas'], ['todas', 'Todas'],
    ].filter(([k]) => admin || k !== 'vencida');

    const vazio = {
      andamento: 'Nenhuma campanha em andamento. Veja as vencidas ou concluídas nas outras abas.',
      vencida: 'Nenhuma campanha com prazo vencido.',
      concluida: 'Nenhuma campanha concluída ainda.',
      todas: 'Nenhuma campanha ainda. Crie a primeira e importe a lista de leads.',
    }[filtro];

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Campanhas</h2>
          <div class="secao-meta">Lista fria dividida entre corretores, com etapa, histórico
            e ponte para o funil quando alguém demonstra interesse.</div></div>
        </div>
        <div class="secao-acoes">
          <div class="cp-abas">${abas.map(([k, r]) =>
            `<button class="cp-aba${filtro === k ? ' ativo' : ''}" data-filtro="${k}">${r}</button>`).join('')}</div>
          ${admin ? '<button class="btn btn-primario" id="cpNova">Nova campanha</button>' : ''}
        </div>
      </div>

      ${visiveis.length ? `<div class="cp-grade">${visiveis.map(c => {
        const a = porCampanha.get(c.id) || { total: 0, feitos: 0 };
        const pct = a.total ? Math.round(a.feitos / a.total * 100) : 0;
        const estado = estadoDa(c);
        const equipe = (equipePorCampanha.get(c.id) || []).sort((x, y) => x.localeCompare(y, 'pt-BR'));
        return `
          <article class="cp-cartao" data-abrir="${c.id}">
            <div class="cp-cartao-topo">
              <span class="cad-selo cp-selo-${estado}">${
                estado === 'vencida' ? 'Vencida' : estado === 'concluida' ? 'Concluída' : 'Ativa'}</span>
              ${admin ? `<span class="cp-acoes">
                <button class="btn btn-mini" data-editar="${c.id}" title="Editar">Editar</button>
                <button class="btn btn-mini" data-duplicar="${c.id}" title="Duplicar">Duplicar</button>
                <button class="btn btn-mini btn-remover" data-excluir="${c.id}" title="Excluir">✕</button>
              </span>` : ''}
            </div>
            <h3 class="cp-nome">${esc(c.nome)}</h3>
            ${admin ? (equipe.length
              ? `<div class="cp-equipe">${esc(equipe.join(', '))}</div>`
              : '<div class="cp-equipe cp-sem-equipe">sem corretor atribuído</div>') : ''}
            <div class="cp-progresso-txt">${a.feitos} / ${a.total} leads classificados</div>
            ${c.meta_atendimento ? `<div class="cp-meta${estado === 'vencida' ? ' cp-meta-venc' : ''}">${
              estado === 'vencida' ? 'Prazo vencido: ' : 'Meta de atendimento: '}${dataBr(c.meta_atendimento)}</div>` : ''}
            <div class="cp-barra"><span style="width:${pct}%"></span></div>
          </article>`;
      }).join('')}</div>`
      : `<div class="vazio"><div class="vazio-ico">◎</div><h3>${esc(vazio)}</h3></div>`}`;

    alvoEl.querySelectorAll('[data-filtro]').forEach(b => b.addEventListener('click', () => {
      filtro = b.dataset.filtro; renderLista();
    }));
    const nova = document.getElementById('cpNova');
    if (nova) nova.addEventListener('click', () => renderFormulario('novo'));

    alvoEl.querySelectorAll('[data-abrir]').forEach(el => el.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      abrirCampanha(el.dataset.abrir);
    }));
    alvoEl.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); renderFormulario(b.dataset.editar);
    }));
    alvoEl.querySelectorAll('[data-duplicar]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); renderFormulario('novo', b.dataset.duplicar);
    }));
    alvoEl.querySelectorAll('[data-excluir]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Remover a campanha e todos os leads dela? Não dá para desfazer.')) return;
      await db(supabaseClient.from('campanha').delete().eq('id', b.dataset.excluir), 'excluir campanha');
      avisar('Campanha removida.');
      await renderLista();
    }));
  }

  // ══ 2. FORMULÁRIO DA CAMPANHA ═══════════════════════════════════════

  async function renderFormulario(id, duplicarDe) {
    leadsImportados = [];
    imagemUrl = null;
    const editando = id !== 'novo';
    const fonte = editando ? id : duplicarDe;

    const [equipe, imoveis, empreendimentos] = await Promise.all([
      db(supabaseClient.from('perfil').select('id,nome,papel').eq('ativo', true).order('nome'), 'equipe'),
      Crud.listaApoio('imovel'),
      Crud.listaApoio('empreendimento'),
    ]);

    let c = { status: 'ativa' }, marcados = [];
    if (fonte) {
      c = (await db(supabaseClient.from('campanha').select('*').eq('id', fonte).limit(1), 'abrir campanha'))[0] || c;
      const v = await db(supabaseClient.from('campanha_corretor').select('corretor_id').eq('campanha_id', fonte), 'corretores');
      marcados = (v || []).map(x => x.corretor_id);
      imagemUrl = c.imagem_primeira_msg || null;
      if (duplicarDe) c = { ...c, id: null, nome: c.nome ? c.nome + ' (cópia)' : '', status: 'ativa' };
    }

    const titulo = editando ? 'Editar campanha' : duplicarDe ? 'Duplicar campanha' : 'Nova campanha';
    const modelo = (n, valor, dica) => `
      <div class="campo campo-largo"><label for="${n}">Modelo ${n.slice(-1)}</label>
        <textarea id="${n}" rows="3" placeholder="${esc(dica)}">${esc(valor ?? '')}</textarea></div>`;

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div><div><h2>${titulo}</h2></div></div>
        <div class="secao-acoes">
          <button class="btn" id="cpVoltar">Voltar</button>
          <button class="btn btn-primario" id="cpSalvar">Salvar</button>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Identificação</h3></div>
        <div class="ficha-grade">
          <div class="campo campo-largo"><label for="cpNome">Nome da campanha</label>
            <input type="text" id="cpNome" value="${esc(c.nome ?? '')}" placeholder="Reativação base 2024"></div>
          <div class="campo campo-largo"><label for="cpEmpreendimento">Empreendimento divulgado</label>
            <select id="cpEmpreendimento"><option value="">Nenhum</option>${empreendimentos.map(e =>
              `<option value="${e.id}"${e.id === c.empreendimento_id ? ' selected' : ''}>${esc(e.nome)}</option>`).join('')}</select>
            <p class="campo-dica">Campanha de lançamento vende o prédio, não a unidade.</p></div>
          <div class="campo campo-largo"><label for="cpImovel">Imóvel divulgado</label>
            <select id="cpImovel"><option value="">Nenhum</option>${imoveis.map(i =>
              `<option value="${i.id}"${i.id === c.imovel_id ? ' selected' : ''}>${esc(i.nome)}</option>`).join('')}</select>
            <p class="campo-dica">Alimenta o {imovel} das mensagens.</p></div>
          <div class="campo"><label for="cpMeta">Meta de atendimento</label>
            <input type="date" id="cpMeta" value="${c.meta_atendimento ?? ''}">
            <p class="campo-dica">Depois desta data a campanha some da lista do corretor.</p></div>
          ${editando ? `<div class="campo"><label for="cpStatus">Situação</label>
            <select id="cpStatus">
              <option value="ativa"${c.status === 'ativa' ? ' selected' : ''}>Ativa</option>
              <option value="concluida"${c.status === 'concluida' ? ' selected' : ''}>Concluída</option>
            </select></div>` : ''}
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Corretores</h3>
          <p>Os leads são divididos em rodízio entre quem estiver marcado.${editando
            ? ' Desmarcar alguém transfere os leads dele para os que ficaram, com histórico e etapa.' : ''}</p></div>
        <div style="padding:14px 20px">
          <div class="cp-checks">${equipe.map(p => `
            <label class="campo-check"><input type="checkbox" class="cp-corretor" value="${p.id}"${
              marcados.includes(p.id) ? ' checked' : ''}>
              <span>${esc(p.nome || 'sem nome')}${p.papel === 'admin' ? ' (admin)' : ''}</span></label>`).join('')}</div>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Lista de leads</h3>
          <p>CSV ou Excel, colunas nome, telefone, e-mail e origem. O cabeçalho manda;
             a posição é só o plano B.${editando
             ? ' Carregar uma lista nova aqui SUBSTITUI a atual e apaga o histórico dela.' : ''}</p></div>
        <div style="padding:14px 20px">
          <label class="cp-solta" id="cpSolta">
            <input type="file" id="cpArquivo" accept=".csv,.xlsx,.xls" hidden>
            <span id="cpPrevia">Clique ou arraste o arquivo aqui</span>
          </label>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Mensagens de primeiro contato</h3>
          <p>Até três modelos, usados em rodízio. Marcadores: {nome}, {imovel}, {origem},
             {corretor}, {saudacao} e {link}.</p></div>
        <div class="ficha-grade">
          ${modelo('cpMsg1', c.msg_template_1, '{saudacao}, {nome}! Aqui é o {corretor}, da Maysonnave Imóveis.')}
          ${modelo('cpMsg2', c.msg_template_2, 'Outra forma de dizer a mesma coisa')}
          ${modelo('cpMsg3', c.msg_template_3, 'Uma terceira, para o rodízio ficar completo')}
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Segunda mensagem</h3>
          <p>O conteúdo do imóvel, mandado depois que a pessoa respondeu que quer receber.
             Tem rodízio próprio. Sem nenhum modelo aqui, o botão nem aparece.</p></div>
        <div class="ficha-grade">
          ${modelo('cpB1', c.msg2_template_1, 'Segue o material do imóvel, {nome}')}
          ${modelo('cpB2', c.msg2_template_2, '')}
          ${modelo('cpB3', c.msg2_template_3, '')}
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>E-mail e WhatsApp do escritório</h3>
          <p>O assunto e o corpo abaixo alimentam o botão E-mail no detalhe do lead: ele abre
             o cliente de e-mail já preenchido. O link do WhatsApp vira o marcador {whatsapp},
             que vale aqui e em qualquer modelo de mensagem.</p></div>
        <div class="ficha-grade">
          <div class="campo campo-largo"><label for="cpWhats">Link do WhatsApp</label>
            <input type="url" id="cpWhats" value="${esc(c.whatsapp_link ?? '')}" placeholder="https://wa.me/5553981041499">
            <p class="campo-dica">O número que a pessoa deve chamar de volta. Use {whatsapp} nos textos.</p>
          </div>
          <div class="campo campo-largo"><label for="cpEmailAssunto">Assunto do e-mail</label>
            <input type="text" id="cpEmailAssunto" value="${esc(c.email_assunto ?? '')}" placeholder="Ex: Laudo de avaliação de imóvel para inventário em Pelotas">
          </div>
          <div class="campo campo-largo"><label for="cpEmailCorpo">Corpo do e-mail</label>
            <textarea id="cpEmailCorpo" rows="10" placeholder="{saudacao},&#10;&#10;Escreva aqui o corpo do e-mail.&#10;&#10;Prefere falar por WhatsApp? {whatsapp}&#10;&#10;{corretor}">${esc(c.email_template ?? '')}</textarea>
          </div>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Landing page e imagem</h3></div>
        <div class="ficha-grade">
          <div class="campo campo-largo"><label for="cpLp">Endereço da LP</label>
            <input type="url" id="cpLp" value="${esc(c.lp_url ?? '')}" placeholder="https://…">
            <p class="campo-dica">O sistema acrescenta ?lead= no link de cada pessoa, e a
               própria página avisa quando ela abre.</p></div>
          <div class="campo campo-largo"><label for="cpTextoLp">Texto que acompanha o link</label>
            <textarea id="cpTextoLp" rows="2" placeholder="${esc(TEXTO_LP_PADRAO)}">${esc(c.texto_link_lp ?? '')}</textarea></div>
          <div class="campo campo-largo"><label>Imagem da primeira mensagem</label>
            <div class="cp-imagem" id="cpImagem">
              <input type="file" id="cpImagemArq" accept="image/*" hidden>
              <span id="cpImagemVazio">Clique para escolher</span>
            </div>
            <p class="campo-dica">O WhatsApp por link só aceita texto. A imagem vai pela área
               de transferência: o corretor clica em copiar e cola na conversa.</p></div>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Vídeo do YouTube</h3>
          <p>Alimenta o botão YouTube no detalhe do lead, que manda o texto com o link do
             vídeo e marca a pessoa como Contatado 2. Sem endereço aqui, o botão não aparece.</p></div>
        <div class="ficha-grade">
          <div class="campo campo-largo"><label for="cpYoutube">Endereço do vídeo</label>
            <input type="url" id="cpYoutube" value="${esc(c.youtube_url ?? '')}" placeholder="https://youtu.be/…">
          </div>
          <div class="campo campo-largo"><label for="cpTextoYoutube">Texto que acompanha o vídeo</label>
            <textarea id="cpTextoYoutube" rows="2" placeholder="${esc(TEXTO_YT_PADRAO)}">${esc(c.texto_youtube ?? '')}</textarea>
            <p class="campo-dica">Marcador {video} é o link do vídeo. Se você não usar,
               o link vai numa linha no fim mesmo assim.</p></div>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Briefing do agente</h3>
          <p>Com isto preenchido aparece o botão de sugerir mensagem, que redige um texto
             para o corretor revisar antes de enviar. Em branco, o botão não existe.</p></div>
        <div class="ficha-grade">
          <div class="campo campo-largo"><label for="cpBriefing">O que o agente precisa saber</label>
            <textarea id="cpBriefing" rows="4" placeholder="Imóvel, público, o que oferecer, o que nunca prometer">${esc(c.contexto_agente ?? '')}</textarea></div>
        </div>
      </div>`;

    mostrarImagem();
    ligarArquivo();

    document.getElementById('cpVoltar').addEventListener('click', () => renderLista());
    document.getElementById('cpSalvar').addEventListener('click', () => salvarCampanha(editando ? id : null));
  }

  function mostrarImagem() {
    const zona = document.getElementById('cpImagem');
    if (!zona) return;
    zona.querySelectorAll('img,.cp-imagem-x').forEach(e => e.remove());
    const vazio = document.getElementById('cpImagemVazio');
    if (!imagemUrl) { vazio.style.display = ''; return; }
    vazio.style.display = 'none';
    const img = document.createElement('img');
    img.src = imagemUrl;
    zona.appendChild(img);
    const x = document.createElement('button');
    x.className = 'cp-imagem-x'; x.type = 'button'; x.textContent = '×';
    x.onclick = e => { e.stopPropagation(); e.preventDefault(); imagemUrl = null; mostrarImagem(); };
    zona.appendChild(x);
  }

  function ligarArquivo() {
    const zona = document.getElementById('cpSolta');
    const inp = document.getElementById('cpArquivo');
    zona.addEventListener('click', () => inp.click());
    inp.addEventListener('change', () => inp.files[0] && lerArquivo(inp.files[0]));
    ['dragover', 'dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => {
      e.preventDefault();
      zona.classList.toggle('sobre', ev === 'dragover');
      if (ev === 'drop' && e.dataTransfer.files[0]) lerArquivo(e.dataTransfer.files[0]);
    }));

    const zi = document.getElementById('cpImagem');
    const ai = document.getElementById('cpImagemArq');
    zi.addEventListener('click', () => ai.click());
    ai.addEventListener('change', async () => {
      const f = ai.files[0];
      if (!f) return;
      document.getElementById('cpImagemVazio').textContent = 'Enviando…';
      try {
        const r = await Fotos.enviarUma(f, 'campanhas');
        imagemUrl = r.url;
      } catch (e) { avisar('Não consegui enviar a imagem: ' + e.message); }
      document.getElementById('cpImagemVazio').textContent = 'Clique para escolher';
      mostrarImagem();
    });
  }

  // ── Leitura da lista: cabeçalho manda, posição é o plano B ──────────
  // Planilha com as colunas em outra ordem fazia o leitor pegar o e-mail como
  // telefone e extrair dígitos de dentro do endereço: um lead com telefone
  // "21" entrava como válido. Por isso todo telefone passa por validação.
  const COLUNAS = {
    nome: /^(nome|name|contato|cliente)/i,
    telefone: /^(telefone|tel|celular|fone|whats|phone)/i,
    email: /^(e-?mail)/i,
    origem: /^(origem|fonte|source)/i,
  };

  function mapearColunas(celulas) {
    const idx = {};
    celulas.forEach((c, i) => {
      const txt = String(c || '').trim();
      for (const [campo, re] of Object.entries(COLUNAS))
        if (idx[campo] === undefined && re.test(txt)) idx[campo] = i;
    });
    return (idx.nome !== undefined && idx.telefone !== undefined) ? idx : null;
  }

  // Telefone brasileiro: 10 ou 11 dígitos, ou 12/13 com o 55 na frente.
  // Barra sequência repetida (99999999999), que é lixo de cadastro.
  function telefoneValido(d) {
    if (!/^\d{10,13}$/.test(d)) return false;
    if (d.length > 11 && !d.startsWith('55')) return false;
    return !/^(\d)\1+$/.test(d.length > 11 ? d.slice(2) : d);
  }

  function montarLeads(linhas) {
    leadsImportados = [];
    let descartados = 0;
    const mapa = linhas.length ? mapearColunas(linhas[0]) : null;
    const pos = mapa || { nome: 0, telefone: 1, email: 2, origem: 3 };
    linhas.forEach((cels, i) => {
      if (i === 0 && mapa) return;
      const pega = c => (c === undefined ? '' : String(cels[c] ?? '').trim());
      const nome = pega(pos.nome);
      const telefone = pega(pos.telefone).replace(/\D/g, '');
      if (!nome && !telefone) return;
      if (i === 0 && !mapa && /nome|telefone|phone|contato/i.test(nome)) return;
      if (!nome || !telefoneValido(telefone)) { descartados++; return; }
      leadsImportados.push({ nome, telefone, email: pega(pos.email), origem: pega(pos.origem) });
    });

    const el = document.getElementById('cpPrevia');
    const n = leadsImportados.length;
    if (!n) {
      el.textContent = descartados
        ? `Nenhum lead válido: ${descartados} linhas sem telefone reconhecível. Confira se a coluna de telefone é a certa.`
        : 'Nenhum lead válido. Precisa das colunas nome e telefone.';
      return;
    }
    const partes = [`${n} leads lidos`];
    // Descarte alto quase sempre é coluna trocada, não lista ruim. Avisar aqui
    // evita salvar uma substituição que apaga a lista boa e grava lixo.
    if (descartados) {
      const grave = descartados > n * 0.2;
      partes.push(`${descartados} descartadas por telefone inválido` +
        (grave ? ' — confira a coluna antes de salvar' : ''));
    }
    if (!mapa) partes.push('lidas por posição: nome, telefone, e-mail, origem');
    const comOrigem = leadsImportados.filter(l => (l.origem || '').trim()).length;
    partes.push(comOrigem === n ? `origem lida nos ${n}`
      : comOrigem ? `origem só em ${comOrigem}` : 'sem origem: a 4ª coluna precisa ser a origem');
    el.textContent = partes.join(' · ');
  }

  // Divisão que respeita aspas: nome com vírgula ("Silva, João") quebrava a
  // linha inteira e jogava o telefone para a coluna errada.
  function separarCsv(linha) {
    const campos = []; let atual = '', aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (c === '"') {
        if (aspas && linha[i + 1] === '"') { atual += '"'; i++; }
        else aspas = !aspas;
      } else if (c === ',' && !aspas) { campos.push(atual); atual = ''; }
      else atual += c;
    }
    campos.push(atual);
    return campos.map(c => c.trim());
  }

  function lerArquivo(file) {
    const planilha = /\.(xlsx|xls)$/i.test(file.name);
    const leitor = new FileReader();
    if (planilha) {
      leitor.onload = e => {
        if (typeof XLSX === 'undefined') {
          document.getElementById('cpPrevia').textContent =
            'A biblioteca de planilha não carregou. Recarregue a página ou salve o arquivo como CSV.';
          return;
        }
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        montarLeads(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }));
      };
      leitor.readAsArrayBuffer(file);
    } else {
      leitor.onload = e => montarLeads(
        e.target.result.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim()).map(separarCsv));
      leitor.readAsText(file, 'UTF-8');
    }
  }

  async function salvarCampanha(id) {
    const v = i => { const el = document.getElementById(i); return el ? el.value.trim() : ''; };
    const nome = v('cpNome');
    if (!nome) { avisar('A campanha precisa de nome.'); document.getElementById('cpNome').focus(); return; }
    const corretores = [...document.querySelectorAll('.cp-corretor:checked')].map(c => c.value);
    if (!corretores.length) { avisar('Marque ao menos um corretor.'); return; }
    if (!id && !leadsImportados.length) { avisar('Importe a lista de leads antes de salvar.'); return; }

    const dados = {
      nome, imovel_id: v('cpImovel') || null, empreendimento_id: v('cpEmpreendimento') || null,
      meta_atendimento: v('cpMeta') || null,
      lp_url: v('cpLp') || null, texto_link_lp: v('cpTextoLp') || null,
      youtube_url: v('cpYoutube') || null, texto_youtube: v('cpTextoYoutube') || null,
      msg_template_1: v('cpMsg1') || null, msg_template_2: v('cpMsg2') || null, msg_template_3: v('cpMsg3') || null,
      msg2_template_1: v('cpB1') || null, msg2_template_2: v('cpB2') || null, msg2_template_3: v('cpB3') || null,
      imagem_primeira_msg: imagemUrl, contexto_agente: v('cpBriefing') || null,
      whatsapp_link: v('cpWhats') || null,
      email_assunto: v('cpEmailAssunto') || null, email_template: v('cpEmailCorpo') || null,
    };

    let campanhaId = id;
    if (id) {
      dados.status = v('cpStatus') || 'ativa';
      await db(supabaseClient.from('campanha').update(dados).eq('id', id), 'salvar campanha');

      const atuais = (await db(supabaseClient.from('campanha_corretor')
        .select('corretor_id').eq('campanha_id', id), 'corretores atuais')).map(r => r.corretor_id);
      const saíram = atuais.filter(x => !corretores.includes(x));
      const entraram = corretores.filter(x => !atuais.includes(x));

      if (leadsImportados.length) {
        await db(supabaseClient.from('campanha_lead').delete().eq('campanha_id', id), 'limpar leads');
        await inserirLeads(id, corretores);
      } else if (saíram.length) {
        // Sem lista nova: os leads de quem saiu passam para quem ficou, em
        // rodízio, mantendo etapa, anotações e vínculo. Só muda o dono.
        const orfaos = await db(supabaseClient.from('campanha_lead').select('id')
          .eq('campanha_id', id).in('corretor_id', saíram), 'leads a transferir');
        const grupos = {};
        (orfaos || []).forEach((l, i) => {
          const destino = corretores[i % corretores.length];
          (grupos[destino] = grupos[destino] || []).push(l.id);
        });
        for (const [destino, ids] of Object.entries(grupos))
          await db(supabaseClient.from('campanha_lead').update({ corretor_id: destino }).in('id', ids), 'transferir leads');
      }
      if (saíram.length) await db(supabaseClient.from('campanha_corretor').delete()
        .eq('campanha_id', id).in('corretor_id', saíram), 'tirar corretores');
      if (entraram.length) await db(supabaseClient.from('campanha_corretor')
        .insert(entraram.map(cid => ({ campanha_id: id, corretor_id: cid }))), 'incluir corretores');
    } else {
      const nova = await db(supabaseClient.from('campanha')
        .insert({ ...dados, created_by: meuId() }).select('id').single(), 'criar campanha');
      campanhaId = nova.id;
      await db(supabaseClient.from('campanha_corretor')
        .insert(corretores.map(cid => ({ campanha_id: campanhaId, corretor_id: cid }))), 'atribuir corretores');
      await inserirLeads(campanhaId, corretores);
    }

    avisar('Campanha salva.');
    await renderLista();
  }

  async function inserirLeads(campanhaId, corretores) {
    const linhas = leadsImportados.map((l, i) => ({
      campanha_id: campanhaId, corretor_id: corretores[i % corretores.length],
      nome: l.nome, telefone: l.telefone, email: l.email || null, origem: l.origem || null,
    }));
    const LOTE = 200;
    for (let i = 0; i < linhas.length; i += LOTE)
      await db(supabaseClient.from('campanha_lead').insert(linhas.slice(i, i + LOTE)), 'gravar leads');
  }

  // ══ 3. CAMPANHA ABERTA ══════════════════════════════════════════════

  async function abrirCampanha(id) {
    rodizio1 = rodizio2 = 0;
    leadAtivoId = null; buscaLead = ''; etapaFiltro = 'todos';
    vistaCamp = 'leads'; crmSelecionado = null;

    const c = (await db(supabaseClient.from('campanha').select('*').eq('id', id).limit(1), 'abrir campanha'))[0];
    if (!c) { avisar('Campanha não encontrada.'); return renderLista(); }

    leads = (await todasLinhas(() => {
      let q = supabaseClient.from('campanha_lead').select('*').eq('campanha_id', id).order('created_at');
      if (!souAdmin()) q = q.eq('corretor_id', meuId());
      return q;
    })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    // Empreendimento tem preferência: quando os dois estão preenchidos, é o
    // prédio que a mensagem nomeia, não a unidade.
    let vinculoNome = '';
    if (c.empreendimento_id) {
      const emp = (await db(supabaseClient.from('empreendimento').select('nome')
        .eq('id', c.empreendimento_id).limit(1), 'empreendimento da campanha'))[0];
      if (emp) vinculoNome = emp.nome || '';
    }
    if (!vinculoNome && c.imovel_id) {
      const im = (await db(supabaseClient.from('imovel').select('codigo,titulo,endereco')
        .eq('id', c.imovel_id).limit(1), 'imóvel da campanha'))[0];
      if (im) vinculoNome = im.titulo || im.endereco || im.codigo || '';
    }

    aberta = {
      ...c, vinculoNome,
      templates: [c.msg_template_1, c.msg_template_2, c.msg_template_3].filter(t => t && t.trim()),
      templates2: [c.msg2_template_1, c.msg2_template_2, c.msg2_template_3].filter(t => t && t.trim()),
    };

    visitasLp = leads.length ? await carregarVisitas(leads.map(l => l.id)) : new Map();
    renderPagina();
  }

  async function carregarVisitas(ids) {
    const mapa = new Map();
    const LOTE = 150;   // evita estourar o tamanho da URL em campanha grande
    for (let i = 0; i < ids.length; i += LOTE) {
      const v = await db(supabaseClient.from('campanha_lp_visita').select('lead_id,visited_at')
        .in('lead_id', ids.slice(i, i + LOTE)).order('visited_at'), 'visitas da LP');
      (v || []).forEach(x => { if (!mapa.has(x.lead_id)) mapa.set(x.lead_id, x.visited_at); });
    }
    return mapa;
  }

  function renderPagina() {
    const total = leads.length;
    const feitos = leads.filter(l => l.classificacao).length;
    const pct = total ? Math.round(feitos / total * 100) : 0;

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>${esc(aberta.nome)}</h2>
            <div class="secao-meta">${aberta.vinculoNome ? esc(aberta.vinculoNome) + ' · ' : ''}início ${
              dataBr(aberta.created_at)} · meta ${aberta.meta_atendimento ? dataBr(aberta.meta_atendimento) : 'sem prazo'}</div></div>
        </div>
        <div class="secao-acoes">
          <div class="cp-abas">
            <button class="cp-aba${vistaCamp === 'leads' ? ' ativo' : ''}" data-vista="leads">Lista</button>
            <button class="cp-aba${vistaCamp === 'crm' ? ' ativo' : ''}" data-vista="crm">Quadro</button>
          </div>
          <button class="btn" id="cpExportar">Exportar</button>
          <button class="btn" id="cpRelatorio">Relatório</button>
          <button class="btn" id="cpFechar">Voltar</button>
        </div>
      </div>

      <div class="cp-progresso">
        <div class="cp-barra"><span style="width:${pct}%"></span></div>
        <span class="cp-progresso-n">${feitos} / ${total}</span>
      </div>

      ${vistaCamp === 'crm' ? '<div id="cpQuadro"></div>' : `
        <div class="cp-trabalho">
          <aside class="cp-leads">
            <div class="cp-leads-filtros">
              <input type="search" id="cpBusca" placeholder="Nome, telefone ou e-mail" value="${esc(buscaLead)}">
              <select id="cpEtapaFiltro"></select>
            </div>
            <div id="cpLeadsLista"></div>
          </aside>
          <section class="cp-detalhe" id="cpDetalhe">
            <p class="ini-vazio">Escolha um lead na lista ao lado.</p>
          </section>
        </div>`}`;

    alvoEl.querySelectorAll('[data-vista]').forEach(b => b.addEventListener('click', () => {
      vistaCamp = b.dataset.vista; renderPagina();
    }));
    document.getElementById('cpFechar').addEventListener('click', () => { aberta = null; renderLista(); });
    document.getElementById('cpExportar').addEventListener('click', exportarPorEtapa);
    document.getElementById('cpRelatorio').addEventListener('click', imprimirRelatorio);

    if (vistaCamp === 'crm') return renderQuadro();

    document.getElementById('cpBusca').addEventListener('input', e => {
      buscaLead = e.target.value; renderListaLeads();
    });
    document.getElementById('cpEtapaFiltro').addEventListener('change', e => {
      etapaFiltro = e.target.value; renderListaLeads();
    });
    renderListaLeads();
    if (leadAtivoId) renderDetalhe();
  }

  function renderListaLeads() {
    const sel = document.getElementById('cpEtapaFiltro');
    if (sel) {
      const opcoes = [
        { k: 'todos', r: 'Todas as etapas', n: leads.length },
        { k: 'pendente', r: 'Pendente', n: leads.filter(l => !l.classificacao).length },
        ...Object.entries(ETAPAS).map(([k, r]) => ({ k, r, n: leads.filter(l => l.classificacao === k).length })),
      ];
      sel.innerHTML = opcoes.map(o =>
        `<option value="${o.k}"${etapaFiltro === o.k ? ' selected' : ''}>${o.r} (${o.n})</option>`).join('');
    }

    const q = buscaLead.trim().toLowerCase();
    let visiveis = leads;
    if (etapaFiltro === 'pendente') visiveis = visiveis.filter(l => !l.classificacao);
    else if (etapaFiltro !== 'todos') visiveis = visiveis.filter(l => l.classificacao === etapaFiltro);
    if (q) visiveis = visiveis.filter(l => l.nome.toLowerCase().includes(q) ||
      l.telefone.includes(q) || (l.email || '').toLowerCase().includes(q));

    const caixa = document.getElementById('cpLeadsLista');
    caixa.innerHTML = visiveis.length ? visiveis.map(l => `
      <button class="cp-lead${l.id === leadAtivoId ? ' ativo' : ''}" data-lead="${l.id}">
        <span class="cp-lead-ponto" style="background:${l.classificacao ? COR_ETAPA[l.classificacao] : 'var(--borda)'}"></span>
        <span class="cp-lead-txt">
          <span class="cp-lead-nome">${esc(l.nome)}</span>
          <span class="cp-lead-tel">${esc(l.telefone)}${l.email ? ' · ' + esc(l.email) : ''}</span>
        </span>
      </button>`).join('')
      : '<p class="ini-vazio" style="padding:18px">Nenhum lead com esse filtro.</p>';

    caixa.querySelectorAll('[data-lead]').forEach(b => b.addEventListener('click', () => {
      leadAtivoId = b.dataset.lead;
      editandoAnotacao = null;
      renderListaLeads();
      renderDetalhe();
    }));
  }

  // ── Marcadores das mensagens ────────────────────────────────────────
  const primeiroNome = n => (n || '').trim().split(/\s+/)[0] || '';

  // {origem} é o imóvel por onde o lead ENTROU, que numa campanha de
  // reativação varia lead a lead. Sem origem gravada, cai no imóvel da
  // campanha, para a mensagem nunca sair com o marcador vazio.
  const origemDo = l => l.origem || aberta.vinculoNome || '';

  // {corretor} é quem está mandando: o WhatsApp abre no aparelho da pessoa
  // logada, então é o nome dela que assina. Resolve no envio, não na
  // campanha, porque a mesma campanha tem vários corretores.
  function nomeDoCorretor() {
    const p = primeiroNome((Plataforma.perfil || {}).nome || '');
    return p || 'nós';
  }

  // {saudacao} resolve no envio pelo relógio de quem manda: o mesmo modelo
  // usado de manhã e à noite precisa cumprimentar certo.
  function saudacao(d = new Date()) {
    const h = d.getHours();
    return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  }

  function linkRastreado(leadId) {
    if (!aberta.lp_url) return '';
    return aberta.lp_url + (aberta.lp_url.includes('?') ? '&' : '?') + 'lead=' + leadId;
  }

  function preencher(tpl, lead) {
    return tpl
      .replaceAll('{nome}', primeiroNome(lead.nome))
      .replaceAll('{imovel}', aberta.vinculoNome || '')
      .replaceAll('{empreendimento}', aberta.vinculoNome || '')
      .replaceAll('{origem}', origemDo(lead))
      .replaceAll('{corretor}', nomeDoCorretor())
      .replaceAll('{saudacao}', saudacao())
      .replaceAll('{link}', linkRastreado(lead.id))
      .replaceAll('{whatsapp}', aberta.whatsapp_link || '');
  }

  // Todo link é wa.me/55 + número, então o telefone guardado precisa ser DDD +
  // número. Lista de fora às vezes já vem com o 55 na frente: tira, senão
  // vira 5555…
  function waNumero(tel) {
    let d = String(tel || '').replace(/\D/g, '');
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
    return '55' + d;
  }

  // No celular, abrir aba nova para um link que passa para o aplicativo deixa
  // uma aba em branco: o sistema intercepta e a aba nunca é navegada. Na
  // própria aba isso não acontece, e o código que roda depois continua vivo
  // porque a página não é descarregada.
  function abrirWhats(url) {
    if (window.innerWidth < 768) { window.location.href = url; return true; }
    const w = window.open(url, '_blank');
    if (!w) avisar('O navegador bloqueou a janela do WhatsApp. Libere as janelas para este endereço.');
    return !!w;
  }

  // ── Detalhe do lead ─────────────────────────────────────────────────
  function anotacoesDe(lead) {
    try { const a = JSON.parse(lead.anotacoes || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }

  function renderDetalhe() {
    const lead = leads.find(l => l.id === leadAtivoId);
    const painel = document.getElementById('cpDetalhe');
    if (!lead || !painel) return;

    const anot = anotacoesDe(lead);
    const envios = anot.filter(a => a.automatico).length;
    const visita = visitasLp.get(lead.id);

    const linhaTempo = anot.length ? `
      <h4 class="cp-sub">Histórico</h4>
      <div class="cp-tempo">${anot.map((a, i) => {
        const selo = a.etapa ? `<span class="cp-selo-etapa">${esc(ETAPAS[a.etapa] || a.etapa)}</span>` : '';
        if (editandoAnotacao === i) return `
          <div class="cp-anot">
            <div class="cp-anot-topo"><span class="cp-anot-data">${dataHora(a.em)}</span>${selo}</div>
            <textarea class="cp-anot-edit" id="cpAnotEdit" rows="3">${esc(a.texto)}</textarea>
            <div class="cp-anot-btns">
              <button class="btn btn-mini btn-primario" data-salvar-anot="${i}">Salvar</button>
              <button class="btn btn-mini" data-cancelar-anot>Cancelar</button>
            </div>
          </div>`;
        return `
          <div class="cp-anot">
            <div class="cp-anot-topo"><span class="cp-anot-data">${dataHora(a.em)}</span>${selo}
              <span class="cp-anot-acoes">
                <button class="btn btn-mini" data-editar-anot="${i}">Editar</button>
                <button class="btn btn-mini" data-apagar-anot="${i}">Apagar</button>
              </span></div>
            <div class="cp-anot-txt">${esc(a.texto)}</div>
          </div>`;
      }).join('')}</div>` : '';

    painel.innerHTML = `
      <div class="cp-det-topo">
        <h3>${esc(lead.nome)}</h3>
        <div class="cp-det-sub">${esc(lead.telefone)}${lead.email ? ' · ' + esc(lead.email) : ''}</div>
        <div class="cp-det-sub">${lead.origem
          ? 'veio de: <strong>' + esc(lead.origem) + '</strong>'
          : '<span class="cp-sem-origem">sem origem gravada</span>'}</div>
        ${visita ? `<div class="cp-det-sub cp-visitou">abriu a LP em ${dataHora(visita)}</div>` : ''}
        ${envios ? `<div class="cp-det-sub">${envios} mensagem(ns) enviada(s)</div>` : ''}
      </div>

      <div class="cp-botoes">
        <a class="btn btn-mini" href="tel:${esc(lead.telefone.replace(/\D/g, ''))}">Ligar</a>
        ${aberta.imagem_primeira_msg ? '<button class="btn btn-mini" data-copiar-img>Copiar imagem</button>' : ''}
        <button class="btn btn-mini btn-primario" data-whats="1">WhatsApp 1</button>
        ${aberta.templates2.length ? '<button class="btn btn-mini" data-whats="2">WhatsApp 2</button>' : ''}
        <button class="btn btn-mini" data-whats="3" title="Abre a conversa em branco. Não marca etapa nem registra envio">WhatsApp 3</button>
        ${aberta.lp_url ? '<button class="btn btn-mini" data-enviar-lp>Enviar LP</button>' : ''}
        ${aberta.youtube_url ? '<button class="btn btn-mini" data-enviar-yt title="Manda o vídeo do imóvel e marca Contatado 2">YouTube</button>' : ''}
        ${aberta.contexto_agente && !SEM_AGENTE.includes(lead.classificacao)
          ? '<button class="btn btn-mini" id="cpSugerir">Sugerir mensagem</button>' : ''}
        ${lead.email ? '<button class="btn btn-mini" data-email>E-mail</button>' : ''}
        <button class="btn btn-mini btn-remover" data-excluir-lead title="Apaga este lead da campanha, com anotações e histórico">Excluir</button>
      </div>
      <div id="cpSugestao"></div>

      <h4 class="cp-sub">Etapa</h4>
      <div class="cp-etapas">${Object.entries(ETAPAS).map(([k, r]) =>
        `<button class="cp-etapa${lead.classificacao === k ? ' ativo' : ''}"
           style="${lead.classificacao === k ? `--c:${COR_ETAPA[k]}` : ''}" data-etapa="${k}">${r}</button>`).join('')}</div>

      ${linhaTempo}

      <h4 class="cp-sub">Nova anotação</h4>
      <div class="cp-nova-anot">
        <textarea id="cpNovaAnot" rows="2" placeholder="Registre o que aconteceu neste contato"></textarea>
        <button class="btn btn-primario" id="cpSalvarAnot">Salvar</button>
      </div>`;

    painel.querySelectorAll('[data-etapa]').forEach(b =>
      b.addEventListener('click', () => classificar(lead.id, b.dataset.etapa)));
    painel.querySelectorAll('[data-whats]').forEach(b =>
      b.addEventListener('click', () => enviarWhats(lead.id, b.dataset.whats)));
    const em = painel.querySelector('[data-email]');
    if (em) em.addEventListener('click', () => enviarEmail(lead.id));
    const exc = painel.querySelector('[data-excluir-lead]');
    if (exc) exc.addEventListener('click', () => excluirLead(lead.id));
    const lp = painel.querySelector('[data-enviar-lp]');
    if (lp) lp.addEventListener('click', () => enviarLp(lead.id));
    const yt = painel.querySelector('[data-enviar-yt]');
    if (yt) yt.addEventListener('click', () => enviarYoutube(lead.id));
    const ci = painel.querySelector('[data-copiar-img]');
    if (ci) ci.addEventListener('click', copiarImagem);
    const sug = document.getElementById('cpSugerir');
    if (sug) sug.addEventListener('click', () => sugerirMensagem(lead.id));

    document.getElementById('cpSalvarAnot').addEventListener('click', async () => {
      const t = document.getElementById('cpNovaAnot').value.trim();
      if (!t) return;
      await gravarAnotacao(lead, { em: new Date().toISOString(), etapa: lead.classificacao || null, texto: t });
      renderDetalhe();
    });
    painel.querySelectorAll('[data-editar-anot]').forEach(b => b.addEventListener('click', () => {
      editandoAnotacao = Number(b.dataset.editarAnot); renderDetalhe();
    }));
    const canc = painel.querySelector('[data-cancelar-anot]');
    if (canc) canc.addEventListener('click', () => { editandoAnotacao = null; renderDetalhe(); });
    painel.querySelectorAll('[data-salvar-anot]').forEach(b => b.addEventListener('click', async () => {
      const t = document.getElementById('cpAnotEdit').value.trim();
      if (!t) return;
      const arr = anotacoesDe(lead);
      arr[Number(b.dataset.salvarAnot)].texto = t;
      await salvarAnotacoes(lead, arr);
      editandoAnotacao = null;
      renderDetalhe();
    }));
    painel.querySelectorAll('[data-apagar-anot]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Apagar esta anotação?')) return;
      const arr = anotacoesDe(lead);
      arr.splice(Number(b.dataset.apagarAnot), 1);
      await salvarAnotacoes(lead, arr);
      renderDetalhe();
    }));
  }

  async function salvarAnotacoes(lead, arr) {
    const json = JSON.stringify(arr);
    await db(supabaseClient.from('campanha_lead').update({ anotacoes: json }).eq('id', lead.id), 'salvar anotação');
    lead.anotacoes = json;
  }

  const gravarAnotacao = (lead, entrada) => salvarAnotacoes(lead, [...anotacoesDe(lead), entrada]);

  // Todo envio deixa registro, mesmo quando a etapa não muda (2ª, 3ª tentativa
  // dentro de "Contatado"). É o que permite contar tentativas de verdade em
  // vez de adivinhar pela etapa.
  const registrarEnvio = (lead, texto) =>
    gravarAnotacao(lead, { em: new Date().toISOString(), etapa: lead.classificacao || null, texto, automatico: true });

  // ── Envio ───────────────────────────────────────────────────────────
  async function enviarWhats(leadId, qual) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    // WhatsApp 3 abre a conversa e para por aí: sem texto, sem rodízio, sem
    // registro e sem mexer na etapa. É para quando o corretor quer só olhar o
    // perfil ou escrever à mão, por isso é o único que não deixa rastro.
    if (qual === '3') { abrirWhats(`https://wa.me/${waNumero(lead.telefone)}`); return; }

    const lista = qual === '2' ? aberta.templates2 : aberta.templates;
    let texto = '';
    if (lista.length) {
      const i = qual === '2' ? rodizio2++ : rodizio1++;
      texto = preencher(lista[i % lista.length], lead);
    }
    const url = `https://wa.me/${waNumero(lead.telefone)}` + (texto ? `?text=${encodeURIComponent(texto)}` : '');
    if (!abrirWhats(url)) return;

    await registrarEnvio(lead, texto
      ? `WhatsApp ${qual} enviado: "${texto}"`
      : 'WhatsApp aberto (nenhum modelo configurado)');

    if (qual === '2') {
      if (PROMOVIVEIS.includes(lead.classificacao || null)) return classificar(leadId, 'atendendo', true);
    } else if (!lead.classificacao) {
      return classificar(leadId, 'contatado', true);
    }
    renderDetalhe();
  }

  // Abre o cliente de e-mail com assunto e corpo prontos e marca Contatado,
  // pelo mesmo caminho do WhatsApp 1. Sem modelo gravado na campanha, abre em
  // branco, como era antes da migração 34.
  async function enviarEmail(leadId) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead || !lead.email) return;
    const assunto = aberta.email_assunto ? preencher(aberta.email_assunto, lead) : '';
    const corpo   = aberta.email_template ? preencher(aberta.email_template, lead) : '';
    const partes = [];
    if (assunto) partes.push('subject=' + encodeURIComponent(assunto));
    if (corpo)   partes.push('body=' + encodeURIComponent(corpo));
    window.location.href = 'mailto:' + lead.email + (partes.length ? '?' + partes.join('&') : '');
    await registrarEnvio(lead, corpo
      ? `E-mail aberto: "${assunto || '(sem assunto)'}"`
      : 'E-mail aberto (nenhum modelo configurado)');
    if (!lead.classificacao) return classificar(leadId, 'contatado', true);
    renderDetalhe();
  }

  // Apaga o lead de vez. Anotações, envios e visitas de LP caem junto por
  // cascade. Quem pode apagar já está na policy da tabela: se o banco recusar,
  // volta zero linha e o aviso diz isso em vez de fingir que apagou.
  async function excluirLead(leadId) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    if (!confirm(`Excluir o lead "${lead.nome}" desta campanha?\n\nAs anotações e o histórico de envios vão junto. Não dá para desfazer.`)) return;
    const apagados = await db(supabaseClient.from('campanha_lead')
      .delete().eq('id', leadId).select('id'), 'excluir lead');
    if (!apagados || !apagados.length) {
      avisar('Não foi possível excluir. Só o admin ou quem criou a campanha pode apagar leads.');
      return;
    }
    leads = leads.filter(l => l.id !== leadId);
    if (visitasLp && typeof visitasLp.delete === 'function') visitasLp.delete(leadId);
    leadAtivoId = null;
    renderPagina();
  }

  async function enviarLp(leadId) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead || !aberta.lp_url) return;
    // Garante que o link vai junto mesmo se o texto não usar {link}: o
    // corretor não tem que lembrar do marcador.
    const base = preencher(aberta.texto_link_lp || TEXTO_LP_PADRAO, lead);
    const link = linkRastreado(leadId);
    const texto = base.includes(link) ? base : (base.trim() ? `${base}\n${link}` : link);
    if (!abrirWhats(`https://wa.me/${waNumero(lead.telefone)}?text=${encodeURIComponent(texto)}`)) return;
    await registrarEnvio(lead, `Link da LP enviado: "${texto}"`);
    if (PROMOVIVEIS.includes(lead.classificacao || null)) return classificar(leadId, 'atendendo', true);
    renderDetalhe();
  }

  // Terceiro caminho de envio: o vídeo do imóvel no YouTube. Marca "Contatado
  // 2", a etapa que existe justamente para separar quem já viu o vídeo de quem
  // só recebeu a primeira mensagem.
  async function enviarYoutube(leadId) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead || !aberta.youtube_url) return;
    // Mesma garantia do envio da LP: o link vai junto mesmo que o texto não
    // use o marcador, para ninguém mandar um convite sem o vídeo.
    const base = preencher(aberta.texto_youtube || TEXTO_YT_PADRAO, lead)
      .replaceAll('{video}', aberta.youtube_url);
    const texto = base.includes(aberta.youtube_url)
      ? base
      : (base.trim() ? `${base}\n${aberta.youtube_url}` : aberta.youtube_url);
    if (!abrirWhats(`https://wa.me/${waNumero(lead.telefone)}?text=${encodeURIComponent(texto)}`)) return;
    await registrarEnvio(lead, `Vídeo do YouTube enviado: "${texto}"`);
    if (PROMOVIVEIS_YT.includes(lead.classificacao || null)) return classificar(leadId, 'contatado_2', true);
    renderDetalhe();
  }

  // O link do WhatsApp só aceita texto, então a imagem vai pela área de
  // transferência. Fica em botão separado de propósito: abrir o WhatsApp e
  // escrever na área de transferência disputam a mesma permissão de clique
  // do navegador, e no Safari uma das duas falha se forem no mesmo clique.
  async function copiarImagem() {
    try {
      const resposta = await fetch(aberta.imagem_primeira_msg);
      const bruto = await resposta.blob();
      const img = await createImageBitmap(bruto);
      const tela = document.createElement('canvas');
      tela.width = img.width; tela.height = img.height;
      tela.getContext('2d').drawImage(img, 0, 0);
      const png = await new Promise(ok => tela.toBlob(ok, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      avisar('Imagem copiada. Cole na conversa do WhatsApp.');
    } catch (e) {
      avisar('Não consegui copiar a imagem: ' + e.message);
    }
  }

  // ── Sugestão do agente ──────────────────────────────────────────────
  // Quem fala com o Gemini é a função de borda "sugerir-mensagem": a chave da
  // API mora lá, nunca aqui, porque este arquivo roda no navegador.
  async function sugerirMensagem(leadId) {
    const lead = leads.find(l => l.id === leadId);
    const caixa = document.getElementById('cpSugestao');
    const botao = document.getElementById('cpSugerir');
    if (!lead || !caixa) return;
    if (botao) botao.disabled = true;
    caixa.innerHTML = '<div class="cp-sugestao cp-sugestao-espera">O agente está escrevendo…</div>';

    const historico = anotacoesDe(lead);
    const h = new Date().getHours();
    const { data, error } = await supabaseClient.functions.invoke('sugerir-mensagem', {
      body: {
        briefing: aberta.contexto_agente,
        leadNome: lead.nome,
        etapa: lead.classificacao || null,
        vinculoNome: aberta.vinculoNome || null,
        historico: historico.map(a => ({
          em: a.em ? dataBr(a.em) : '', etapa: a.etapa ? (ETAPAS[a.etapa] || a.etapa) : '', texto: a.texto || '',
        })),
        exemplos: aberta.templates,
        periodoDia: h >= 5 && h < 12 ? 'manhã' : h < 18 ? 'tarde' : 'noite',
        // Qual tentativa é esta de verdade. Sem isso o agente escreve sempre
        // como se fosse a segunda.
        tentativaNumero: historico.filter(a => a.automatico).length + 1,
      },
    });
    if (botao) botao.disabled = false;

    if (data && data.bloqueado) {
      caixa.innerHTML = `<div class="cp-sugestao">${esc(data.motivo)}</div>`;
      return;
    }
    let motivo = (error && error.message) || (data && data.error);
    // Em resposta de erro o invoke não lê o corpo, e o motivo real (chave
    // ausente, erro do modelo) só está no JSON de dentro.
    if (error && error.context && typeof error.context.json === 'function') {
      try { const corpo = await error.context.json(); if (corpo && corpo.error) motivo = corpo.error; } catch (e) {}
    }
    if (motivo || !(data && data.texto)) {
      caixa.innerHTML = `<div class="cp-sugestao cp-sugestao-erro">
        Não consegui gerar a sugestão: ${esc(motivo || 'resposta vazia')}.
        ${/not found|404|Failed to send/i.test(motivo || '')
          ? 'A função "sugerir-mensagem" ainda não foi publicada neste projeto.' : ''}</div>`;
      return;
    }

    caixa.innerHTML = `
      <div class="cp-sugestao">
        <div class="cp-sugestao-rot">Sugestão do agente. Revise antes de enviar.</div>
        <textarea id="cpSugestaoTexto" rows="4">${esc(data.texto)}</textarea>
        <div class="cp-anot-btns">
          <button class="btn btn-mini btn-primario" id="cpEnviarSug">Enviar no WhatsApp</button>
          <button class="btn btn-mini" id="cpOutraSug">Gerar outra</button>
          <button class="btn btn-mini" id="cpFecharSug">Fechar</button>
        </div>
      </div>`;
    document.getElementById('cpOutraSug').addEventListener('click', () => sugerirMensagem(leadId));
    document.getElementById('cpFecharSug').addEventListener('click', () => { caixa.innerHTML = ''; });
    document.getElementById('cpEnviarSug').addEventListener('click', async () => {
      const texto = document.getElementById('cpSugestaoTexto').value.trim();
      if (!texto) return;
      if (!abrirWhats(`https://wa.me/${waNumero(lead.telefone)}?text=${encodeURIComponent(texto)}`)) return;
      await registrarEnvio(lead, `Mensagem do agente enviada: "${texto}"`);
      if (!lead.classificacao) return classificar(leadId, 'contatado', true);
      renderDetalhe();
    });
  }

  // ── Etapa ───────────────────────────────────────────────────────────
  async function classificar(leadId, etapa, forcar) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    // Clicar na etapa em que já está desmarca e volta para pendente. Com
    // `forcar` (envio automático) isso não vale, senão mandar a mensagem duas
    // vezes tiraria o lead da etapa.
    const nova = (!forcar && lead.classificacao === etapa) ? null : etapa;
    const agora = nova ? new Date().toISOString() : null;
    await db(supabaseClient.from('campanha_lead')
      .update({ classificacao: nova, classificado_em: agora }).eq('id', leadId), 'salvar etapa');
    lead.classificacao = nova;
    lead.classificado_em = agora;

    if (nova === 'interesse' || nova === 'outro_negocio') await mandarProFunil(lead);
    else if (nova) await tirarDoFunil(lead);

    if (vistaCamp === 'crm') { crmSelecionado = null; renderQuadro(); }
    else { renderListaLeads(); renderDetalhe(); }
    await conferirConclusao();
  }

  // ── Ponte campanha → funil ──────────────────────────────────────────
  const soDigitos = t => String(t || '').replace(/\D/g, '');

  function historicoTexto(lead) {
    return anotacoesDe(lead).map(a => {
      const et = a.etapa ? ` [${ETAPAS[a.etapa] || a.etapa}]` : '';
      return `${dataHora(a.em)}${et} — ${a.texto}`;
    }).join('\n');
  }

  async function mandarProFunil(lead) {
    let contatoId = lead.contato_id;
    if (!contatoId) {
      // Antes de criar registro novo, procura na carteira alguém com o mesmo
      // telefone: evita duplicar quem já é cliente ou caiu em duas campanhas.
      const tel = soDigitos(lead.telefone);
      let achado = null;
      if (tel) {
        const candidatos = await db(supabaseClient.from('contato').select('id,telefone')
          .not('telefone', 'is', null), 'procurar na carteira');
        achado = (candidatos || []).find(c => soDigitos(c.telefone).endsWith(tel.slice(-8)));
      }
      if (achado) contatoId = achado.id;
      else {
        const novo = await db(supabaseClient.from('contato').insert({
          nome: lead.nome, telefone: lead.telefone, email: lead.email || null,
          corretor_id: lead.corretor_id, created_by: meuId(),
          obs: `Veio da campanha ${aberta.nome}`,
        }).select('id').single(), 'criar contato');
        contatoId = novo.id;
      }
      await db(supabaseClient.from('campanha_lead').update({ contato_id: contatoId }).eq('id', lead.id), 'vincular contato');
      lead.contato_id = contatoId;
    }

    const marca = `Campanha: ${aberta.nome}`;
    const jaTem = await db(supabaseClient.from('negocio').select('id,obs')
      .eq('contato_id', contatoId), 'conferir o funil');
    if ((jaTem || []).some(n => (n.obs || '').startsWith(marca))) {
      avisar(`${lead.nome} já está no funil.`);
      return;
    }

    const etapas = await Crud.listaApoio('etapa_funil');
    const primeira = etapas[0];
    if (!primeira) { avisar('Nenhuma etapa de funil cadastrada.'); return; }

    const hist = historicoTexto(lead);
    await db(supabaseClient.from('negocio').insert({
      contato_id: contatoId, imovel_id: aberta.imovel_id || null, etapa_id: primeira.id,
      corretor_id: lead.corretor_id, created_by: meuId(),
      obs: marca + (hist ? `\n— histórico da campanha —\n${hist}` : ''),
    }), 'criar negócio');
    avisar(`${lead.nome} entrou no funil.`);
  }

  // Reclassificar para outra coisa tira o negócio do funil, mas só se ele
  // ainda estiver intocado na primeira etapa. Se alguém já trabalhou nele,
  // não mexe: clique errado na campanha não pode apagar trabalho real.
  async function tirarDoFunil(lead) {
    if (!lead.contato_id) return;
    const marca = `Campanha: ${aberta.nome}`;
    const negocios = await db(supabaseClient.from('negocio').select('id,etapa_id,obs')
      .eq('contato_id', lead.contato_id), 'conferir o funil');
    const meu = (negocios || []).find(n => (n.obs || '').startsWith(marca));
    if (!meu) return;

    const etapas = await Crud.listaApoio('etapa_funil');
    if (!etapas.length || meu.etapa_id !== etapas[0].id) return;

    const todas = await db(supabaseClient.from('etapa_funil').select('id,resultado'), 'etapas');
    const perda = (todas || []).find(e => e.resultado === 'perda');
    if (!perda) return;
    await db(supabaseClient.from('negocio')
      .update({ etapa_id: perda.id, fechado_em: hoje() }).eq('id', meu.id), 'tirar do funil');
    avisar(`${lead.nome} saiu do funil.`);
  }

  // ── Conclusão da campanha ───────────────────────────────────────────
  async function conferirConclusao() {
    const pendentes = leads.filter(l => !l.classificacao).length;
    // Desclassificar um lead reabre a campanha. Sem isso ela ficaria marcada
    // como concluída tendo trabalho pendente, e sumiria da aba onde ainda há
    // o que fazer.
    const novo = pendentes ? 'ativa' : 'concluida';
    if (aberta.status === novo) return;
    await db(supabaseClient.from('campanha').update({ status: novo }).eq('id', aberta.id), 'atualizar situação');
    const era = aberta.status;
    aberta.status = novo;
    if (novo === 'concluida' && era !== 'concluida') {
      const contagem = {};
      leads.forEach(l => { contagem[l.classificacao] = (contagem[l.classificacao] || 0) + 1; });
      const resumo = Object.entries(ETAPAS).filter(([k]) => contagem[k])
        .map(([k, r]) => `${r}: ${contagem[k]}`).join(' · ');
      avisar(`Campanha concluída. ${resumo}`);
    }
  }

  // ── Quadro por etapa ────────────────────────────────────────────────
  function renderQuadro() {
    const el = document.getElementById('cpQuadro');
    if (!el) return;
    const colunas = [{ k: null, r: 'Pendente', c: '#8a8a8a' },
      ...Object.entries(ETAPAS).map(([k, r]) => ({ k, r, c: COR_ETAPA[k] }))];

    el.innerHTML = `<div class="cp-quadro">${colunas.map(col => {
      const meus = leads.filter(l => (l.classificacao || null) === col.k);
      return `<div class="cp-coluna">
        <div class="cp-coluna-topo">
          <span class="cp-coluna-ponto" style="background:${col.c}"></span>
          <span class="cp-coluna-nome">${col.r}</span>
          <span class="ini-conta">${meus.length}</span>
        </div>
        <div class="cp-coluna-corpo">${meus.map(l => {
          const sel = crmSelecionado === l.id;
          return `<div class="cp-ficha${sel ? ' sel' : ''}" data-ficha="${l.id}">
            <div class="cp-ficha-nome">${esc(l.nome)}</div>
            <div class="cp-ficha-tel">${esc(l.telefone)}</div>
            ${l.classificado_em ? `<div class="cp-ficha-data">desde ${dataHora(l.classificado_em)}</div>` : ''}
            ${sel ? `<div class="cp-mover">${Object.entries(ETAPAS).map(([k, r]) =>
              `<button class="cp-mover-btn${k === l.classificacao ? ' atual' : ''}" data-mover="${l.id}" data-para="${k}">${r}</button>`).join('')}</div>` : ''}
          </div>`;
        }).join('') || '<p class="cp-coluna-vazia">—</p>'}</div>
      </div>`;
    }).join('')}</div>`;

    el.querySelectorAll('[data-ficha]').forEach(d => d.addEventListener('click', e => {
      if (e.target.closest('[data-mover]')) return;
      crmSelecionado = crmSelecionado === d.dataset.ficha ? null : d.dataset.ficha;
      renderQuadro();
    }));
    el.querySelectorAll('[data-mover]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      classificar(b.dataset.mover, b.dataset.para);
    }));
  }

  // ── Exportar e relatório ────────────────────────────────────────────
  function baixarCsv(nome, linhas) {
    const csv = linhas.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = nome;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Exportar por etapa é o que fecha o ciclo: os "não atendeu" de hoje são a
  // lista da campanha da semana que vem.
  function exportarPorEtapa() {
    const opcoes = [{ k: 'pendente', r: 'Pendente' }, ...Object.entries(ETAPAS).map(([k, r]) => ({ k, r }))];
    const painel = document.createElement('div');
    painel.className = 'cp-modal';
    painel.innerHTML = `
      <div class="cp-modal-caixa">
        <h3>Exportar leads</h3>
        <p class="campo-dica">Marque as etapas. Sai um CSV pronto para virar a próxima campanha.</p>
        <div class="cp-checks">${opcoes.map(o => {
          const n = o.k === 'pendente' ? leads.filter(l => !l.classificacao).length
                                       : leads.filter(l => l.classificacao === o.k).length;
          return `<label class="campo-check"><input type="checkbox" class="cp-exp" value="${o.k}">
            <span>${o.r} <span class="cad-vazio">(${n})</span></span></label>`;
        }).join('')}</div>
        <div class="cp-anot-btns" style="margin-top:16px">
          <button class="btn btn-primario" id="cpExpOk">Exportar</button>
          <button class="btn" id="cpExpTudo">Exportar tudo com histórico</button>
          <button class="btn" id="cpExpFechar">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(painel);
    const fechar = () => painel.remove();
    painel.addEventListener('click', e => { if (e.target === painel) fechar(); });
    document.getElementById('cpExpFechar').addEventListener('click', fechar);

    document.getElementById('cpExpOk').addEventListener('click', () => {
      const marcadas = [...painel.querySelectorAll('.cp-exp:checked')].map(c => c.value);
      if (!marcadas.length) { avisar('Marque ao menos uma etapa.'); return; }
      const sel = leads.filter(l => marcadas.includes(l.classificacao || 'pendente'));
      if (!sel.length) { avisar('Nenhum lead nessas etapas.'); return; }
      baixarCsv(`${arquivo()}-${marcadas.join('-')}.csv`,
        [['nome', 'telefone', 'email', 'origem'], ...sel.map(l => [l.nome, l.telefone, l.email || '', l.origem || ''])]);
      fechar();
    });
    document.getElementById('cpExpTudo').addEventListener('click', () => {
      baixarCsv(`${arquivo()}-completo.csv`, [
        ['Nome', 'Telefone', 'E-mail', 'Origem', 'Etapa', 'Última atividade', 'Histórico'],
        ...leads.map(l => [l.nome, l.telefone, l.email || '', l.origem || '',
          ETAPAS[l.classificacao] || 'Pendente', dataHora(l.classificado_em),
          anotacoesDe(l).map(a => `${dataHora(a.em)}: ${a.texto}`).join(' | ')]),
      ]);
      fechar();
    });
  }

  const arquivo = () => `campanha-${aberta.nome.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${hoje()}`;

  function imprimirRelatorio() {
    const total = leads.length;
    const pendentes = leads.filter(l => !l.classificacao).length;
    const resumo = [
      ...(pendentes ? [['Pendente', pendentes]] : []),
      ...Object.entries(ETAPAS).map(([k, r]) => [r, leads.filter(l => l.classificacao === k).length]),
    ].filter(([, n]) => n);

    const w = window.open('', '_blank');
    if (!w) { avisar('O navegador bloqueou a janela do relatório.'); return; }
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <title>Campanha ${esc(aberta.nome)}</title>
      <style>
        @page { size: A4 portrait; margin: 0 }
        * { box-sizing: border-box }
        body { margin:0; padding:12mm; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif; color:#141414 }
        .faixa { height:6px; background:#c9a84c }
        .topo { background:#101010; color:#f2f2f2; padding:18px 22px; display:flex; align-items:center; gap:14px }
        .marca { width:36px;height:36px;border:2px solid #c9a84c;border-radius:6px;display:flex;
                 align-items:center;justify-content:center;color:#c9a84c;font:700 13px Georgia,serif }
        h1 { font-size:21px; margin:20px 0 2px }
        .sub { color:#777; font-size:12.5px }
        .resumo { margin:14px 0 18px; font-size:11.5px; color:#666 }
        .resumo b { color:#141414 }
        table { width:100%; border-collapse:collapse; margin-top:8px }
        th { text-align:left; padding:8px 10px; border-bottom:2px solid #141414; font-size:10px;
             text-transform:uppercase; letter-spacing:.5px; color:#999 }
        td { padding:7px 10px; border-bottom:1px solid #eee; font-size:12px }
        tr { page-break-inside:avoid }
        .pe { margin-top:18px; padding-top:12px; border-top:1px solid #eee; font-size:10px; color:#999 }
      </style></head><body>
      <div class="faixa"></div>
      <div class="topo"><div class="marca">MI</div><div><strong>Relatório de campanha</strong></div></div>
      <h1>${esc(aberta.nome)}</h1>
      <div class="sub">${esc(aberta.vinculoNome || '')}</div>
      <div class="resumo">${total} leads no total &nbsp; ${resumo.map(([r, n]) => `${r} <b>${n}</b>`).join(' &nbsp;·&nbsp; ')}</div>
      <table><thead><tr><th>Nome</th><th>Telefone</th><th>Etapa</th></tr></thead>
        <tbody>${leads.map(l => `<tr><td>${esc(l.nome)}</td><td>${esc(l.telefone)}</td>
          <td>${esc(ETAPAS[l.classificacao] || 'Pendente')}</td></tr>`).join('')}</tbody></table>
      <div class="pe">Gerado em ${dataHora(new Date().toISOString())}</div>
      </body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  }

  Plataforma.registrar('campanhas', { titulo: 'Campanhas', montar });
})();
