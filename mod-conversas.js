// ══════════════════════════════════════════════════════════════════════
// MÓDULO: CONVERSAS (WhatsApp oficial + SDR com IA)
//
// O inbox do número oficial. Mostra quem escreveu, o que a IA já descobriu
// sobre a pessoa e a resposta sugerida, e deixa o corretor decidir.
//
// Princípios:
//   · Nada sai sem passar por `whatsapp-enviar`, que consulta a regra no
//     banco (opt-in, janela de 24h, pedido de saída). A tela só informa.
//   · A IA começa desligada em toda conversa. No modo "rascunho" ela
//     escreve e o corretor aprova. O modo "automático" só existe se o
//     administrador ligar a chave geral.
//   · O navegador só LÊ as tabelas wa_*; toda mudança é por função no banco.
//   · O que precisa de gente fica no topo, em destaque (visual, não sutil).
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  let alvoEl = null;
  let conversas = [];
  let corretores = [];
  let selecionada = null;      // id da conversa aberta
  let mensagens = [];
  let filtro = 'todas';
  let autoLiberado = false;
  let cfgId = null;
  let timer = null;
  let rascunhoMostrado = null; // id do rascunho que está no campo de texto

  const hhmm = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dataHora = iso => {
    const d = new Date(iso), hoje = new Date();
    const mesmoDia = d.toDateString() === hoje.toDateString();
    return mesmoDia ? hhmm(iso) : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hhmm(iso)}`;
  };
  const nomeDe = c => (c.contato && c.contato.nome) || c.nome_perfil || `+${c.wa_id}`;
  const nomeCorretor = id => (corretores.find(p => p.id === id) || {}).nome || 'outro corretor';
  const conversa = () => conversas.find(c => c.id === selecionada);

  // ── Regras que a tela mostra (quem decide é o banco) ───────────────
  function janela(c) {
    if (c.optout_em) return { ok: false, classe: 'bad', texto: 'Pediu para sair. Não envie nada.' };
    if (!c.janela_ate || new Date(c.janela_ate) <= new Date()) {
      return { ok: false, classe: 'bad', texto: 'Janela de 24h fechada. Só dá para responder depois que a pessoa escrever de novo.' };
    }
    const min = Math.round((new Date(c.janela_ate) - Date.now()) / 60000);
    const resta = min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min} min`;
    return { ok: true, classe: min < 120 ? 'warn' : 'ok', texto: `Pode responder até ${hhmm(c.janela_ate)} (faltam ${resta})` };
  }
  function possoAgir(c) {
    const eu = Plataforma.perfil;
    return eu.papel === 'admin' || !c.corretor_id || c.corretor_id === eu.id;
  }

  // Erros de função vêm no corpo da resposta, não na mensagem do invoke.
  async function chamar(funcao, corpo) {
    const { data, error } = await supabaseClient.functions.invoke(funcao, { body: corpo });
    let motivo = (error && error.message) || (data && (data.erro || data.error));
    if (error && error.context && typeof error.context.json === 'function') {
      try { const j = await error.context.json(); if (j && (j.erro || j.error)) motivo = j.erro || j.error; } catch (e) { /* mantém */ }
    }
    if (error || (data && data.erro)) throw new Error(motivo || 'Falha desconhecida');
    return data;
  }
  const rpc = (nome, args, oque) => db(supabaseClient.rpc(nome, args), oque);

  // ── Dados ──────────────────────────────────────────────────────────
  async function carregarLista() {
    conversas = await db(supabaseClient.from('wa_conversa')
      .select('*, contato:contato_id(nome)').eq('ativo', true)
      .order('ultima_mensagem_em', { ascending: false, nullsFirst: false }).limit(150), 'carregar as conversas');
  }
  async function carregarMensagens() {
    if (!selecionada) { mensagens = []; return; }
    mensagens = await db(supabaseClient.from('wa_mensagem').select('*')
      .eq('conversa_id', selecionada).order('quando', { ascending: true }).limit(300), 'carregar as mensagens');
  }

  // ── Lista ──────────────────────────────────────────────────────────
  function precisaDeVoce(c) { return c.precisa_humano || c.nao_lidas > 0; }

  function renderLista() {
    const box = document.getElementById('cvLista');
    if (!box) return;
    const filtradas = conversas.filter(c =>
      filtro === 'todas' ? true :
      filtro === 'preciso' ? (c.precisa_humano || (c.nao_lidas > 0 && c.sdr_modo !== 'automatico')) :
      filtro === 'ia' ? c.sdr_modo !== 'desligado' : true);
    const precisam = conversas.filter(c => c.precisa_humano).length;

    document.getElementById('cvFiltros').innerHTML = [
      ['todas', 'Todas', conversas.length], ['preciso', 'Preciso responder', conversas.filter(c => c.precisa_humano || c.nao_lidas > 0).length],
      ['ia', 'Com a IA', conversas.filter(c => c.sdr_modo !== 'desligado').length],
    ].map(([k, t, n]) => `<button class="cv-filtro${filtro === k ? ' ativo' : ''}" data-f="${k}">${t}<span>${n}</span></button>`).join('');

    box.innerHTML = filtradas.length ? filtradas.map(c => `
      <button class="cv-item${c.id === selecionada ? ' ativa' : ''}${c.precisa_humano ? ' humano' : ''}" data-id="${c.id}">
        <div class="cv-item-topo">
          <b>${esc(nomeDe(c))}</b>
          <span class="cv-hora">${c.ultima_mensagem_em ? dataHora(c.ultima_mensagem_em) : ''}</span>
        </div>
        <div class="cv-item-meio">
          ${c.precisa_humano ? `<span class="cv-tag cv-tag-humano">Precisa de você</span>` : ''}
          ${c.optout_em ? `<span class="cv-tag cv-tag-sair">Pediu para sair</span>` : ''}
          ${c.sdr_modo !== 'desligado' ? `<span class="cv-tag cv-tag-ia">IA ${c.sdr_modo === 'automatico' ? 'automática' : 'rascunho'}</span>` : ''}
          ${c.temperatura ? `<span class="cv-tag cv-temp-${c.temperatura}">${c.temperatura}</span>` : ''}
          ${c.nao_lidas > 0 ? `<span class="cv-nao-lidas">${c.nao_lidas}</span>` : ''}
        </div>
        ${c.precisa_humano && c.motivo_humano ? `<div class="cv-motivo">${esc(c.motivo_humano)}</div>` : ''}
      </button>`).join('')
      : `<p class="cv-vazio-lista">${conversas.length ? 'Nenhuma conversa neste filtro.' : 'Ainda não há conversas.'}</p>`;

    const aviso = document.getElementById('cvAviso');
    if (aviso) aviso.innerHTML = precisam ? `<div class="cv-alerta">${precisam} conversa${precisam > 1 ? 's' : ''} esperando por você</div>` : '';
  }

  // ── Conversa aberta ────────────────────────────────────────────────
  function renderTopo() {
    const el = document.getElementById('cvTopo');
    const c = conversa();
    if (!el) return;
    if (!c) { el.innerHTML = ''; el.dataset.assin = ''; return; }
    // A atualização automática roda a cada 8 s: se nada mudou, não mexe,
    // senão o seletor da IA fecha na mão de quem está escolhendo.
    const assin = JSON.stringify([c, autoLiberado, Math.floor(Date.now() / 60000)]);
    if (el.dataset.assin === assin) return;
    el.dataset.assin = assin;
    const j = janela(c);
    const q = c.qualificacao || {};
    const chips = [];
    if (q.operacao) chips.push(q.operacao === 'aluguel' ? 'Aluguel' : 'Compra');
    if (q.objetivo) chips.push(q.objetivo === 'investir' ? 'Investir' : 'Morar');
    if (q.tipo) chips.push(q.tipo);
    if (Array.isArray(q.bairros) && q.bairros.length) chips.push(q.bairros.join(', '));
    if (q.valor_min || q.valor_max) {
      const f = v => `R$ ${Number(v).toLocaleString('pt-BR')}`;
      chips.push(q.valor_min && q.valor_max ? `${f(q.valor_min)} a ${f(q.valor_max)}` : q.valor_max ? `até ${f(q.valor_max)}` : `a partir de ${f(q.valor_min)}`);
    }
    if (q.dormitorios_min) chips.push(`${q.dormitorios_min}+ dormitórios`);
    if (q.pagamento && q.pagamento !== 'nao_informado') chips.push({ financiamento: 'Financiamento', a_vista: 'À vista', misto: 'Pagamento misto' }[q.pagamento] || q.pagamento);
    if (q.prazo) chips.push(`Prazo: ${q.prazo}`);

    const pode = possoAgir(c);
    el.innerHTML = `
      <div class="cv-cab">
        <button class="btn btn-fantasma cv-voltar" id="cvVoltar">‹ Conversas</button>
        <div class="cv-cab-nome">
          <h3>${esc(nomeDe(c))}</h3>
          <div class="cv-cab-sub">+${esc(c.wa_id)} · ${c.corretor_id ? 'Responsável: ' + esc(nomeCorretor(c.corretor_id)) : 'Sem responsável'}${c.contato_id ? '' : ' · Ainda não é cliente'}</div>
        </div>
        <div class="cv-cab-acoes">
          ${!c.corretor_id ? `<button class="btn" id="cvAssumir">Assumir</button>` : ''}
          ${!c.contato_id && pode ? `<button class="btn" id="cvCliente">Cadastrar como cliente</button>` : ''}
          <label class="cv-sdr">IA:
            <select id="cvModo" ${pode ? '' : 'disabled'}>
              <option value="desligado"${c.sdr_modo === 'desligado' ? ' selected' : ''}>Desligada</option>
              <option value="rascunho"${c.sdr_modo === 'rascunho' ? ' selected' : ''}>Escreve rascunho</option>
              <option value="automatico"${c.sdr_modo === 'automatico' ? ' selected' : ''}${autoLiberado ? '' : ' disabled'}>Envia sozinha${autoLiberado ? '' : ' (bloqueado)'}</option>
            </select>
          </label>
        </div>
      </div>
      <div class="cv-janela cv-janela-${j.classe}">${esc(j.texto)}</div>
      ${c.precisa_humano ? `<div class="cv-humano"><div><b>Precisa de você</b><span>${esc(c.motivo_humano || 'Sem motivo informado')}</span></div><button class="btn btn-primario" id="cvResolvido">Já resolvi</button></div>` : ''}
      ${(c.resumo || chips.length) ? `<div class="cv-quali">
        <div class="cv-quali-t">O que a IA descobriu${c.temperatura ? ` <span class="cv-tag cv-temp-${c.temperatura}">${c.temperatura}</span>` : ''}</div>
        ${c.resumo ? `<p>${esc(c.resumo)}</p>` : ''}
        ${chips.length ? `<div class="cv-chips">${chips.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
      </div>` : ''}`;
  }

  const STATUS = { enviada: '✓', entregue: '✓✓', lida: '✓✓ lida', falhou: 'não enviou' };

  function renderMensagens(rolarFim) {
    const el = document.getElementById('cvMsgs');
    if (!el) return;
    const visiveis = mensagens.filter(m => m.status !== 'rascunho' && m.status !== 'descartada');
    const rolado = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    el.innerHTML = visiveis.length ? visiveis.map(m => {
      const saida = m.direcao === 'saida';
      const quem = m.autor === 'sdr' ? 'IA' : m.autor === 'corretor' ? (m.enviada_por ? nomeCorretor(m.enviada_por) : 'Corretor') : '';
      const corpo = m.texto ? esc(m.texto) : `<i>[${esc(m.tipo)}]</i>`;
      return `<div class="cv-msg ${saida ? 'saida' : 'entrada'}${m.autor === 'sdr' ? ' ia' : ''}${m.status === 'falhou' ? ' falhou' : ''}">
        ${quem ? `<span class="cv-msg-quem">${esc(quem)}</span>` : ''}
        <div class="cv-msg-txt">${corpo.replace(/\n/g, '<br>')}</div>
        <span class="cv-msg-meta">${dataHora(m.quando)}${saida && STATUS[m.status] ? ' · ' + STATUS[m.status] : ''}${m.erro ? ' · ' + esc(m.erro) : ''}</span>
      </div>`;
    }).join('') : '<p class="cv-vazio-lista">Sem mensagens.</p>';
    if (rolarFim || rolado) el.scrollTop = el.scrollHeight;
  }

  function renderCompor(forcar) {
    const el = document.getElementById('cvCompor');
    const c = conversa();
    if (!el || !c) return;
    const rascunho = [...mensagens].reverse().find(m => m.status === 'rascunho');
    const idRasc = rascunho ? rascunho.id : null;
    // Não apaga o que o corretor está digitando: só redesenha quando muda o
    // rascunho, e mesmo assim, se ele já mexeu no texto, só avisa.
    if (!forcar && el.dataset.rasc === String(idRasc) && el.dataset.conv === c.id) return;
    const ta = document.getElementById('cvTexto');
    if (!forcar && el.dataset.conv === c.id && ta && ta.dataset.mexeu === '1' && ta.value.trim()) {
      const st = document.getElementById('cvStatus');
      if (st && idRasc) { st.textContent = 'A IA escreveu um rascunho novo.'; st.classList.remove('erro'); }
      if (idRasc && !document.getElementById('cvUsarNovo')) {
        const b = document.createElement('button'); b.className = 'btn'; b.id = 'cvUsarNovo'; b.textContent = 'Usar o rascunho novo';
        document.querySelector('.cv-compor-acoes').insertBefore(b, st);
      }
      return;
    }
    el.dataset.rasc = String(idRasc); el.dataset.conv = c.id;
    rascunhoMostrado = idRasc;

    const j = janela(c), pode = possoAgir(c);
    if (!pode) {
      el.innerHTML = `<div class="cv-bloq">Esta conversa é de ${esc(nomeCorretor(c.corretor_id))}. Só ela ou ele (ou um administrador) responde.</div>`;
      return;
    }
    el.innerHTML = `
      ${rascunho ? `<div class="cv-rasc-t"><b>Rascunho da IA</b> <span>Leia e ajuste antes de enviar. Nada saiu ainda.</span></div>` : ''}
      <textarea id="cvTexto" rows="3" oninput="this.dataset.mexeu='1'" placeholder="${j.ok ? 'Escreva a resposta' : 'Não é possível responder agora'}" ${j.ok ? '' : 'disabled'}>${rascunho ? esc(rascunho.texto || '') : ''}</textarea>
      <div class="cv-compor-acoes">
        <button class="btn btn-primario" id="cvEnviar" ${j.ok ? '' : 'disabled'}>Enviar</button>
        ${rascunho ? `<button class="btn" id="cvDescartar">Descartar rascunho</button>` : ''}
        <button class="btn" id="cvGerar" ${j.ok ? '' : 'disabled'}>${rascunho ? 'Reescrever com IA' : 'Gerar rascunho com IA'}</button>
        <span class="cv-status" id="cvStatus"></span>
      </div>`;
  }

  function renderTudo(rolarFim) {
    renderLista(); renderTopo(); renderMensagens(rolarFim); renderCompor(false);
  }

  // ── Ações ──────────────────────────────────────────────────────────
  function ocupado(msg) { const s = document.getElementById('cvStatus'); if (s) s.textContent = msg || ''; }

  async function abrir(id) {
    selecionada = id;
    document.getElementById('cvMiolo').classList.add('aberta');
    document.getElementById('cvPainel').classList.remove('vazio-painel');
    await carregarMensagens();
    renderLista(); renderTopo(); renderMensagens(true); renderCompor(true);
    const c = conversa();
    if (c && c.nao_lidas > 0) {
      try { await rpc('wa_marcar_lida', { p_conversa_id: id }, 'marcar como lida'); c.nao_lidas = 0; renderLista(); } catch (e) { /* já avisou */ }
    }
  }

  async function enviar() {
    const c = conversa(); const ta = document.getElementById('cvTexto');
    const texto = ta && ta.value.trim();
    if (!c || !texto) return avisar('Escreva a mensagem antes de enviar.');
    const btn = document.getElementById('cvEnviar'); btn.disabled = true; ocupado('Enviando…');
    try {
      await chamar('whatsapp-enviar', { conversa_id: c.id, texto, rascunho_id: rascunhoMostrado });
      avisar('Mensagem enviada.');
      await atualizar(true, true);
    } catch (e) {
      ocupado(''); btn.disabled = false;
      mostrarErro(e.message);
    }
  }

  function mostrarErro(texto) {
    const s = document.getElementById('cvStatus');
    if (s) { s.textContent = texto; s.classList.add('erro'); setTimeout(() => s.classList.remove('erro'), 9000); }
    else avisar(texto);
  }

  async function gerar() {
    const c = conversa(); if (!c) return;
    const btn = document.getElementById('cvGerar'); btn.disabled = true; ocupado('A IA está escrevendo…');
    try {
      const r = await chamar('sdr-responder', { conversa_id: c.id });
      if (r && r.acao === 'ignorado') avisar(r.motivo || 'Nada a responder.');
      await atualizar(true, true);
    } catch (e) { ocupado(''); btn.disabled = false; mostrarErro(e.message); }
  }

  async function descartar() {
    if (!rascunhoMostrado) return;
    try {
      await rpc('wa_descartar_rascunho', { p_mensagem_id: rascunhoMostrado }, 'descartar o rascunho');
      await atualizar(true, true);
    } catch (e) { /* já avisou */ }
  }

  async function atualizar(forcarCompor, rolarFim) {
    if (!alvoEl || !alvoEl.isConnected) return;
    await carregarLista();
    await carregarMensagens();
    const c = conversa();
    if (c && c.nao_lidas > 0 && !document.hidden) {
      try { await rpc('wa_marcar_lida', { p_conversa_id: c.id }, 'marcar como lida'); c.nao_lidas = 0; } catch (e) { /* já avisou */ }
    }
    renderLista(); renderTopo(); renderMensagens(rolarFim);
    renderCompor(!!forcarCompor);
  }

  function ligar() {
    alvoEl.addEventListener('click', async ev => {
      const t = ev.target.closest('button'); if (!t) return;
      const c = conversa();
      try {
        if (t.dataset.f) { filtro = t.dataset.f; renderLista(); }
        else if (t.classList.contains('cv-item')) await abrir(t.dataset.id);
        else if (t.id === 'cvVoltar') { document.getElementById('cvMiolo').classList.remove('aberta'); }
        else if (t.id === 'cvEnviar') await enviar();
        else if (t.id === 'cvGerar') await gerar();
        else if (t.id === 'cvDescartar') await descartar();
        else if (t.id === 'cvUsarNovo') renderCompor(true);
        else if (t.id === 'cvAssumir') { await rpc('wa_assumir', { p_conversa_id: c.id }, 'assumir a conversa'); avisar('Conversa é sua agora.'); await atualizar(true); }
        else if (t.id === 'cvResolvido') { await rpc('wa_resolver_humano', { p_conversa_id: c.id }, 'marcar como resolvido'); await atualizar(false); }
        else if (t.id === 'cvCliente') {
          const nome = prompt('Nome do cliente:', c.nome_perfil || '');
          if (nome === null) return;
          await rpc('wa_criar_contato', { p_conversa_id: c.id, p_nome: nome }, 'cadastrar como cliente');
          avisar('Cliente cadastrado.'); await atualizar(false);
        } else if (t.id === 'cvChave') await alternarChave();
      } catch (e) { /* db() e chamar() já avisaram */ }
    });
    alvoEl.addEventListener('change', async ev => {
      if (ev.target.id !== 'cvModo') return;
      const c = conversa();
      try {
        if (ev.target.value === 'automatico' && !confirm('A IA vai responder sozinha, sem você aprovar, nesta conversa. Continuar?')) { ev.target.value = c.sdr_modo; return; }
        await rpc('wa_definir_sdr', { p_conversa_id: c.id, p_modo: ev.target.value }, 'mudar o modo da IA');
        avisar('Modo da IA atualizado.'); await atualizar(false);
      } catch (e) { ev.target.value = c.sdr_modo; }
    });
  }

  async function alternarChave() {
    const novo = !autoLiberado;
    if (novo && !confirm('Liberar a IA para responder sozinha? Isso só vale nas conversas em que você escolher "Envia sozinha". Pode desligar de novo a qualquer momento.')) return;
    await db(supabaseClient.from('configuracao').update({ sdr_automatico_liberado: novo }).eq('id', cfgId), 'mudar a chave geral da IA');
    autoLiberado = novo;
    avisar(novo ? 'IA automática liberada.' : 'IA automática bloqueada em todas as conversas.');
    renderChave(); renderTopo();
  }
  function renderChave() {
    const el = document.getElementById('cvChaveBox'); if (!el) return;
    if (Plataforma.perfil.papel !== 'admin') { el.innerHTML = ''; return; }
    el.innerHTML = `<button class="btn${autoLiberado ? '' : ' btn-fantasma'}" id="cvChave" title="Chave geral: sem ela, nenhuma conversa pode ter a IA enviando sozinha">IA automática: ${autoLiberado ? 'liberada' : 'bloqueada'}</button>`;
  }

  async function montar(alvo) {
    clearInterval(timer);
    alvoEl = alvo; selecionada = null; mensagens = []; filtro = 'todas';
    alvo.innerHTML = '<p class="iv-carregando">Carregando as conversas…</p>';
    const [perfis, cfg] = await Promise.all([
      db(supabaseClient.from('perfil_equipe').select('id,nome').eq('aprovado', true), 'carregar corretores'),
      db(supabaseClient.from('configuracao').select('id,sdr_automatico_liberado').limit(1), 'carregar a configuração'),
    ]);
    corretores = perfis;
    cfgId = cfg[0] && cfg[0].id; autoLiberado = !!(cfg[0] && cfg[0].sdr_automatico_liberado);
    await carregarLista();

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Conversas</h2>
          <div class="secao-meta">WhatsApp oficial. A IA atende primeiro e passa para você quando precisar.</div></div>
        </div>
        <div class="secao-acoes" id="cvChaveBox"></div>
      </div>
      <div id="cvAviso"></div>
      <div class="cv" id="cvMiolo">
        <aside class="cv-coluna">
          <div class="cv-filtros" id="cvFiltros"></div>
          <div class="cv-lista" id="cvLista"></div>
        </aside>
        <section class="cv-painel vazio-painel" id="cvPainel">
          <div class="cv-painel-vazio">
            <div class="vazio-ico">◐</div>
            <h3>${conversas.length ? 'Escolha uma conversa' : 'Nenhuma conversa ainda'}</h3>
            <p>${conversas.length ? 'As que precisam de você aparecem primeiro, em destaque.' : 'As conversas aparecem aqui quando alguém escreve para o número oficial da Maysonnave no WhatsApp.'}</p>
          </div>
          <div id="cvTopo"></div>
          <div class="cv-msgs" id="cvMsgs"></div>
          <div class="cv-compor" id="cvCompor"></div>
        </section>
      </div>`;
    ligar(); renderChave(); renderLista();

    // Atualiza sozinho enquanto a tela estiver aberta.
    timer = setInterval(() => {
      if (!alvoEl || !alvoEl.isConnected) { clearInterval(timer); return; }
      if (document.hidden) return;
      atualizar(false, false).catch(() => {});
    }, 8000);
  }

  Plataforma.registrar('conversas', { titulo: 'Conversas', montar });
})();
