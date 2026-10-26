// ══════════════════════════════════════════════════════════════════════
// MÓDULO: REDES SOCIAIS (Instagram e Facebook)
//
// Páginas:
//   Calendário · o mês com cada post colorido pelo estado; o que espera
//                aprovação e os rascunhos sem data ficam ao lado;
//   Post       · editor: redes, formato, fotos do imóvel ou upload, legenda
//                com IA, assinatura do CRECI, link com UTM, data, conferência
//                e prévia do Instagram e do Facebook;
//   Resultados · alcance, interações, funil até o site e o WhatsApp,
//                melhores horários calculados com os próprios posts;
//   Configurar · conexão com a Meta, assinatura, hashtags.
//
// Quem publica é a função `redes`, chamada pelo pg_cron a cada 5 min. Sem
// conexão com a Meta, tudo funciona menos a publicação: os agendados esperam.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;
  const souAdmin = () => Plataforma.perfil && Plataforma.perfil.papel === 'admin';

  const ESTADOS = {
    rascunho:   { rot: 'Rascunho',     cls: 'rd-st-rascunho' },
    revisao:    { rot: 'Em revisão',   cls: 'rd-st-revisao' },
    aprovado:   { rot: 'Aprovado',     cls: 'rd-st-aprovado' },
    agendado:   { rot: 'Agendado',     cls: 'rd-st-agendado' },
    publicando: { rot: 'Publicando',   cls: 'rd-st-publicando' },
    publicado:  { rot: 'Publicado',    cls: 'rd-st-publicado' },
    falhou:     { rot: 'Falhou',       cls: 'rd-st-falhou' },
    cancelado:  { rot: 'Cancelado',    cls: 'rd-st-cancelado' },
  };
  const FORMATOS = [['imagem', 'Foto'], ['carrossel', 'Carrossel'], ['reels', 'Reels (vídeo)'], ['texto', 'Só texto (Facebook)']];
  const ICONE = { instagram: '◎', facebook: 'ƒ' };
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  let mesVisto = new Date(); mesVisto.setDate(1);
  let editId = null, novoEm = null;
  let cfgCache = null, statusCache = null;

  async function funcao(corpo) {
    const { data, error } = await supabaseClient.functions.invoke('redes', { body: corpo });
    let motivo = (error && error.message) || (data && data.erro);
    if (error && error.context && typeof error.context.json === 'function') {
      try { const j = await error.context.json(); if (j && j.erro) motivo = j.erro; } catch (e) { /* mantém */ }
    }
    if (error || (data && data.erro)) throw new Error(motivo || 'Falha desconhecida');
    return data;
  }
  async function carregarBase() {
    const [[cfg], [imob]] = await Promise.all([
      db(supabaseClient.from('rede_config').select('*').limit(1), 'carregar a configuração'),
      db(supabaseClient.from('configuracao').select('site_url,creci').limit(1), 'carregar a configuração'),
    ]);
    cfgCache = Object.assign({}, cfg || {}, { site_url: (imob || {}).site_url, creci: (imob || {}).creci });
    if (!statusCache) { try { statusCache = await funcao({ acao: 'status' }); } catch (e) { statusCache = { conectado: false, erro: e.message }; } }
  }
  const topo = (t, meta, acoes = '') => `<div class="secao-topo"><div class="secao-titulo"><div class="ponto"></div>
    <div><h2>${esc(t)}</h2><div class="secao-meta">${meta}</div></div></div><div class="secao-acoes">${acoes}</div></div>`;
  const dataLocal = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const hhmm = d => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const chaveDia = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const numeroCreci = () => ((cfgCache && (cfgCache.creci || cfgCache.assinatura)) || '').replace(/\D/g, '');

  function avisoConexao() {
    if (statusCache && statusCache.conectado) {
      const falta = statusCache.permissoes_faltando || [];
      return falta.length ? `<div class="sdr-aviso">Conectado, mas faltam permissões: ${esc(falta.join(', '))}. Conecte de novo em Configurar e marque tudo.</div>` : '';
    }
    return `<div class="sdr-aviso">Instagram e Facebook ainda não estão conectados. Dá para criar, aprovar e agendar; a publicação acontece quando conectar. <button class="btn btn-fantasma" data-ir-sub="configurar">Conectar ›</button></div>`;
  }

  // ══════════════════════════ CALENDÁRIO ══════════════════════════════
  async function calendario(alvo) {
    const ini = new Date(mesVisto.getFullYear(), mesVisto.getMonth(), 1);
    const fim = new Date(mesVisto.getFullYear(), mesVisto.getMonth() + 1, 1);
    const [posts, semData] = await Promise.all([
      db(supabaseClient.from('rede_post').select('id,titulo,status,redes,formato,agendado_para,publicado_em,midias,erro')
        .or(`and(agendado_para.gte.${ini.toISOString()},agendado_para.lt.${fim.toISOString()}),and(publicado_em.gte.${ini.toISOString()},publicado_em.lt.${fim.toISOString()})`), 'carregar o calendário'),
      db(supabaseClient.from('rede_post').select('id,titulo,status,redes,formato,agendado_para,midias,updated_at')
        .in('status', ['rascunho', 'revisao', 'aprovado', 'falhou']).order('updated_at', { ascending: false }).limit(40), 'carregar pendências'),
    ]);
    const porDia = {};
    for (const p of posts) { const d = chaveDia(p.publicado_em || p.agendado_para); (porDia[d] = porDia[d] || []).push(p); }
    Object.values(porDia).forEach(l => l.sort((a, b) => Date.parse(a.publicado_em || a.agendado_para) - Date.parse(b.publicado_em || b.agendado_para)));

    const primeiroDia = ini.getDay(), diasMes = new Date(fim - 1).getDate();
    const hoje = chaveDia(new Date());
    const celulas = [];
    for (let i = 0; i < primeiroDia; i++) celulas.push('<div class="rd-dia vazio"></div>');
    for (let d = 1; d <= diasMes; d++) {
      const k = `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const lista = porDia[k] || [];
      celulas.push(`<div class="rd-dia${k === hoje ? ' hoje' : ''}${k < hoje ? ' passado' : ''}">
        <div class="rd-dia-topo"><span>${d}</span>${k >= hoje ? `<button class="rd-mais" data-novo="${k}" title="Novo post neste dia">+</button>` : ''}</div>
        ${lista.map(p => chipPost(p)).join('')}
      </div>`);
    }
    const revisao = semData.filter(p => p.status === 'revisao');
    const rascunhos = semData.filter(p => p.status === 'rascunho' || (p.status === 'aprovado' && !p.agendado_para));
    const falhas = semData.filter(p => p.status === 'falhou');

    alvo.innerHTML = topo('Redes sociais', 'Instagram e Facebook: planejar, aprovar, publicar e medir.',
      `<button class="btn" data-ir-sub="resultados">Resultados</button><button class="btn btn-primario" data-novo="">+ Novo post</button>`) + `
      ${avisoConexao()}
      ${falhas.length ? `<div class="cv-alerta">${falhas.length} post${falhas.length > 1 ? 's' : ''} não ${falhas.length > 1 ? 'foram publicados' : 'foi publicado'}. Abra para ver o motivo.</div>` : ''}
      <div class="rd-cal-wrap">
        <section class="rd-cal">
          <div class="rd-cal-nav">
            <button class="btn btn-fantasma" id="rdAnt">‹</button>
            <h3>${MESES[mesVisto.getMonth()][0].toUpperCase() + MESES[mesVisto.getMonth()].slice(1)} de ${mesVisto.getFullYear()}</h3>
            <button class="btn btn-fantasma" id="rdProx">›</button>
            <button class="btn btn-fantasma" id="rdHoje">Hoje</button>
          </div>
          <div class="rd-semana">${DIAS.map(d => `<span>${d}</span>`).join('')}</div>
          <div class="rd-grade">${celulas.join('')}</div>
          <div class="rd-legenda">${Object.entries(ESTADOS).filter(([k]) => k !== 'cancelado').map(([, e]) => `<span class="rd-chip ${e.cls}">${e.rot}</span>`).join('')}</div>
        </section>
        <aside class="rd-lado">
          ${revisao.length ? `<div class="rd-bloco destaque"><h4>Esperando aprovação<span class="ini-conta">${revisao.length}</span></h4>${revisao.map(p => linhaPost(p)).join('')}</div>` : ''}
          ${falhas.length ? `<div class="rd-bloco"><h4>Não publicados</h4>${falhas.map(p => linhaPost(p)).join('')}</div>` : ''}
          <div class="rd-bloco"><h4>Rascunhos e aprovados sem data<span class="ini-conta">${rascunhos.length}</span></h4>
            ${rascunhos.length ? rascunhos.map(p => linhaPost(p)).join('') : '<p class="campo-dica">Nada aqui. Crie um post pelo + do dia ou pelo botão Novo post.</p>'}</div>
        </aside>
      </div>`;

    alvo.querySelector('#rdAnt').onclick = () => { mesVisto.setMonth(mesVisto.getMonth() - 1); calendario(alvo); };
    alvo.querySelector('#rdProx').onclick = () => { mesVisto.setMonth(mesVisto.getMonth() + 1); calendario(alvo); };
    alvo.querySelector('#rdHoje').onclick = () => { mesVisto = new Date(); mesVisto.setDate(1); calendario(alvo); };
  }
  function miniatura(p) {
    const m = (p.midias || [])[0];
    return m ? (m.tipo === 'video' ? '<span class="rd-mini rd-mini-video">▶</span>' : `<img class="rd-mini" src="${esc(m.url)}" alt="" loading="lazy">`) : '<span class="rd-mini">✎</span>';
  }
  function chipPost(p) {
    const e = ESTADOS[p.status] || ESTADOS.rascunho;
    const quando = p.publicado_em || p.agendado_para;
    return `<button class="rd-chip ${e.cls}" data-abrir="${p.id}" title="${esc(e.rot)}: ${esc(p.titulo)}">
      <span class="rd-chip-h">${quando ? hhmm(quando) : ''}</span>${(p.redes || []).map(r => `<span class="rd-rede">${ICONE[r]}</span>`).join('')}<span class="rd-chip-t">${esc(p.titulo)}</span></button>`;
  }
  function linhaPost(p) {
    const e = ESTADOS[p.status] || ESTADOS.rascunho;
    return `<button class="rd-linha" data-abrir="${p.id}">${miniatura(p)}
      <span class="rd-linha-t"><b>${esc(p.titulo)}</b><small><span class="rd-chip ${e.cls}">${e.rot}</span> ${(p.redes || []).map(r => ICONE[r]).join(' ')}${p.agendado_para ? ' · ' + dataLocal(p.agendado_para) : ''}</small></span></button>`;
  }

  // ══════════════════════════ EDITOR ══════════════════════════════════
  async function editor(container) {
    // Filho próprio: o editor se redesenha depois de salvar, e ouvintes no
    // mesmo elemento se acumulariam (mover uma foto moveria duas vezes).
    const alvo = document.createElement('div');
    let p;
    if (editId) {
      [p] = await db(supabaseClient.from('rede_post').select('*').eq('id', editId).limit(1), 'abrir o post');
      if (!p) { editId = null; return calendario(container); }
    } else {
      const quando = novoEm ? new Date(`${novoEm}T${String(melhorHora()).padStart(2, '0')}:00`) : null;
      // Id gerado já aqui: o link de rastreio (utm_campaign) precisa do id antes do primeiro salvamento.
      p = { idNovo: crypto.randomUUID(), titulo: '', legenda: '', redes: ['instagram', 'facebook'], formato: 'imagem', midias: [], imovel_id: null, status: 'rascunho',
            agendado_para: quando && quando > new Date() ? quando.toISOString() : null, link: '', resultado: {} };
    }
    const imoveis = await db(supabaseClient.from('imovel').select('id,codigo,titulo,slug').eq('publicar_no_site', true).order('codigo'), 'carregar imóveis');
    const [metricas] = await Promise.all([
      p.id && p.status === 'publicado' ? db(supabaseClient.from('rede_metrica').select('*').eq('post_id', p.id), 'carregar métricas') : Promise.resolve([]),
    ]);
    const adm = souAdmin();
    const travado = ['publicando', 'publicado'].includes(p.status);
    const meu = !p.id || p.criado_por === Plataforma.perfil.id;
    const podeEditar = !travado && (adm || meu);
    const dis = podeEditar ? '' : 'disabled';
    const st = ESTADOS[p.status] || ESTADOS.rascunho;
    const dtLocal = p.agendado_para ? (() => { const d = new Date(p.agendado_para); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); })() : '';
    let midias = Array.isArray(p.midias) ? p.midias.slice() : [];

    container.replaceChildren(alvo);
    alvo.innerHTML = topo(p.id ? (p.titulo || 'Post') : 'Novo post', `<span class="rd-chip ${st.cls}">${st.rot}</span>${p.aprovado_em ? ` · aprovado em ${dataLocal(p.aprovado_em)}` : ''}${p.publicado_em ? ` · publicado em ${dataLocal(p.publicado_em)}` : ''}`,
      `<button class="btn" data-ir-sub="calendario">‹ Calendário</button>`) + `
      ${p.status === 'falhou' || (p.erro && p.status !== 'rascunho') ? `<div class="cv-alerta">${p.status === 'falhou' ? 'Não foi publicado' : 'Atenção'}: ${esc(p.erro || '')}</div>` : ''}
      ${p.status === 'publicado' ? blocoPublicado(p, metricas) : ''}
      <div class="rd-editor">
        <div class="rd-form">
          <section class="ficha-secao"><div class="ficha-grade">
            <div class="campo campo-largo"><label for="rdTitulo">Título (só para a equipe)</label>
              <input type="text" id="rdTitulo" value="${esc(p.titulo === 'Post sem título' ? '' : p.titulo)}" placeholder="Ex.: Royal 902 · vista do Laranjal" ${dis}></div>
            <div class="campo"><label>Onde publicar</label><div class="sdr-horas">
              ${['instagram', 'facebook'].map(r => `<label class="sdr-chip"><input type="checkbox" class="rdRede" value="${r}" ${p.redes.includes(r) ? 'checked' : ''} ${dis}><span>${ICONE[r]} ${r === 'instagram' ? 'Instagram' : 'Facebook'}</span></label>`).join('')}
            </div></div>
            <div class="campo"><label for="rdFormato">Formato</label><select id="rdFormato" ${dis}>
              ${FORMATOS.map(([v, r]) => `<option value="${v}" ${p.formato === v ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
            <div class="campo campo-largo"><label for="rdImovel">Imóvel (opcional)</label>
              <div class="rd-linha-campo"><select id="rdImovel" ${dis}><option value="">Nenhum</option>
                ${imoveis.map(i => `<option value="${i.id}" ${p.imovel_id === i.id ? 'selected' : ''}>${esc(i.codigo)} · ${esc(i.titulo || '')}</option>`).join('')}</select>
                <button class="btn" id="rdFotosImovel" ${dis}>Usar fotos do imóvel</button></div></div>
          </div></section>

          <section class="ficha-secao">
            <div class="ficha-secao-topo"><h3>Fotos e vídeo</h3><p>A ordem aqui é a ordem do carrossel. Fotos viram JPEG automaticamente (o Instagram só aceita JPEG).</p></div>
            <div class="rd-midias" id="rdMidias"></div>
            <div class="rd-fotos-imovel" id="rdFotosLista"></div>
            ${podeEditar ? `<label class="btn rd-upload">Enviar arquivos<input type="file" id="rdArquivo" accept="image/*,video/mp4,video/quicktime" multiple hidden></label><span class="campo-dica" id="rdUpStatus"></span>` : ''}
          </section>

          <section class="ficha-secao">
            <div class="ficha-secao-topo"><h3>Legenda</h3><p>Primeira linha é o gancho: é o que aparece antes do "mais".</p></div>
            <div class="ficha-grade">
              ${podeEditar ? `<div class="campo campo-largo"><label for="rdPedido">Pedir à IA (opcional)</label>
                <div class="rd-linha-campo"><input type="text" id="rdPedido" placeholder="Ex.: foco em quem quer morar perto da praia, tom sofisticado">
                <button class="btn" id="rdIA">Escrever com IA</button></div></div>` : ''}
              <div class="campo campo-largo"><textarea id="rdLegenda" rows="10" ${dis}>${esc(p.legenda || '')}</textarea>
                <div class="rd-legenda-acoes">${podeEditar ? `<button class="btn btn-fantasma" id="rdAssinatura">+ Assinatura do CRECI</button><button class="btn btn-fantasma" id="rdHashtags">+ Hashtags padrão</button>` : ''}
                <span class="campo-dica" id="rdContagem"></span></div></div>
              <div class="campo campo-largo"><label for="rdLink">Link (vai no texto do Facebook; no Instagram, use o link da bio)</label>
                <div class="rd-linha-campo"><input type="text" id="rdLink" value="${esc(p.link || '')}" placeholder="https://maysimoveis.com/..." ${dis}>
                <button class="btn" id="rdGerarLink" ${dis}>Link do imóvel com rastreio</button></div>
                <p class="campo-dica">O rastreio (UTM) mostra em Resultados quantas visitas e cliques no WhatsApp vieram deste post.</p></div>
            </div>
          </section>

          <section class="ficha-secao">
            <div class="ficha-secao-topo"><h3>Quando publicar</h3><p>Sugestões pelos horários com mais engajamento.</p></div>
            <div class="ficha-grade">
              <div class="campo"><label for="rdQuando">Data e hora</label><input type="datetime-local" id="rdQuando" value="${dtLocal}" ${dis}></div>
              <div class="campo"><label>Horários sugeridos</label><div class="sdr-horas" id="rdSugHoras">
                ${horariosSugeridos().map(h => `<button class="sdr-sug" data-hora="${h}" ${dis}>${h}h</button>`).join('')}</div></div>
            </div>
          </section>

          <section class="ficha-secao"><div class="ficha-secao-topo"><h3>Conferência</h3><p>O que precisa estar certo antes de aprovar.</p></div>
            <ul class="rd-checks" id="rdChecks"></ul></section>

          <div class="sdr-salvar rd-acoes" id="rdAcoes"></div>
        </div>
        <aside class="rd-previa" id="rdPrevia"></aside>
      </div>`;

    const $ = id => alvo.querySelector('#' + id);
    const redes = () => [...alvo.querySelectorAll('.rdRede:checked')].map(i => i.value);

    function desenharMidias() {
      $('rdMidias').innerHTML = midias.length ? midias.map((m, i) => `
        <div class="rd-midia">${m.tipo === 'video' ? `<video src="${esc(m.url)}" muted></video>` : `<img src="${esc(m.url)}" alt="">`}
          <span class="rd-midia-n">${i + 1}</span>
          ${podeEditar ? `<div class="rd-midia-acoes"><button data-mover="${i}" data-dir="-1" title="Para a esquerda">‹</button><button data-tirar="${i}" title="Tirar">✕</button><button data-mover="${i}" data-dir="1" title="Para a direita">›</button></div>` : ''}
        </div>`).join('') : '<p class="campo-dica">Nenhuma mídia ainda.</p>';
    }
    function conferencia() {
      const leg = $('rdLegenda').value, rs = redes(), fmt = $('rdFormato').value;
      const tags = (leg.match(/#[\p{L}\p{N}_]+/gu) || []).length;
      const imgs = midias.filter(m => m.tipo !== 'video'), vids = midias.filter(m => m.tipo === 'video');
      const creci = numeroCreci();
      const checks = [
        [rs.length > 0, 'Escolher ao menos uma rede'],
        [!creci || leg.replace(/\D/g, ' ').includes(creci), `Assinatura com o CRECI na legenda (exigência do COFECI para anúncio)${creci ? ` · ${creci}` : ''}`],
        [leg.trim().length > 0 || fmt !== 'texto', 'Legenda escrita'],
        [leg.length <= 2200, `Legenda até 2.200 caracteres (${leg.length})`],
        [tags <= 30, `Até 30 hashtags (${tags})`],
        [!rs.includes('instagram') || (fmt !== 'texto' && midias.length > 0), 'Instagram precisa de foto ou vídeo (não aceita "Só texto")'],
        [fmt !== 'carrossel' || (midias.length >= 2 && midias.length <= 10), 'Carrossel com 2 a 10 itens'],
        [fmt !== 'reels' || vids.length >= 1, 'Reels precisa de um vídeo'],
        [!rs.includes('instagram') || imgs.every(m => !m.w || (m.w / m.h >= 0.8 && m.w / m.h <= 1.91)), 'Fotos no formato aceito pelo Instagram (entre 4:5 em pé e 1,91:1 deitada)'],
      ];
      $('rdChecks').innerHTML = checks.map(([ok, t]) => `<li class="${ok ? 'ok' : 'falta'}">${ok ? '✓' : '✗'} ${esc(t)}</li>`).join('');
      $('rdContagem').textContent = `${leg.length}/2.200 caracteres · ${tags} hashtags`;
      return checks.every(c => c[0]);
    }
    function previa() {
      const leg = $('rdLegenda').value, rs = redes();
      const m = midias[0];
      const midiaHtml = m ? (m.tipo === 'video' ? `<video src="${esc(m.url)}" muted></video>` : `<img src="${esc(m.url)}" alt="">`) : '<div class="rd-pv-vazia">sem mídia</div>';
      const [primeira, ...resto] = leg.split('\n');
      $('rdPrevia').innerHTML = `
        ${rs.includes('instagram') ? `<div class="rd-pv"><div class="rd-pv-cab"><span class="rd-pv-av">M</span><b>${esc((statusCache && statusCache.instagram) || 'maysimoveis')}</b></div>
          <div class="rd-pv-midia">${midiaHtml}${midias.length > 1 ? `<span class="rd-pv-n">1/${midias.length}</span>` : ''}</div>
          <div class="rd-pv-acoes">♡ ◯ ➤ <span style="margin-left:auto">⌑</span></div>
          <div class="rd-pv-txt"><b>${esc((statusCache && statusCache.instagram) || 'maysimoveis')}</b> ${esc(primeira || '').slice(0, 125)}${(primeira || '').length > 125 || resto.length ? ' <span class="rd-pv-mais">… mais</span>' : ''}</div>
          <p class="campo-dica">Prévia do Instagram (aproximada).</p></div>` : ''}
        ${rs.includes('facebook') ? `<div class="rd-pv"><div class="rd-pv-cab"><span class="rd-pv-av">M</span><b>${esc((statusCache && statusCache.pagina) || 'Maysonnave imóveis')}</b></div>
          <div class="rd-pv-txt rd-pv-fb">${esc(leg).slice(0, 400).replace(/\n/g, '<br>')}${leg.length > 400 ? ' <span class="rd-pv-mais">Ver mais</span>' : ''}${$('rdLink').value ? `<br><span class="rd-pv-link">${esc($('rdLink').value)}</span>` : ''}</div>
          ${$('rdFormato').value !== 'texto' ? `<div class="rd-pv-midia">${midiaHtml}</div>` : ''}
          <p class="campo-dica">Prévia do Facebook (aproximada).</p></div>` : ''}`;
    }
    function acoes() {
      const okConf = conferencia();
      const b = [];
      if (podeEditar) b.push(`<button class="btn" id="rdSalvar">Salvar rascunho</button>`);
      if (podeEditar && !adm && ['rascunho', 'falhou'].includes(p.status)) b.push(`<button class="btn btn-primario" id="rdRevisao" ${okConf ? '' : 'disabled'}>Enviar para aprovação</button>`);
      if (adm && !travado) {
        b.push(`<button class="btn btn-primario" id="rdAgendar" ${okConf ? '' : 'disabled'}>Aprovar e agendar</button>`);
        if (statusCache && statusCache.conectado && p.id) b.push(`<button class="btn" id="rdAgora" ${okConf ? '' : 'disabled'}>Publicar agora</button>`);
      }
      if (podeEditar && ['aprovado', 'agendado', 'revisao'].includes(p.status)) b.push(`<button class="btn btn-fantasma" id="rdVoltar">Voltar para rascunho</button>`);
      if (p.id && !travado && (adm || meu)) b.push(`<button class="btn btn-fantasma" id="rdExcluir">Excluir</button>`);
      if (!okConf && !travado) b.push(`<span class="campo-dica">Complete a conferência para aprovar.</span>`);
      $('rdAcoes').innerHTML = b.join('');
      ligarAcoes();
    }
    const atualizar = () => { previa(); acoes(); };

    function dadosForm(status) {
      const quando = $('rdQuando').value ? new Date($('rdQuando').value).toISOString() : null;
      return {
        titulo: $('rdTitulo').value.trim() || 'Post sem título', legenda: $('rdLegenda').value, redes: redes().length ? redes() : ['instagram'],
        formato: $('rdFormato').value, midias, imovel_id: $('rdImovel').value || null, link: $('rdLink').value.trim() || null,
        agendado_para: quando, status, ...(status === 'agendado' ? { tentativas: 0, erro: null } : {}),
      };
    }
    async function salvar(status, msg) {
      const d = dadosForm(status);
      if (status === 'agendado' && !d.agendado_para) return avisar('Escolha a data e a hora.');
      if (status === 'agendado' && Date.parse(d.agendado_para) < Date.now() - 60e3) return avisar('Essa data já passou. Escolha uma data futura ou use Publicar agora.');
      if (p.id) await db(supabaseClient.from('rede_post').update(d).eq('id', p.id), 'salvar o post');
      else { const [n] = await db(supabaseClient.from('rede_post').insert({ ...d, id: p.idNovo, utm_campaign: 'post-' + p.idNovo.slice(0, 8) }).select('id'), 'criar o post'); p.id = n.id; p.utm_campaign = 'post-' + n.id.slice(0, 8); editId = n.id; }
      if (!p.utm_campaign && p.id) { p.utm_campaign = 'post-' + p.id.slice(0, 8); await supabaseClient.from('rede_post').update({ utm_campaign: p.utm_campaign }).eq('id', p.id); }
      avisar(msg); editId = p.id; novoEm = null; return true;
    }
    function ligarAcoes() {
      const on = (id, fn) => { const el = $(id); if (el) el.onclick = async () => { el.disabled = true; try { await fn(); } catch (e) { /* db/funcao já avisaram */ } el.disabled = false; }; };
      on('rdSalvar', async () => { if (await salvar(p.status === 'falhou' ? 'rascunho' : (['aprovado', 'agendado'].includes(p.status) && !adm ? 'revisao' : p.status), 'Salvo.')) editor(container); });
      on('rdRevisao', async () => { if (await salvar('revisao', 'Enviado para aprovação.')) editor(container); });
      on('rdAgendar', async () => { if (await salvar('agendado', 'Aprovado e agendado.')) editor(container); });
      on('rdVoltar', async () => { if (await salvar('rascunho', 'Voltou para rascunho.')) editor(container); });
      on('rdAgora', async () => {
        if (!confirm('Publicar agora no ' + redes().join(' e ') + '?')) return;
        if (!(await salvar('aprovado', 'Salvo.'))) return;
        try { const r = await funcao({ acao: 'publicar_agora', post_id: p.id }); avisar(r.estado === 'publicado' ? 'Publicado!' : r.estado === 'processando' ? 'Vídeo em processamento na Meta. Publica em alguns minutos.' : 'Não publicou: ' + (r.erro || r.estado)); }
        catch (e) { avisar('Não publicou: ' + e.message); }
        editor(container);
      });
      on('rdExcluir', async () => { if (!confirm('Excluir este post?')) return; await db(supabaseClient.from('rede_post').delete().eq('id', p.id), 'excluir'); editId = null; avisar('Excluído.'); calendario(container); });
    }

    // ── eventos do formulário ──
    alvo.querySelectorAll('#rdLegenda, #rdLink, #rdFormato, .rdRede').forEach(el => el.addEventListener('input', atualizar));
    alvo.querySelectorAll('#rdFormato, .rdRede').forEach(el => el.addEventListener('change', atualizar));
    alvo.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.tirar !== undefined) { midias.splice(Number(b.dataset.tirar), 1); desenharMidias(); atualizar(); }
      else if (b.dataset.mover !== undefined) {
        const i = Number(b.dataset.mover), j = i + Number(b.dataset.dir);
        if (j >= 0 && j < midias.length) { [midias[i], midias[j]] = [midias[j], midias[i]]; desenharMidias(); atualizar(); }
      } else if (b.dataset.hora) {
        const base = $('rdQuando').value ? new Date($('rdQuando').value) : new Date(Date.now() + 86400e3);
        base.setHours(Number(b.dataset.hora), 0, 0, 0);
        if (base < new Date()) base.setDate(base.getDate() + 1);
        base.setMinutes(base.getMinutes() - base.getTimezoneOffset()); $('rdQuando').value = base.toISOString().slice(0, 16);
      } else if (b.dataset.foto) {
        const url = b.dataset.foto;
        if (!midias.some(m => m.url === url)) { midias.push({ url, tipo: 'imagem', w: Number(b.dataset.w) || null, h: Number(b.dataset.h) || null }); }
        else midias = midias.filter(m => m.url !== url);
        b.classList.toggle('escolhida'); desenharMidias(); atualizar();
      }
    });
    if (podeEditar) {
      $('rdAssinatura').onclick = () => { const a = (cfgCache && cfgCache.assinatura) || ''; if (a && !$('rdLegenda').value.includes(a)) $('rdLegenda').value = $('rdLegenda').value.trimEnd() + '\n\n' + a; atualizar(); };
      $('rdHashtags').onclick = () => { const h = (cfgCache && cfgCache.hashtags_padrao) || ''; if (h && !$('rdLegenda').value.includes(h)) $('rdLegenda').value = $('rdLegenda').value.trimEnd() + '\n\n' + h; atualizar(); };
      $('rdGerarLink').onclick = () => {
        const im = imoveis.find(i => i.id === $('rdImovel').value);
        const base = ((cfgCache && cfgCache.site_url) || 'https://maysimoveis.com').replace(/\/$/, '');
        const camp = 'post-' + (p.id || p.idNovo).slice(0, 8);
        $('rdLink').value = `${base}${im && im.slug ? '/imovel/' + im.slug + '/' : '/'}?utm_source=facebook&utm_medium=social&utm_campaign=${camp}`;
        atualizar();
      };
      $('rdIA').onclick = async () => {
        const btn = $('rdIA'); btn.disabled = true; btn.textContent = 'Escrevendo…';
        try {
          const r = await funcao({ acao: 'legenda', imovel_id: $('rdImovel').value || null, pedido: $('rdPedido').value, formato: $('rdFormato').value, redes: redes() });
          const assin = (cfgCache && cfgCache.assinatura) || '', tags = (cfgCache && cfgCache.hashtags_padrao) || '';
          $('rdLegenda').value = [r.legenda, assin, tags].filter(Boolean).join('\n\n');
          if (!$('rdTitulo').value) { const im = imoveis.find(i => i.id === $('rdImovel').value); if (im) $('rdTitulo').value = `${im.codigo} · ${im.titulo || ''}`.trim(); }
          avisar(`Legenda escrita (${r.motor === 'gemini' ? 'Gemini' : 'Claude'}). Revise antes de aprovar.`);
        } catch (e) { avisar('A IA não respondeu: ' + e.message); }
        btn.disabled = false; btn.textContent = 'Escrever com IA'; atualizar();
      };
      $('rdFotosImovel').onclick = async () => {
        const id = $('rdImovel').value; if (!id) return avisar('Escolha o imóvel primeiro.');
        const fotos = await db(supabaseClient.from('imovel_foto').select('url,url_thumb,ordem').eq('imovel_id', id).order('ordem'), 'carregar fotos');
        $('rdFotosLista').innerHTML = fotos.length ? `<p class="campo-dica">Clique nas fotos para incluir ou tirar (na ordem dos cliques).</p><div class="rd-fotos-grade">${fotos.map(f =>
          `<button class="rd-foto ${midias.some(m => m.url === f.url) ? 'escolhida' : ''}" data-foto="${esc(f.url)}"><img src="${esc(f.url_thumb || f.url)}" alt="" loading="lazy"></button>`).join('')}</div>` : '<p class="campo-dica">Este imóvel não tem fotos.</p>';
      };
      $('rdArquivo').onchange = async ev => {
        const arqs = [...ev.target.files]; ev.target.value = '';
        for (const [n, a] of arqs.entries()) {
          $('rdUpStatus').textContent = `Enviando ${n + 1} de ${arqs.length}…`;
          try { midias.push(await enviarArquivo(a)); desenharMidias(); atualizar(); }
          catch (e) { avisar(`Não enviou ${a.name}: ${e.message}`); }
        }
        $('rdUpStatus').textContent = '';
      };
    }
    desenharMidias(); atualizar();
  }

  /** Envia para o storage `midia`. Foto vira JPEG (Instagram só aceita JPEG), até 2048 px. */
  async function enviarArquivo(arquivo) {
    const video = arquivo.type.startsWith('video/');
    let corpo = arquivo, tipo = arquivo.type, ext = (arquivo.name.split('.').pop() || 'bin').toLowerCase(), w = null, h = null;
    if (!video) {
      const bmp = await createImageBitmap(arquivo);
      const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
      w = Math.round(bmp.width * k); h = Math.round(bmp.height * k);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
      corpo = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9)); tipo = 'image/jpeg'; ext = 'jpg';
    } else if (arquivo.size > 200 * 1024 * 1024) throw new Error('vídeo maior que 200 MB');
    const caminho = `redes/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabaseClient.storage.from('midia').upload(caminho, corpo, { contentType: tipo, upsert: false });
    if (error) throw new Error(error.message);
    const { data } = supabaseClient.storage.from('midia').getPublicUrl(caminho);
    return { url: data.publicUrl, tipo: video ? 'video' : 'imagem', w, h };
  }

  function blocoPublicado(p, metricas) {
    const res = p.resultado || {};
    const m = Object.fromEntries((metricas || []).map(x => [x.rede, x]));
    const linha = r => {
      const x = m[r] || {};
      return `<div class="rd-pub"><b>${ICONE[r]} ${r === 'instagram' ? 'Instagram' : 'Facebook'}</b>
        ${res[r] && res[r].permalink ? `<a href="${esc(res[r].permalink)}" target="_blank" rel="noopener">ver publicação ›</a>` : res[r] && res[r].erro ? `<span class="rd-erro">${esc(res[r].erro)}</span>` : ''}
        <span>${['alcance', 'curtidas', 'comentarios', 'salvos', 'compartilhamentos'].map(k => `${k}: <b>${x[k] ?? '—'}</b>`).join(' · ')}</span></div>`;
    };
    return `<section class="ficha-secao"><div class="ficha-secao-topo"><h3>Publicado</h3><p>Números atualizados a cada 6 horas.</p></div>
      <div class="rd-pubs">${(p.redes || []).map(linha).join('')}</div></section>`;
  }

  // Melhores horários: dos próprios posts quando houver dados; antes disso, referência de mercado.
  let horasCache = null;
  function horariosSugeridos() { return horasCache && horasCache.length ? horasCache : [11, 12, 18, 19]; }
  function melhorHora() { return horariosSugeridos()[0]; }

  // ══════════════════════════ RESULTADOS ══════════════════════════════
  async function resultados(alvo) {
    const desde = new Date(Date.now() - 30 * 86400e3).toISOString();
    const [posts, mets, visitas, leads] = await Promise.all([
      db(supabaseClient.from('rede_post').select('id,titulo,redes,publicado_em,utm_campaign,midias').eq('status', 'publicado').gte('publicado_em', new Date(Date.now() - 90 * 86400e3).toISOString()).order('publicado_em', { ascending: false }), 'carregar posts'),
      db(supabaseClient.from('rede_metrica').select('*'), 'carregar métricas'),
      db(supabaseClient.from('visita_site').select('tipo,origem,utm_campaign,utm_source,criado_em').gte('criado_em', desde), 'carregar visitas'),
      db(supabaseClient.from('lead_site').select('origem,created_at').gte('created_at', desde), 'carregar leads'),
    ]).catch(() => [[], [], [], []]);
    const porPost = {};
    for (const m of mets) { const o = porPost[m.post_id] = porPost[m.post_id] || { alcance: 0, inter: 0, salvos: 0 }; o.alcance += m.alcance || 0; o.inter += (m.curtidas || 0) + (m.comentarios || 0) + (m.salvos || 0) + (m.compartilhamentos || 0); o.salvos += m.salvos || 0; }
    const ult30 = posts.filter(p => p.publicado_em >= desde);
    const soma = k => ult30.reduce((a, p) => a + ((porPost[p.id] || {})[k] || 0), 0);
    const alcance = soma('alcance'), inter = soma('inter');
    const daRede = v => /instagram|facebook/i.test(v.origem || '') || /^post-/.test(v.utm_campaign || '') || /instagram|facebook/i.test(v.utm_source || '');
    const visRede = visitas.filter(v => v.tipo === 'pagina' && daRede(v)).length;
    const zapRede = visitas.filter(v => v.tipo === 'whatsapp' && daRede(v)).length;
    const leadsRede = leads.filter(l => /instagram|facebook/i.test(l.origem || '') && !/ads/i.test(l.origem || '')).length;
    const porCamp = {};
    for (const v of visitas) if (v.utm_campaign) { const c = porCamp[v.utm_campaign] = porCamp[v.utm_campaign] || { vis: 0, zap: 0 }; v.tipo === 'whatsapp' ? c.zap++ : c.vis++; }

    // Melhores horários com os próprios dados (engajamento por hora de publicação).
    const porHora = {};
    for (const p of posts) { const x = porPost[p.id]; if (!x || !x.alcance) continue; const h = new Date(p.publicado_em).getHours(); (porHora[h] = porHora[h] || []).push(x.inter / x.alcance); }
    const horasProprias = Object.entries(porHora).filter(([, l]) => l.length >= 2).map(([h, l]) => [Number(h), l.reduce((a, b) => a + b, 0) / l.length]).sort((a, b) => b[1] - a[1]);
    horasCache = horasProprias.length >= 3 ? horasProprias.slice(0, 4).map(x => x[0]) : null;

    const funil = [['Posts publicados', ult30.length], ['Pessoas alcançadas', alcance], ['Interações', inter], ['Visitas ao site vindas das redes', visRede], ['Cliques no WhatsApp vindos das redes', zapRede], ['Leads das redes (sem anúncio)', leadsRede]];
    alvo.innerHTML = topo('Redes sociais · Resultados', 'Últimos 30 dias. Números do Instagram e do Facebook atualizados a cada 6 horas.',
      `<button class="btn" data-ir-sub="calendario">‹ Calendário</button>${statusCache && statusCache.conectado ? '<button class="btn btn-primario" id="rdAtualizar">Atualizar números agora</button>' : ''}`) + `
      ${avisoConexao()}
      <section class="ficha-secao"><div class="ficha-secao-topo"><h3>Do post à venda</h3><p>Cada etapa do caminho. O site conta as visitas pelo link com rastreio e pela origem Instagram/Facebook.</p></div>
        <div class="rd-funil">${funil.map(([r, v], i) => `<div class="rd-funil-et" style="--i:${i}"><b>${Number(v).toLocaleString('pt-BR')}</b><span>${r}</span></div>`).join('')}</div>
        <p class="campo-dica" style="padding:0 20px 16px">Taxa de engajamento: <b>${alcance ? (100 * inter / alcance).toFixed(1).replace('.', ',') + '%' : '—'}</b> (interações ÷ alcance).</p></section>
      <section class="ficha-secao"><div class="ficha-secao-topo"><h3>Posts</h3><p>Os publicados nos últimos 90 dias, do mais recente.</p></div>
        ${posts.length ? `<div class="cad-tabela-scroll" style="border:none"><table class="cad-tabela"><thead><tr><th>Post</th><th>Data</th><th>Alcance</th><th>Interações</th><th>Salvos</th><th>Visitas</th><th>WhatsApp</th></tr></thead><tbody>
          ${posts.map(p => { const x = porPost[p.id] || {}; const c = porCamp[p.utm_campaign] || {};
            return `<tr class="cad-linha" data-abrir="${p.id}"><td>${esc(p.titulo)} ${(p.redes || []).map(r => ICONE[r]).join(' ')}</td><td class="cad-num">${dataLocal(p.publicado_em)}</td>
              <td class="cad-num">${x.alcance ?? '—'}</td><td class="cad-num">${x.inter ?? '—'}</td><td class="cad-num">${x.salvos ?? '—'}</td><td class="cad-num">${c.vis || 0}</td><td class="cad-num">${c.zap || 0}</td></tr>`; }).join('')}
        </tbody></table></div>` : '<p class="ini-vazio" style="padding:16px 20px">Nenhum post publicado ainda.</p>'}</section>
      <section class="ficha-secao"><div class="ficha-secao-topo"><h3>Melhores horários</h3>
        <p>${horasCache ? 'Calculados com os seus posts (engajamento por hora de publicação).' : 'Referência de mercado até haver posts suficientes: meio do dia e começo da noite, terça e quarta melhores, domingo pior.'}</p></div>
        <div class="sdr-horas" style="padding:14px 20px 18px">${horariosSugeridos().map(h => `<span class="sdr-chip"><span>${h}h</span></span>`).join('')}</div></section>`;
    const at = alvo.querySelector('#rdAtualizar');
    if (at) at.onclick = async () => { at.disabled = true; try { const r = await funcao({ acao: 'metricas' }); avisar(`${r.coletados} conjunto(s) de números atualizados.`); resultados(alvo); } catch (e) { avisar(e.message); at.disabled = false; } };
  }

  // ══════════════════════════ CONFIGURAR ══════════════════════════════
  async function configurar(alvo) {
    statusCache = null; await carregarBase();
    const s = statusCache || {}, c = cfgCache || {}, adm = souAdmin(), dis = adm ? '' : 'disabled';
    const retorno = location.origin + '/meta-retorno.html';
    alvo.innerHTML = topo('Redes sociais · Configurar', 'Conexão com a Meta, assinatura e padrões dos posts.', `<button class="btn" data-ir-sub="calendario">‹ Calendário</button>`) + `
      <section class="ficha-secao"><div class="ficha-secao-topo"><h3>Conexão com Facebook e Instagram</h3><p>Pelo app da Meta que a Maysonnave já usa para os leads.</p></div>
        <div class="sdr-status-grade">
          <div class="sdr-status ${s.conectado ? 'ok' : 'falta'}"><span class="sdr-status-ico">${s.conectado ? '✓' : '!'}</span>
            <div><b>${s.conectado ? 'Conectado' : 'Não conectado'}</b>
              <p>${s.conectado ? `Página: ${esc(s.pagina || '—')} · Instagram: @${esc(s.instagram || '—')}${s.conectado_em ? ` · desde ${dataLocal(s.conectado_em)}` : ''}` : 'Sem conexão, os posts aprovados esperam na fila.'}</p>
              ${s.permissoes_faltando && s.permissoes_faltando.length ? `<p class="rd-erro">Faltam permissões: ${esc(s.permissoes_faltando.join(', '))}</p>` : ''}
              ${s.erro ? `<p class="rd-erro">${esc(s.erro)}</p>` : ''}</div></div>
        </div>
        ${adm ? `<div style="padding:0 20px 18px">
          <ol class="sdr-passos" style="padding:0 0 12px 22px">
            <li>Só na primeira vez: no <a href="https://developers.facebook.com/apps/${esc(s.app_id || '')}/fb-login/settings/" target="_blank" rel="noopener">painel do app na Meta</a> (Login do Facebook › Configurações), cole em <b>URIs de redirecionamento do OAuth válidos</b>:
              <div class="rd-linha-campo" style="margin-top:6px"><input type="text" readonly value="${esc(retorno)}" id="rdRetorno"><button class="btn" id="rdCopiar">Copiar</button></div>
              <span class="campo-dica">Se o app ainda não tiver o produto "Login do Facebook", adicione em Adicionar produto.</span></li>
            <li>Clique em Conectar, entre com o Facebook de administrador da página e marque a página da Maysonnave e o Instagram @maysimoveis, com todas as permissões.</li>
          </ol>
          <button class="btn btn-primario" id="rdConectar">${s.conectado ? 'Conectar de novo' : 'Conectar Facebook e Instagram'}</button>
          ${s.conectado ? '<button class="btn btn-fantasma" id="rdDesconectar">Desconectar</button>' : ''}
        </div>` : '<p class="campo-dica" style="padding:0 20px 18px">Só o administrador conecta.</p>'}
      </section>
      <section class="ficha-secao"><div class="ficha-secao-topo"><h3>Padrões dos posts</h3><p>Usados pelos botões do editor.</p></div>
        <div class="ficha-grade">
          <div class="campo campo-largo"><label for="rdCfgAssin">Assinatura (CRECI)</label><input type="text" id="rdCfgAssin" value="${esc(c.assinatura || '')}" ${dis}>
            <p class="campo-dica">O COFECI exige nome, "corretor de imóveis" e o número do CRECI em anúncio, inclusive em rede social. A conferência do editor procura o número.</p></div>
          <div class="campo campo-largo"><label for="rdCfgTags">Hashtags padrão</label><input type="text" id="rdCfgTags" value="${esc(c.hashtags_padrao || '')}" ${dis}></div>
        </div>
        ${adm ? '<div style="padding:0 20px 18px"><button class="btn btn-primario" id="rdCfgSalvar">Salvar padrões</button></div>' : ''}
      </section>`;
    if (!adm) return;
    alvo.querySelector('#rdCopiar').onclick = () => { navigator.clipboard.writeText(retorno).then(() => avisar('Copiado.')); };
    alvo.querySelector('#rdConectar').onclick = async () => {
      try {
        const r = await funcao({ acao: 'url_conectar', redirect_uri: retorno });
        try { localStorage.setItem('plat_modulo', 'redes'); } catch (e) { /* ok */ }
        location.href = r.url;
      } catch (e) { avisar(e.message); }
    };
    const des = alvo.querySelector('#rdDesconectar');
    if (des) des.onclick = async () => { if (!confirm('Desconectar? Os agendados param de publicar.')) return; await funcao({ acao: 'desconectar' }); avisar('Desconectado.'); configurar(alvo); };
    alvo.querySelector('#rdCfgSalvar').onclick = async () => {
      await db(supabaseClient.from('rede_config').update({ assinatura: alvo.querySelector('#rdCfgAssin').value.trim(), hashtags_padrao: alvo.querySelector('#rdCfgTags').value.trim() }).eq('id', true), 'salvar padrões');
      cfgCache = null; avisar('Padrões salvos.');
    };
  }

  /** Volta do Facebook: meta-retorno.html guardou o código; aqui ele vira a conexão. */
  async function concluirConexao(alvo) {
    let pend = null;
    try { pend = JSON.parse(sessionStorage.getItem('meta_oauth') || 'null'); sessionStorage.removeItem('meta_oauth'); } catch (e) { /* nada */ }
    if (!pend) return false;
    alvo.innerHTML = '<p class="iv-carregando">Concluindo a conexão com a Meta…</p>';
    if (pend.error) avisar('A Meta não autorizou: ' + pend.error);
    else {
      try {
        const r = await funcao({ acao: 'conectar', code: pend.code, state: pend.state, redirect_uri: location.origin + '/meta-retorno.html' });
        avisar(`Conectado: ${r.pagina}${r.instagram ? ' e @' + r.instagram : ''}.` + (r.permissoes_faltando && r.permissoes_faltando.length ? ' Faltaram permissões: ' + r.permissoes_faltando.join(', ') : ''));
      } catch (e) { avisar('Não conectou: ' + e.message); }
    }
    statusCache = null; await configurar(alvo); return true;
  }

  // ══════════════════════════ MONTAGEM ════════════════════════════════
  async function montar(destino, sub) {
    const alvo = document.createElement('div');
    destino.replaceChildren(alvo);
    alvo.addEventListener('click', ev => {
      const b = ev.target.closest('[data-ir-sub], [data-novo], [data-abrir]');
      if (!b) return;
      if (b.dataset.irSub) Plataforma.irPara('redes', b.dataset.irSub);
      else if (b.dataset.novo !== undefined) { editId = null; novoEm = b.dataset.novo || null; Plataforma.irPara('redes', 'post'); }
      else if (b.dataset.abrir) { editId = b.dataset.abrir; Plataforma.irPara('redes', 'post'); }
    });
    alvo.innerHTML = '<p class="iv-carregando">Carregando…</p>';
    await carregarBase();
    if (await concluirConexao(alvo)) return;
    const pagina = sub || 'calendario';
    if (pagina === 'post') return editor(alvo);
    if (pagina === 'resultados') return resultados(alvo);
    if (pagina === 'configurar') return configurar(alvo);
    if (pagina === 'novo') { editId = null; novoEm = null; return editor(alvo); }
    return calendario(alvo);
  }

  Plataforma.registrar('redes', { titulo: 'Redes sociais', montar });
})();
