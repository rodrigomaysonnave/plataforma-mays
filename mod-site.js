// ══════════════════════════════════════════════════════════════════════
// MÓDULO: SITE E PORTAIS
//
// O que está publicado, o que está pronto para publicar, e o que impede.
//
// O gerador do site em si é um script à parte, que lê deste banco e produz
// HTML estático. Este módulo é o painel de controle dele: mostra o estado,
// deixa publicar e despublicar em massa, e entrega o feed XML dos portais.
//
// Por que estático e não página montada no navegador: a vitrine é destino de
// tráfego pago, e HTML pronto carrega em 1,8s contra 5,4s do site atual dele.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  let alvoEl = null;

  const brl = v => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  function motivoNaoPublica(i) {
    if (i.rascunho)            return 'rascunho';
    if (i.divulgacao_restrita) return 'divulgação restrita';
    if (!i.valor)              return 'sem valor';
    if (!i.titulo)             return 'sem título';
    if (!i.temFoto)            return 'sem foto';
    return null;
  }

  let vistaAtual = 'publicacao';

  async function montar(alvo, sub) {
    alvoEl = alvo;
    if (sub) vistaAtual = sub;
    if (vistaAtual === 'midia')   return montarSoMidia(alvo);
    if (vistaAtual === 'portais') return montarPortais(alvo);
    if (vistaAtual === 'seo')     return montarSeo(alvo);
    const [imoveis, fotos, cfg] = await Promise.all([
      db(supabaseClient.from('imovel').select('*').order('codigo'), 'carregar imóveis'),
      db(supabaseClient.from('imovel_foto').select('imovel_id'), 'carregar fotos'),
      db(supabaseClient.from('configuracao').select('site_url').limit(1), 'carregar configuração'),
    ]);
    const comFoto = new Set(fotos.map(f => f.imovel_id));
    imoveis.forEach(i => { i.temFoto = comFoto.has(i.id); });

    const publicados = imoveis.filter(i => i.publicar_no_site);
    const prontos    = imoveis.filter(i => !i.publicar_no_site && !motivoNaoPublica(i));
    const travados   = imoveis.filter(i => !i.publicar_no_site && motivoNaoPublica(i));
    const siteUrl    = (cfg[0] || {}).site_url;

    const linha = (i, acao) => `
      <tr class="cad-linha" data-id="${i.id}">
        <td class="cad-codigo">${esc(i.codigo || '—')}</td>
        <td><div class="cad-end-rua">${esc(i.titulo || i.endereco || 'sem título')}</div>
            <div class="cad-end-sub">${esc(i.slug || 'sem endereço de página')}</div></td>
        <td class="cad-valor">${brl(i.valor)}</td>
        <td>${i.temFoto ? '<span class="cad-selo cad-selo-vitrine">com foto</span>'
                        : '<span class="cad-selo cad-selo-restrito">sem foto</span>'}</td>
        <td>${acao === 'tirar'
          ? `<button class="btn btn-mini" data-acao="tirar">Tirar do site</button>`
          : acao === 'por'
          ? `<button class="btn btn-mini btn-primario" data-acao="por">Publicar</button>`
          : `<span class="cad-vazio">${esc(motivoNaoPublica(i))}</span>`}</td>
      </tr>`;

    const tabela = (titulo, itens, vazio, acao) => `
      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>${esc(titulo)}<span class="ini-conta">${itens.length}</span></h3></div>
        ${itens.length ? `<div class="cad-tabela-scroll" style="border:none;border-radius:0">
          <table class="cad-tabela"><tbody>${itens.map(i => linha(i, acao)).join('')}</tbody></table></div>`
          : `<p class="ini-vazio" style="padding:18px 20px">${esc(vazio)}</p>`}
      </section>`;

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Site e portais</h2>
          <div class="secao-meta">${siteUrl
            ? `Publicando em ${esc(siteUrl)}`
            : 'Endereço do site ainda não configurado. Configurações → Ajustes gerais.'}</div></div>
        </div>
        <div class="secao-acoes">
          <button class="btn" id="siteFeed">Baixar feed XML</button>
          ${siteUrl ? `<a class="btn" href="${esc(siteUrl)}" target="_blank" rel="noopener">Abrir o site ↗</a>` : ''}
        </div>
      </div>

      <div class="painel-numeros">
        <div class="num"><span class="num-v">${publicados.length}</span><span class="num-r">No site</span></div>
        <div class="num${prontos.length ? ' num-destaque' : ''}"><span class="num-v">${prontos.length}</span><span class="num-r">Prontos para publicar</span></div>
        <div class="num${travados.length ? ' num-alerta' : ''}"><span class="num-v">${travados.length}</span><span class="num-r">Falta alguma coisa</span></div>
      </div>

      ${tabela('No site agora', publicados, 'Nenhum imóvel publicado ainda.', 'tirar')}
      ${tabela('Prontos para publicar', prontos, 'Nada pronto no momento.', 'por')}
      ${tabela('Falta alguma coisa', travados, 'Nenhum imóvel travado.', null)}

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Como o site é gerado</h3>
          <p>O site é HTML estático, gerado deste banco por um script e publicado
             com HTTPS gratuito. Não é página montada no navegador: a vitrine é
             destino de tráfego pago, e página pronta carrega em 1,8 segundo
             contra 5,4 do site atual.</p></div>
        <div style="padding:18px 20px">
          <p class="campo-dica">O gerador e a publicação automática entram na
          próxima etapa. Este painel já controla o que entra e o que sai, e o
          feed XML dos portais já pode ser baixado.</p>
        </div>
      </div>`;

    // A linha inteira abre o imóvel. Antes ela tinha aparência de clicável e
    // não fazia nada: quem via "sem foto" não tinha como ir lá resolver sem
    // procurar o imóvel na outra tela.
    alvo.querySelectorAll('.cad-linha').forEach(tr => {
      tr.addEventListener('click', () => Plataforma.irPara('imoveis', tr.dataset.id));
    });

    alvo.querySelectorAll('[data-acao]').forEach(b => {
      b.addEventListener('click', async e => {
        e.stopPropagation();
        const id = b.closest('.cad-linha').dataset.id;
        const por = b.dataset.acao === 'por';
        await db(supabaseClient.from('imovel').update({ publicar_no_site: por }).eq('id', id),
                 por ? 'publicar' : 'tirar do site');
        avisar(por ? 'Publicado no site.' : 'Tirado do site.');
        await montar(alvoEl);
      });
    });

    document.getElementById('siteFeed').addEventListener('click', () => gerarFeed(publicados));
  }

  // ── Vídeos e reels na home ─────────────────────────────────────────
  // Ele produz vídeo (Imobflix, Expresso, drone) e esse material morre no
  // Instagram e no YouTube sem trazer ninguém pro site. Aqui vira seção.
  const TIPOS = [
    { tipo: 'video', titulo: 'Vídeos do YouTube',
      dica: 'Cole o endereço do vídeo. A capa é baixada do YouTube na geração do site, então não fica pedindo imagem pra fora.',
      ph: 'https://www.youtube.com/watch?v=…' },
    { tipo: 'reel', titulo: 'Reels do Instagram',
      dica: 'O Instagram não entrega miniatura sem API, então aqui a capa é opcional: sem ela o cartão usa um fundo da marca.',
      ph: 'https://www.instagram.com/reel/…' },
  ];

  // Vista "SEO e medição": o que o Google lê da home, e as ferramentas.
  async function montarSeo(alvo) {
    const linhas = await db(supabaseClient.from('configuracao').select('*').limit(1), 'carregar configuração');
    const c = linhas[0] || {};
    const nome = c.nome_imobiliaria || 'Maysonnave Imóveis';
    const sugTitulo = `${nome} · Imóveis em ${c.cidade_padrao || 'Pelotas'}/${c.estado_padrao || 'RS'}`;
    const sugDesc = `Compra, venda e avaliação de imóveis em ${c.cidade_padrao || 'Pelotas'} e região, `
      + `com laudo de perito avaliador. ${c.creci || ''}`.trim();

    const campo = (id, rot, val, ph, dica, largo) => `
      <div class="campo${largo ? ' campo-largo' : ''}">
        <label for="${id}">${rot}</label>
        <input type="text" id="${id}" value="${esc(val ?? '')}" placeholder="${esc(ph || '')}">
        ${dica ? `<p class="campo-dica">${dica}</p>` : ''}
      </div>`;

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>SEO e medição</h2>
          <div class="secao-meta">O que o Google lê da página inicial, e quais ferramentas
            acompanham o site.</div></div>
        </div>
        <div class="secao-acoes"><button class="btn btn-primario" id="seoSalvar">Salvar</button></div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>A página inicial na busca</h3>
          <p>Deixe em branco para usar o texto automático. Assim nenhuma página fica sem
             resumo, que é o defeito do site atual dele.</p></div>
        <div class="ficha-grade">
          ${campo('seoTitulo', 'Título na busca', c.site_titulo, sugTitulo, 'Até 60 caracteres. Cidade e nicho valem mais que nome bonito.', true)}
          <div class="campo campo-largo"><label for="seoDesc">Resumo na busca</label>
            <textarea id="seoDesc" rows="2" placeholder="${esc(sugDesc)}">${esc(c.site_descricao ?? '')}</textarea>
            <p class="campo-dica">Até 158 caracteres.</p></div>
          ${campo('seoImagem', 'Imagem ao compartilhar', c.site_imagem, 'https://…', 'Aparece no WhatsApp e nas redes. Vazio usa a foto do primeiro imóvel.', true)}
          <div class="seo-previa campo-largo" id="seoPreviaSite"></div>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Redes sociais</h3>
          <p>Viram links no rodapé e entram nos dados estruturados, que é como o Google
             liga o site aos teus perfis.</p></div>
        <div class="ficha-grade">
          ${campo('seoInsta', 'Instagram', c.instagram, 'https://www.instagram.com/…')}
          ${campo('seoYt', 'YouTube', c.youtube, 'https://www.youtube.com/@…')}
          ${campo('seoFb', 'Facebook', c.facebook, 'https://www.facebook.com/…')}
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Ferramentas do Google e da Meta</h3>
          <p>Cada uma que você liga adiciona uma requisição a domínio externo em toda visita.
             Hoje o site marca 98 de performance justamente por não pedir nada pra fora.</p></div>
        <div class="ficha-grade">
          ${campo('seoSearch', 'Search Console (verificação)', c.search_console, 'abc123…',
             '<strong>Sem custo de desempenho:</strong> é só uma meta tag. É aqui que você vê que busca traz gente. Comece por este.', true)}
          ${campo('seoGa4', 'Google Analytics 4', c.ga4_id, 'G-XXXXXXXXXX',
             'Custa uma requisição externa. Se você só quer saber quantas visitas e de onde, o Search Console já responde.', true)}
          ${campo('seoGtm', 'Gerenciador de Tags', c.gtm_id, 'GTM-XXXXXXX',
             'Só faz sentido se for usar várias ferramentas. Sozinho, é peso sem retorno.', true)}
          ${campo('seoPixel', 'Pixel da Meta', c.meta_pixel, '000000000000000',
             'Necessário para remarketing no Instagram e Facebook. Se você anuncia, vale o custo.', true)}
        </div>
        <div style="padding:0 20px 18px">
          <p class="campo-dica">Nenhum é obrigatório. Vazio significa que o site não carrega
          aquilo, e a página segue sem pedir nada a domínio externo.</p>
        </div>
      </div>`;

    function previa() {
      const t = document.getElementById('seoTitulo').value.trim() || sugTitulo;
      const d = document.getElementById('seoDesc').value.trim() || sugDesc;
      document.getElementById('seoPreviaSite').innerHTML = `
        <div class="seo-cartao">
          <div class="seo-rot">Como a home fica no Google</div>
          <div class="seo-url-previa">${esc((c.site_url || 'maysimoveis.com').replace(/^https?:\/\//, ''))}</div>
          <div class="seo-titulo-previa">${esc(t)}</div>
          <div class="seo-desc-previa">${esc(d)}</div>
          <div class="seo-conta">${t.length}/60 no título · ${d.length}/158 no resumo</div>
        </div>`;
    }
    ['seoTitulo','seoDesc'].forEach(i => document.getElementById(i).addEventListener('input', previa));
    previa();

    document.getElementById('seoSalvar').addEventListener('click', async () => {
      const v = i => document.getElementById(i).value.trim() || null;
      await db(supabaseClient.from('configuracao').update({
        site_titulo: v('seoTitulo'), site_descricao: v('seoDesc'), site_imagem: v('seoImagem'),
        instagram: v('seoInsta'), youtube: v('seoYt'), facebook: v('seoFb'),
        search_console: v('seoSearch'), ga4_id: v('seoGa4'),
        gtm_id: v('seoGtm'), meta_pixel: v('seoPixel'),
      }).eq('id', true), 'salvar');
      avisar('Salvo. Gere o site de novo para aplicar.');
    });
  }

  // Vista "Reels e vídeos": só as duas listas, com título próprio.
  async function montarSoMidia(alvo) {
    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Reels e vídeos</h2>
          <div class="secao-meta">Cole o endereço e arraste pela alça para mudar a ordem
            em que aparecem na home.</div></div>
        </div>
      </div>`;
    await montarMidia();
  }

  // Vista "Portais": o feed que alimenta ZAP, Viva Real e OLX.
  async function montarPortais(alvo) {
    const imoveis = await db(supabaseClient.from('imovel').select('*')
      .eq('publicar_no_site', true).eq('rascunho', false).order('codigo'), 'carregar imóveis');
    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Portais</h2>
          <div class="secao-meta">Um arquivo, três portais: o formato VrSync do Grupo OLX
            vale para ZAP, Viva Real e OLX desde outubro de 2024.</div></div>
        </div>
        <div class="secao-acoes">
          <button class="btn btn-primario" id="portalFeed">Baixar feed XML</button>
        </div>
      </div>
      <div class="painel-numeros">
        <div class="num"><span class="num-v">${imoveis.length}</span><span class="num-r">Imóveis no feed</span></div>
      </div>
      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Como funciona</h3>
          <p>O feed sai do mesmo cadastro do site: nada é digitado duas vezes. Você entrega
             o endereço do arquivo ao portal e ele passa a ler sozinho.</p></div>
        <div style="padding:18px 20px">
          <p class="campo-dica">A publicação automática do arquivo entra junto com a
          publicação do site. Por enquanto o download serve para enviar manualmente.</p>
        </div>
      </div>`;
    document.getElementById('portalFeed').addEventListener('click', () => gerarFeed(imoveis));
  }

  async function montarMidia() {
    const itens = await db(supabaseClient.from('midia_site').select('*')
      .order('tipo').order('ordem'), 'carregar mídias');

    const bloco = t => {
      const meus = itens.filter(i => i.tipo === t.tipo);
      return `
        <section class="ficha-secao">
          <div class="ficha-secao-topo">
            <h3>${esc(t.titulo)}<span class="ini-conta">${meus.length}</span></h3>
            <p>${esc(t.dica)}</p>
          </div>
          <div class="cfg-novo">
            <input type="text" id="novo_${t.tipo}" placeholder="${esc(t.ph)}">
            <button class="btn btn-primario" data-add="${t.tipo}">Adicionar</button>
          </div>
          ${meus.length ? `<ul class="cfg-itens midia-lista" data-tipo="${t.tipo}">${meus.map((m, i) => `
            <li class="cfg-item midia-item${m.ativo ? '' : ' inativo'}" data-id="${m.id}">
              <span class="midia-alca" title="Arraste para mudar a ordem">⠿</span>
              <span class="midia-mini">${m.video_url
                  ? `<video src="${esc(m.video_url)}" muted preload="metadata"></video>`
                  : m.capa_url ? `<img src="${esc(m.capa_url)}" alt="">`
                  : '<span class="midia-vazia">sem<br>arquivo</span>'}</span>
              <span class="cfg-item-nome">
                <input type="text" value="${esc(m.titulo || '')}" data-campo="titulo"
                       placeholder="Título (opcional)" aria-label="Título">
                <p class="campo-dica" style="margin-top:4px">${esc(m.url)}</p>
              </span>
              <span class="cfg-item-acoes">
                ${t.tipo === 'reel' ? `<label class="btn btn-mini" title="Enviar o MP4 do reel">
                  ${m.video_url ? 'Trocar vídeo' : 'Enviar vídeo'}
                  <input type="file" accept="video/*" hidden data-video></label>` : ''}
                <button class="btn btn-mini" data-alt>${m.ativo ? 'Ocultar' : 'Mostrar'}</button>
                <button class="btn btn-mini btn-remover" data-del>×</button>
              </span>
            </li>`).join('')}</ul>`
            : '<p class="ini-vazio" style="padding:16px 20px">Nada ainda. A seção não aparece no site enquanto estiver vazia.</p>'}
        </section>`;
    };

    const area = document.createElement('div');
    area.innerHTML = TIPOS.map(bloco).join('');
    alvoEl.appendChild(area);

    area.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', async () => {
      const t = b.dataset.add;
      const campo = document.getElementById('novo_' + t);
      const url = campo.value.trim();
      if (!url) { campo.focus(); return; }
      if (!/^https?:\/\//.test(url)) { avisar('Cole o endereço completo, começando com https.'); return; }
      const meus = itens.filter(i => i.tipo === t);
      await db(supabaseClient.from('midia_site').insert(
        { tipo: t, url, ordem: meus.length }), 'adicionar');
      avisar(t === 'video' ? 'Vídeo adicionado.' : 'Reel adicionado.');
      await montar(alvoEl);
    }));

    area.querySelectorAll('.cfg-item').forEach(li => {
      const id = li.dataset.id;
      const campo = li.querySelector('[data-campo="titulo"]');
      const antes = campo.value;
      campo.addEventListener('blur', async () => {
        if (campo.value.trim() === antes) return;
        await db(supabaseClient.from('midia_site')
          .update({ titulo: campo.value.trim() || null }).eq('id', id), 'renomear');
        avisar('Salvo.');
      });
      li.querySelector('[data-alt]').addEventListener('click', async () => {
        await db(supabaseClient.from('midia_site')
          .update({ ativo: li.classList.contains('inativo') }).eq('id', id), 'alterar');
        await montar(alvoEl);
      });
      li.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Remover do site?')) return;
        await db(supabaseClient.from('midia_site').delete().eq('id', id), 'remover');
        avisar('Removido.');
        await montar(alvoEl);
      });
      const entrada = li.querySelector('[data-video]');
      if (entrada) entrada.addEventListener('change', async ev => {
        const arq = ev.target.files[0];
        if (!arq) return;
        if (arq.size > 50 * 1024 * 1024) {
          avisar('O arquivo passa de 50MB. Exporte o reel em resolução menor.');
          return;
        }
        const rotulo = entrada.closest('label');
        const antes = rotulo.firstChild.textContent;
        rotulo.firstChild.textContent = ' Enviando… ';
        const caminho = `reels/${id}.mp4`;
        const { error } = await supabaseClient.storage.from('midia')
          .upload(caminho, arq, { contentType: arq.type || 'video/mp4', upsert: true,
                                  cacheControl: '31536000' });
        if (error) { avisar('Não subiu: ' + error.message); rotulo.firstChild.textContent = antes; return; }
        const pub = supabaseClient.storage.from('midia').getPublicUrl(caminho).data.publicUrl;
        // Cache do navegador guarda o arquivo antigo pelo mesmo nome, então o
        // endereço leva um carimbo de tempo. Sem isso, trocar o vídeo não
        // mostra o novo.
        await db(supabaseClient.from('midia_site')
          .update({ video_url: pub + '?v=' + Date.now() }).eq('id', id), 'gravar o vídeo');
        avisar('Vídeo enviado.');
        await montar(alvoEl);
      });
    });

    // Arrastar para reordenar. A mecânica toda mora em arrastar.js, que é o
    // mesmo código usado nas listas das Configurações.
    area.querySelectorAll('.midia-lista').forEach(lista => Arrastar.ordenar({
      lista, seletor: '.midia-item', alca: '.midia-alca',
      aoSoltar: async ids => {
        await Promise.all(ids.map((x, i) =>
          db(supabaseClient.from('midia_site').update({ ordem: i }).eq('id', x), 'reordenar')));
        avisar('Ordem salva.');
        await montar(alvoEl);
      },
    }));
  }

  // Feed no formato VrSync, que é o padrão único do Grupo OLX (ZAP, Viva Real
  // e OLX) desde outubro de 2024. Um arquivo, três portais.
  function gerarFeed(imoveis) {
    if (!imoveis.length) { avisar('Nenhum imóvel publicado para enviar aos portais.'); return; }
    const esc2 = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;' }[c]));
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync">
  <Header>
    <Provider>Maysonnave Imóveis</Provider>
    <Email></Email>
    <PublishDate>${new Date().toISOString()}</PublishDate>
  </Header>
  <Listings>
${imoveis.map(i => `    <Listing>
      <ListingID>${esc2(i.codigo)}</ListingID>
      <Title>${esc2(i.titulo || i.endereco)}</Title>
      <TransactionType>${i.finalidade === 'aluguel' ? 'For Rent' : 'For Sale'}</TransactionType>
      <Details>
        <Description>${esc2(i.descricao_publica || i.titulo || '')}</Description>
        ${i.valor ? `<ListPrice currency="BRL">${Math.round(i.valor)}</ListPrice>` : ''}
        ${i.area_util ? `<LivingArea unit="square metres">${Math.round(i.area_util)}</LivingArea>` : ''}
        ${i.area_total ? `<LotArea unit="square metres">${Math.round(i.area_total)}</LotArea>` : ''}
        ${i.dormitorios ? `<Bedrooms>${i.dormitorios}</Bedrooms>` : ''}
        ${i.banheiros ? `<Bathrooms>${i.banheiros}</Bathrooms>` : ''}
        ${i.suites ? `<Suites>${i.suites}</Suites>` : ''}
        ${i.vagas ? `<Garage>${i.vagas}</Garage>` : ''}
      </Details>
      <Location>
        <Country abbreviation="BR">Brasil</Country>
        <State abbreviation="RS">Rio Grande do Sul</State>
        <City>Pelotas</City>
        <Address>${esc2(i.endereco)}</Address>
      </Location>
    </Listing>`).join('\n')}
  </Listings>
</ListingDataFeed>`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    a.download = `feed-portais-${new Date().toISOString().slice(0,10)}.xml`;
    a.click();
    URL.revokeObjectURL(a.href);
    avisar(`Feed gerado com ${imoveis.length} imóvel${imoveis.length===1?'':'is'}.`);
  }

  Plataforma.registrar('site', { titulo: 'Site e portais', montar });
})();
