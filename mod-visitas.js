// ══════════════════════════════════════════════════════════════════════
// MÓDULO: INTELIGÊNCIA DO SITE
//
// Quem visitou maysimoveis.com, de onde veio, o que viu e se chamou no
// WhatsApp. A coleta é o script de medição do gerar.py; os números chegam
// prontos da função painel_visitas (sql/54). O banco agrega porque o
// PostgREST corta em 1.000 linhas, e o painel não pode depender do tamanho
// do tráfego.
//
// Ordem da tela: o que responde "está funcionando?" em cima (números e
// contatos), o detalhe embaixo. Contato é o que interessa: visita sem
// contato é vitrine, visita com contato é lead.
// ══════════════════════════════════════════════════════════════════════
(() => {
  'use strict';
  const { db, esc } = Plataforma;

  const SITE = 'https://maysimoveis.com';
  const PERIODOS = [[1, 'Hoje'], [7, '7 dias'], [30, '30 dias'], [90, '90 dias']];

  // O que cada origem quer dizer, na língua de quem lê o painel
  const EXPLICA = {
    'Google orgânico': 'Pesquisou no Google e clicou no resultado, sem anúncio.',
    'Google Ads': 'Clicou num anúncio do Google.',
    'Meta Ads': 'Clicou num anúncio do Instagram ou do Facebook.',
    'Instagram': 'Link da bio, stories ou post do Instagram.',
    'Facebook': 'Link de post ou página do Facebook.',
    'Instagram ou Facebook': 'Veio de um app do Meta sem dizer se foi anúncio ou post. Marque os anúncios com utm (ver rodapé).',
    'WhatsApp': 'Link com utm_source=whatsapp. Link sem marcação que passa pelo WhatsApp chega como Direto.',
    'E-mail': 'Link de e-mail marcado com utm.',
    'Direto': 'Digitou o endereço, usou favorito ou abriu um link sem origem, como os mandados pelo WhatsApp.',
    'Outros buscadores': 'Bing, DuckDuckGo, Yahoo e parecidos.',
    'Assistentes de IA': 'ChatGPT, Gemini, Perplexity ou Copilot indicaram o site.',
    'Outras redes': 'LinkedIn, YouTube, TikTok, X ou Pinterest.',
    'Outros sites': 'Outro site com link para o seu.',
    'Outros anúncios': 'Anúncio marcado com utm que não é do Google nem do Meta.',
  };

  let dias = 30;
  try { dias = Number(localStorage.getItem('plat_visitas_dias')) || 30; } catch (e) { /* padrão */ }
  let dados = null, grupoPag = 'Todas', alvoEl = null;

  const num = n => Number(n || 0).toLocaleString('pt-BR');
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const diaLocal = iso => { const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(a, m - 1, d); };
  const diaCurto = iso => diaLocal(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const diaLongo = iso => diaLocal(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const chamaram = n => n === 1 ? '1 chamou' : `${num(n)} chamaram`;
  const semSufixo = t => String(t || '').replace(/\s*[·|]\s*Maysonnave Im[oó]veis\s*$/i, '');

  function quando(iso) {
    const d = new Date(iso), hoje = new Date();
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
    if (d.toDateString() === hoje.toDateString()) return `hoje ${hora}`;
    if (d.toDateString() === ontem.toDateString()) return `ontem ${hora}`;
    return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
  }

  function duracao(seg, paginas) {
    if (paginas <= 1 && seg < 10) return 'só a entrada';
    if (seg < 60) return `${seg} s`;
    const m = Math.floor(seg / 60), s = seg % 60;
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min${s ? ` ${s} s` : ''}`;
  }

  // Variação contra o período anterior de mesmo tamanho
  function variacao(agora, antes) {
    if (!antes) return agora ? '<span class="iv-var">sem base anterior</span>' : '';
    const v = Math.round((agora - antes) / antes * 100);
    if (v === 0) return '<span class="iv-var">igual ao período anterior</span>';
    const sobe = v > 0;
    return `<span class="iv-var ${sobe ? 'iv-sobe' : 'iv-desce'}">${sobe ? '▲' : '▼'} ${Math.abs(v)}% vs. período anterior</span>`;
  }

  // ── Gráfico de colunas, uma série só ──────────────────────────────────
  function tetoBonito(v) {
    if (v <= 4) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  function desenharColunas(el, pontos, rotuloX, rotuloTip) {
    const W = Math.max(280, el.clientWidth || 600), H = 190;
    const esq = 34, dir = 8, topo = 18, base = 24;
    const pw = W - esq - dir, ph = H - topo - base;
    const maior = Math.max(0, ...pontos.map(p => p.visitas));
    const teto = tetoBonito(maior);
    const faixa = pw / pontos.length;
    const larg = Math.max(2, Math.min(24, faixa * 0.72));
    const y = v => topo + ph - v / teto * ph;
    const idxMaior = maior ? pontos.findIndex(p => p.visitas === maior) : -1;

    // Poucos rótulos no eixo x: o primeiro, o último e alguns no meio
    const passo = Math.max(1, Math.ceil(pontos.length / 6));
    const mostraX = i => i === 0 || i === pontos.length - 1 || (i % passo === 0 && pontos.length - 1 - i >= passo / 2);

    let svg = `<svg class="iv-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Visitas por período">`;
    [0, teto / 2, teto].forEach(t => {
      svg += `<line class="iv-grade" x1="${esq}" x2="${W - dir}" y1="${y(t)}" y2="${y(t)}"/>`
          +  `<text class="iv-eixo" x="${esq - 6}" y="${y(t) + 4}" text-anchor="end">${num(t)}</text>`;
    });
    pontos.forEach((p, i) => {
      const cx = esq + faixa * i + faixa / 2, x = cx - larg / 2;
      if (p.visitas > 0) {
        const h = Math.max(1.5, ph * p.visitas / teto), r = Math.min(4, larg / 2, h);
        const yt = topo + ph - h, yb = topo + ph;
        svg += `<path class="iv-barra" data-i="${i}" d="M${x},${yb} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + larg - r} Q${x + larg},${yt} ${x + larg},${yt + r} V${yb} Z"/>`;
      }
      if (i === idxMaior) svg += `<text class="iv-rotulo-max" x="${cx}" y="${y(p.visitas) - 5}" text-anchor="middle">${num(p.visitas)}</text>`;
      if (mostraX(i)) svg += `<text class="iv-eixo" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(rotuloX(p))}</text>`;
      // Área de toque maior que a barra, da altura toda
      svg += `<rect class="iv-alvo" data-i="${i}" x="${esq + faixa * i}" y="${topo}" width="${faixa}" height="${ph}"/>`;
    });
    svg += `<line class="iv-base" x1="${esq}" x2="${W - dir}" y1="${topo + ph}" y2="${topo + ph}"/></svg>`;

    el.innerHTML = svg + '<div class="iv-tip" hidden></div>';
    const tip = el.querySelector('.iv-tip');
    const mostrar = alvo => {
      const i = Number(alvo.dataset.i), p = pontos[i];
      el.querySelectorAll('.iv-barra').forEach(b => b.classList.toggle('iv-apagada', b.dataset.i !== String(i)));
      tip.innerHTML = rotuloTip(p);
      tip.hidden = false;
      // Ao lado da coluna, nunca em cima dela; vira para a esquerda perto da borda
      const svgEl = el.querySelector('svg'), escala = svgEl.getBoundingClientRect().width / W;
      const margem = svgEl.getBoundingClientRect().left - el.getBoundingClientRect().left;
      const cx = margem + (esq + faixa * i + faixa / 2) * escala, folga = larg * escala / 2 + 10;
      const lado = cx + folga + tip.offsetWidth > el.clientWidth ? cx - folga - tip.offsetWidth : cx + folga;
      tip.style.left = Math.max(4, lado) + 'px';
    };
    const esconder = () => { tip.hidden = true; el.querySelectorAll('.iv-apagada').forEach(b => b.classList.remove('iv-apagada')); };
    el.querySelectorAll('.iv-alvo').forEach(a => {
      a.addEventListener('mouseenter', () => mostrar(a));
      a.addEventListener('click', () => mostrar(a));
    });
    el.querySelector('svg').addEventListener('mouseleave', esconder);
  }

  function grafico() {
    const el = alvoEl && alvoEl.querySelector('#ivGrafico');
    if (!el || !dados) return;
    const tip = p => `<b>${p.visitas === 1 ? '1 visita' : `${num(p.visitas)} visitas`}</b>`
      + `<span>${num(p.paginas)} páginas vistas</span>`
      + (p.contatos ? `<span class="iv-tip-contato">${num(p.contatos)} contato${p.contatos > 1 ? 's' : ''}</span>` : '');
    if (dados.dias === 1 && dados.por_hora)
      desenharColunas(el, dados.por_hora, p => `${p.hora}h`, p => `<em>${p.hora}h às ${p.hora}h59</em>` + tip(p));
    else
      desenharColunas(el, dados.por_dia, p => diaCurto(p.dia), p => `<em>${diaLongo(p.dia)}</em>` + tip(p));
  }

  // ── Blocos ────────────────────────────────────────────────────────────
  function blocoOrigens(origens, totalVisitas) {
    if (!origens.length) return '<p class="iv-vazio-p">Nenhuma visita no período.</p>';
    const maior = Math.max(...origens.map(o => o.visitas), 1);
    return `<div class="iv-origens">${origens.map(o => `
      <div class="iv-origem">
        <div class="iv-origem-nome" title="${esc(EXPLICA[o.origem] || '')}">${esc(o.origem)}</div>
        <div class="iv-trilho"><span style="width:${Math.max(2, o.visitas / maior * 100)}%"></span></div>
        <div class="iv-origem-num"><b>${num(o.visitas)}</b><em>${pct(o.visitas, totalVisitas)}%</em></div>
        <div class="iv-origem-contato${o.com_contato ? ' tem' : ''}">${o.com_contato
          ? `${chamaram(o.com_contato)} · ${pct(o.com_contato, o.visitas)}%` : 'nenhum contato'}</div>
      </div>`).join('')}</div>`;
  }

  function blocoPaginas(paginas) {
    const grupos = ['Todas', ...new Set(paginas.map(p => p.grupo))];
    if (!grupos.includes(grupoPag)) grupoPag = 'Todas';
    const lista = paginas.filter(p => grupoPag === 'Todas' || p.grupo === grupoPag);
    const maior = Math.max(...lista.map(p => p.visualizacoes), 1);
    const filtros = grupos.length > 2 ? `<div class="iv-filtros" role="group" aria-label="Filtrar páginas">${grupos.map(g =>
      `<button type="button" class="iv-filtro${g === grupoPag ? ' ativo' : ''}" data-grupo="${esc(g)}">${esc(g)}</button>`).join('')}</div>` : '';
    if (!lista.length) return filtros + '<p class="iv-vazio-p">Nenhuma página vista no período.</p>';
    return filtros + `
      <div class="cad-tabela-scroll"><table class="cad-tabela iv-tabela">
        <thead><tr><th>Página</th><th>Tipo</th><th class="iv-dir">Vistas</th><th class="iv-dir">Pessoas</th><th class="iv-dir">Contatos</th></tr></thead>
        <tbody>${lista.map(p => `
          <tr>
            <td class="iv-pag"><a href="${SITE}${esc(p.caminho)}" target="_blank" rel="noopener">${esc(semSufixo(p.nome) || p.caminho)}</a>
              <span class="iv-trilho iv-trilho-fino"><span style="width:${Math.max(2, p.visualizacoes / maior * 100)}%"></span></span></td>
            <td><span class="cad-fin">${esc(p.grupo)}</span></td>
            <td class="iv-dir iv-n">${num(p.visualizacoes)}</td>
            <td class="iv-dir iv-n">${num(p.visitantes)}</td>
            <td class="iv-dir iv-n${p.contatos ? ' iv-contato' : ''}">${p.contatos ? num(p.contatos) : '·'}</td>
          </tr>`).join('')}</tbody>
      </table></div>`;
  }

  function blocoUltimas(ultimas) {
    if (!ultimas.length) return '<p class="iv-vazio-p">Nenhuma visita no período.</p>';
    return `<div class="cad-tabela-scroll"><table class="cad-tabela iv-tabela">
      <thead><tr><th>Quando</th><th>Veio de</th><th>Entrou por</th><th class="iv-dir">Páginas</th><th>Tempo</th><th>Aparelho</th><th>Contato</th></tr></thead>
      <tbody>${ultimas.map(u => `
        <tr>
          <td class="iv-n" style="white-space:nowrap">${esc(quando(u.inicio))}</td>
          <td>${esc(u.origem)}${u.detalhe ? `<div class="cad-end-sub">${esc(u.detalhe)}</div>` : ''}</td>
          <td class="iv-pag"><a href="${SITE}${esc(u.entrada || '/')}" target="_blank" rel="noopener">${esc(semSufixo(u.entrada_nome) || u.entrada || '')}</a></td>
          <td class="iv-dir iv-n">${num(u.paginas)}</td>
          <td style="white-space:nowrap">${esc(duracao(u.segundos || 0, u.paginas))}</td>
          <td>${esc(u.dispositivo || '')}</td>
          <td>${u.contatos ? '<span class="iv-chamou">✓ Chamou</span>' : '<span class="iv-apagado">·</span>'}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  }

  function blocoLateral(d) {
    const disp = d.dispositivos || {}, totalDisp = Object.values(disp).reduce((s, n) => s + n, 0);
    const aparelhos = [['celular', 'Celular'], ['computador', 'Computador'], ['tablet', 'Tablet']]
      .filter(([k]) => disp[k]).map(([k, r]) => `<div class="iv-mini"><b>${pct(disp[k], totalDisp)}%</b><span>${r}</span></div>`).join('');
    const campanhas = d.campanhas.length ? `
      <h4>Campanhas marcadas com utm</h4>
      <ul class="iv-lista">${d.campanhas.map(c => `<li><span>${esc(c.campanha)}<small>${esc(c.origem)}</small></span>
        <b>${num(c.visitas)}</b><em>${c.com_contato ? chamaram(c.com_contato) : 'sem contato'}</em></li>`).join('')}</ul>` : '';
    const sites = d.sites.length ? `
      <h4>Sites que mandaram visita</h4>
      <ul class="iv-lista">${d.sites.map(s => `<li><span>${esc(s.site)}</span><b>${num(s.visitas)}</b></li>`).join('')}</ul>` : '';
    return `<h4>Aparelho</h4><div class="iv-minis">${aparelhos || '<span class="iv-vazio-p">Sem visitas.</span>'}</div>${campanhas}${sites}`;
  }

  function ajuda() {
    const link = `${SITE}/?nao-contar`;
    return `
      <section class="ficha-secao iv-ajuda">
        <div class="ficha-secao-topo"><h3>Para os números ficarem certos</h3></div>
        <div class="iv-ajuda-corpo">
          <div><b>Não conte as suas próprias visitas.</b> Abra este endereço uma vez em cada aparelho seu
            (celular, computador, e no navegador de cada um):
            <div class="iv-copiar"><code id="ivLinkNaoContar">${esc(link)}</code>
              <button type="button" class="btn btn-mini" id="ivCopiar">Copiar</button></div>
            O aparelho some do painel dali em diante. Para voltar a contar, abra <code>${esc(SITE)}/?contar</code>.</div>
          <div><b>Marque os anúncios.</b> Nos anúncios do Meta que levam ao site, preencha "Parâmetros de URL" com
            <code>utm_source=instagram&amp;utm_medium=paid&amp;utm_campaign=NOME</code>. Sem isso o Instagram manda a mesma
            informação para post e para anúncio, e a visita cai em "Instagram ou Facebook". No Google Ads a marcação é automática.</div>
          <div><b>Links que você manda no WhatsApp</b> chegam como "Direto", porque o WhatsApp não diz de onde o clique veio.
            Para separar, acrescente <code>?utm_source=whatsapp</code> ao link.</div>
        </div>
      </section>`;
  }

  // ── Montagem ──────────────────────────────────────────────────────────
  function render() {
    const d = dados, r = d.resumo;
    const contatos = r.whatsapp + r.formularios + r.telefone;
    const partesContato = [r.whatsapp && `${num(r.whatsapp)} WhatsApp`, r.formularios && `${num(r.formularios)} formulário`,
                           r.telefone && `${num(r.telefone)} telefone`].filter(Boolean).join(' · ');
    const periodo = d.dias === 1 ? 'hoje' : `de ${diaCurto(d.de)} a ${diaCurto(d.ate)}`;
    const nuncaMediu = !d.primeira_visita;

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Inteligência do site</h2>
          <div class="secao-meta">Quem visitou maysimoveis.com, de onde veio, o que viu e se chamou. Período: ${esc(periodo)}.</div></div>
        </div>
        <div class="secao-acoes iv-periodos" role="group" aria-label="Período">${PERIODOS.map(([n, r]) =>
          `<button type="button" class="iv-periodo${n === d.dias ? ' ativo' : ''}" data-dias="${n}" aria-pressed="${n === d.dias}">${r}</button>`).join('')}
          <button type="button" class="btn btn-mini btn-fantasma" id="ivAtualizar" title="Buscar de novo">↻ Atualizar</button>
        </div>
      </div>

      ${nuncaMediu ? `
      <div class="iv-aviso">
        <b>A medição ainda não recebeu nenhuma visita.</b>
        As visitas aparecem aqui assim que o site for publicado com o script de medição. Depois disso, cada página vista
        e cada clique no WhatsApp entram em segundos.
      </div>` : ''}

      <div class="painel-numeros iv-numeros">
        <div class="num"><span class="num-v">${num(r.visitas)}</span><span class="num-r">Visitas</span>${variacao(r.visitas, r.ant_visitas)}</div>
        <div class="num"><span class="num-v">${num(r.visitantes)}</span><span class="num-r">Pessoas diferentes</span>${variacao(r.visitantes, r.ant_visitantes)}</div>
        <div class="num"><span class="num-v">${num(r.paginas)}</span><span class="num-r">Páginas vistas</span>${variacao(r.paginas, r.ant_paginas)}</div>
        <div class="num${contatos ? ' num-destaque' : ''}"><span class="num-v">${num(contatos)}</span><span class="num-r">Contatos pelo site</span>
          ${partesContato ? `<span class="iv-var">${esc(partesContato)}</span>` : variacao(contatos, r.ant_contatos)}</div>
        <div class="num"><span class="num-v">${pct(r.visitas_com_contato, r.visitas)}%</span><span class="num-r">Visitas que viraram contato</span>
          <span class="iv-var">${num(r.visitas_com_contato)} de ${num(r.visitas)}</span></div>
      </div>

      <section class="ficha-secao iv-bloco">
        <div class="ficha-secao-topo"><h3>${d.dias === 1 ? 'Visitas por hora' : 'Visitas por dia'}</h3>
          <p>Passe o mouse ou toque numa coluna para ver páginas e contatos daquele ${d.dias === 1 ? 'horário' : 'dia'}.</p></div>
        <div class="iv-grafico" id="ivGrafico"></div>
        <details class="iv-tabela-dias"><summary>Ver em tabela</summary>
          <div class="cad-tabela-scroll"><table class="cad-tabela iv-tabela">
            <thead><tr><th>${d.dias === 1 ? 'Hora' : 'Dia'}</th><th class="iv-dir">Visitas</th><th class="iv-dir">Páginas</th><th class="iv-dir">Contatos</th></tr></thead>
            <tbody>${(d.dias === 1 && d.por_hora ? d.por_hora.map(p => ({ ...p, r: `${p.hora}h` }))
                                                  : d.por_dia.map(p => ({ ...p, r: diaLongo(p.dia) }))).slice().reverse().map(p =>
              `<tr><td>${esc(p.r)}</td><td class="iv-dir iv-n">${num(p.visitas)}</td><td class="iv-dir iv-n">${num(p.paginas)}</td><td class="iv-dir iv-n">${num(p.contatos)}</td></tr>`).join('')}</tbody>
          </table></div>
        </details>
      </section>

      <div class="iv-duas">
        <section class="ficha-secao iv-bloco">
          <div class="ficha-secao-topo"><h3>De onde vêm as visitas</h3>
            <p>Barra = quantidade de visitas. À direita, quantas chamaram no WhatsApp, telefone ou formulário.</p></div>
          <div class="iv-corpo">${blocoOrigens(d.por_origem, r.visitas)}</div>
        </section>
        <section class="ficha-secao iv-bloco">
          <div class="ficha-secao-topo"><h3>Perfil</h3></div>
          <div class="iv-corpo iv-lateral">${blocoLateral(d)}</div>
        </section>
      </div>

      <section class="ficha-secao iv-bloco">
        <div class="ficha-secao-topo"><h3>Páginas mais vistas</h3>
          <p>O nome vem do cadastro: dois imóveis do mesmo condomínio aparecem separados pelo código.</p></div>
        <div class="iv-corpo" id="ivPaginas">${blocoPaginas(d.paginas)}</div>
      </section>

      <section class="ficha-secao iv-bloco">
        <div class="ficha-secao-topo"><h3>Últimas visitas</h3>
          <p>As 30 mais recentes do período. Cada linha é uma pessoa navegando, do começo ao fim da visita.</p></div>
        <div class="iv-corpo">${blocoUltimas(d.ultimas)}</div>
      </section>

      ${ajuda()}`;

    grafico();
    ligar();
  }

  function ligar() {
    alvoEl.querySelectorAll('.iv-periodo').forEach(b => b.addEventListener('click', () => {
      dias = Number(b.dataset.dias);
      try { localStorage.setItem('plat_visitas_dias', String(dias)); } catch (e) { /* tudo bem */ }
      carregar();
    }));
    alvoEl.querySelector('#ivAtualizar').addEventListener('click', carregar);
    alvoEl.querySelector('#ivPaginas').addEventListener('click', ev => {
      const b = ev.target.closest('.iv-filtro');
      if (!b) return;
      grupoPag = b.dataset.grupo;
      alvoEl.querySelector('#ivPaginas').innerHTML = blocoPaginas(dados.paginas);
    });
    const copiar = alvoEl.querySelector('#ivCopiar');
    copiar.addEventListener('click', async () => {
      const texto = alvoEl.querySelector('#ivLinkNaoContar').textContent;
      try { await navigator.clipboard.writeText(texto); Plataforma.avisar('Link copiado.'); }
      catch (e) {
        const faixa = document.createRange(); faixa.selectNodeContents(alvoEl.querySelector('#ivLinkNaoContar'));
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(faixa);
      }
    });
  }

  async function carregar() {
    if (!alvoEl) return;
    alvoEl.querySelectorAll('.iv-periodo, #ivAtualizar').forEach(b => { b.disabled = true; });
    dados = await db(supabaseClient.rpc('painel_visitas', { p_dias: dias }), 'carregar as visitas do site');
    if (alvoEl && alvoEl.isConnected) render();
  }

  let redimensiona = null;
  window.addEventListener('resize', () => {
    clearTimeout(redimensiona);
    redimensiona = setTimeout(() => { if (alvoEl && alvoEl.isConnected) grafico(); }, 150);
  });

  async function montar(alvo) {
    alvoEl = alvo;
    const eu = Plataforma.perfil;
    if (!eu || eu.papel !== 'admin') {
      alvo.innerHTML = `
        <div class="vazio"><div class="vazio-ico">◎</div>
          <h3>Só administrador vê a inteligência do site</h3>
          <p>São dados de tráfego e de campanha da imobiliária.</p></div>`;
      return;
    }
    alvo.innerHTML = '<p class="iv-carregando">Carregando as visitas…</p>';
    await carregar();
  }

  Plataforma.registrar('visitas', { titulo: 'Inteligência do site', montar });
})();
