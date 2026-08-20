// ══════════════════════════════════════════════════════════════════════
// MÓDULO: BLOG
//
// Lista e editor de artigos. Não usa o gerador de CRUD porque o editor tem
// forma própria: campo de texto grande, contagem de caracteres e prévia do
// resultado de busca, como na ficha do imóvel.
//
// O texto é guardado puro, sem HTML. Linha em branco separa parágrafo, e o
// gerador do site escapa tudo antes de escrever. Editor rico aqui abriria a
// porta pra HTML quebrado vindo de copiar e colar do Word.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  let alvoEl = null;

  const data = v => v ? new Date(v + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

  // Mesmas regras que o gerador aplica quando o campo está vazio.
  function sugestao(titulo, resumo, conteudo) {
    const corpo = (resumo || conteudo || '').replace(/\s+/g, ' ').trim();
    return {
      titulo: (titulo || 'Artigo').slice(0, 60),
      descricao: (corpo || titulo || '').slice(0, 158),
    };
  }

  async function montarLista() {
    const posts = await db(supabaseClient.from('post').select('*')
      .order('publicado_em', { ascending: false }).order('created_at', { ascending: false }),
      'carregar os artigos');

    const publicados = posts.filter(p => p.publicado);
    const linhas = posts.map(p => `
      <tr class="cad-linha" data-id="${p.id}">
        <td><div class="cad-end-rua">${esc(p.titulo)}</div>
            <div class="cad-end-sub">${esc(p.slug || 'sem endereço')}</div></td>
        <td class="cad-num">${data(p.publicado_em)}</td>
        <td>${p.publicado ? '<span class="cad-selo cad-selo-vitrine">no site</span>'
                          : '<span class="cad-selo cad-selo-restrito">rascunho</span>'}</td>
        <td class="cad-num">${(p.conteudo || '').length} caracteres</td>
      </tr>`).join('');

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Blog</h2>
          <div class="secao-meta">É o orgânico que constrói ativo: nenhum portal escreve
            análise de mercado com laudo de perito por trás.</div></div>
        </div>
        <div class="secao-acoes">
          <button class="btn btn-primario" id="blNovo">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            Escrever artigo
          </button>
        </div>
      </div>

      <div class="painel-numeros">
        <div class="num"><span class="num-v">${publicados.length}</span><span class="num-r">No site</span></div>
        <div class="num"><span class="num-v">${posts.length - publicados.length}</span><span class="num-r">Rascunhos</span></div>
      </div>

      ${posts.length ? `<div class="cad-tabela-scroll"><table class="cad-tabela">
          <thead><tr><th>Artigo</th><th>Publicado</th><th>Situação</th><th>Tamanho</th></tr></thead>
          <tbody>${linhas}</tbody></table></div>`
        : `<div class="vazio"><div class="vazio-ico">◎</div>
             <h3>Nenhum artigo ainda</h3>
             <p>Um artigo por mês já constrói autoridade. Comece por
                <strong>Escrever artigo</strong>.</p></div>`}`;

    document.getElementById('blNovo').addEventListener('click', () => abrirEditor('novo'));
    alvoEl.querySelectorAll('.cad-linha').forEach(tr =>
      tr.addEventListener('click', () => abrirEditor(tr.dataset.id)));
  }

  async function abrirEditor(id) {
    const p = id === 'novo' ? { publicado: false }
      : (await db(supabaseClient.from('post').select('*').eq('id', id).limit(1), 'abrir artigo'))[0];

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>${id === 'novo' ? 'Novo artigo' : esc(p.titulo)}</h2>
          <div class="secao-meta">${id === 'novo' ? '' : 'Endereço: /blog/' + esc(p.slug || '')}</div></div>
        </div>
        <div class="secao-acoes">
          ${id === 'novo' ? '' : '<button class="btn btn-remover" id="blExcluir">Excluir</button>'}
          <button class="btn" id="blVoltar">Voltar à lista</button>
          <button class="btn btn-primario" id="blSalvar">Salvar</button>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Artigo</h3></div>
        <div class="ficha-grade">
          <div class="campo campo-largo"><label for="blTitulo">Título</label>
            <input type="text" id="blTitulo" value="${esc(p.titulo ?? '')}"
              placeholder="Vale a pena investir em sala comercial no Centro de Pelotas?"></div>
          <div class="campo campo-largo"><label for="blResumo">Resumo</label>
            <textarea id="blResumo" rows="2"
              placeholder="Uma frase que faz a pessoa querer ler.">${esc(p.resumo ?? '')}</textarea></div>
          <div class="campo campo-largo"><label for="blConteudo">Texto</label>
            <textarea id="blConteudo" rows="18"
              placeholder="Escreva normalmente. Deixe uma linha em branco entre parágrafos.">${esc(p.conteudo ?? '')}</textarea>
            <p class="campo-dica"><span id="blConta">0</span> caracteres.
              Linha em branco separa parágrafo. Não use HTML: o site escapa tudo.</p></div>
          <div class="campo campo-largo"><label for="blCapa">Foto de capa (endereço)</label>
            <input type="text" id="blCapa" value="${esc(p.capa_url ?? '')}"
              placeholder="https://…"></div>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Busca e publicação</h3>
          <p>Deixe título e resumo de busca em branco para usar o automático.</p></div>
        <div class="ficha-grade">
          <div class="campo campo-largo"><label for="blMetaTitulo">Título na busca</label>
            <input type="text" id="blMetaTitulo" value="${esc(p.meta_titulo ?? '')}"></div>
          <div class="campo campo-largo"><label for="blMetaDesc">Resumo na busca</label>
            <textarea id="blMetaDesc" rows="2">${esc(p.meta_descricao ?? '')}</textarea></div>
          <div class="campo campo-largo">
            <label class="check"><input type="checkbox" id="blPublicado"${p.publicado ? ' checked' : ''}>
              <span><strong>Publicar no site</strong>
                <em>Enquanto desmarcado, o artigo existe aqui e não aparece no blog.</em></span></label>
          </div>
          <div class="seo-previa campo-largo" id="blPrevia"></div>
        </div>
      </div>

      <div class="ficha-rodape">
        <button class="btn" id="blVoltar2">Voltar à lista</button>
        <button class="btn btn-primario" id="blSalvar2">Salvar</button>
      </div>`;

    function previa() {
      const t = document.getElementById('blTitulo').value;
      const r = document.getElementById('blResumo').value;
      const c = document.getElementById('blConteudo').value;
      document.getElementById('blConta').textContent = c.length;
      const s = sugestao(t, r, c);
      const mt = document.getElementById('blMetaTitulo');
      const md = document.getElementById('blMetaDesc');
      mt.placeholder = s.titulo; md.placeholder = s.descricao;
      const tit = mt.value.trim() || s.titulo;
      const des = md.value.trim() || s.descricao;
      document.getElementById('blPrevia').innerHTML = `
        <div class="seo-cartao">
          <div class="seo-rot">Como fica no Google</div>
          <div class="seo-url-previa">maysimoveis.com › blog</div>
          <div class="seo-titulo-previa">${esc(tit)}</div>
          <div class="seo-desc-previa">${esc(des)}</div>
          <div class="seo-conta">${tit.length}/60 no título · ${des.length}/158 no resumo</div>
        </div>`;
    }
    ['blTitulo','blResumo','blConteudo','blMetaTitulo','blMetaDesc']
      .forEach(i => document.getElementById(i).addEventListener('input', previa));
    previa();

    ['blVoltar','blVoltar2'].forEach(i =>
      document.getElementById(i).addEventListener('click', montarLista));
    ['blSalvar','blSalvar2'].forEach(i =>
      document.getElementById(i).addEventListener('click', salvar));
    const ex = document.getElementById('blExcluir');
    if (ex) ex.addEventListener('click', async () => {
      if (!confirm('Excluir este artigo? A ação não pode ser desfeita.')) return;
      await db(supabaseClient.from('post').delete().eq('id', id), 'excluir');
      avisar('Artigo excluído.');
      await montarLista();
    });

    async function salvar() {
      const v = i => document.getElementById(i).value.trim();
      if (!v('blTitulo')) { avisar('O artigo precisa de título.'); return; }
      const dados = {
        titulo: v('blTitulo'), resumo: v('blResumo') || null,
        conteudo: v('blConteudo') || null, capa_url: v('blCapa') || null,
        meta_titulo: v('blMetaTitulo') || null, meta_descricao: v('blMetaDesc') || null,
        publicado: document.getElementById('blPublicado').checked,
      };
      if (id === 'novo') {
        dados.autor_id = Plataforma.perfil.id;
        await db(supabaseClient.from('post').insert(dados), 'salvar o artigo');
        avisar('Artigo criado.');
      } else {
        await db(supabaseClient.from('post').update(dados).eq('id', id), 'salvar o artigo');
        avisar('Artigo salvo. Publicando no site…');
        Publicacao.pedir();
      }
      await montarLista();
    }
  }

  Plataforma.registrar('blog', {
    titulo: 'Blog',
    async montar(alvo) { alvoEl = alvo; await montarLista(); },
  });
})();
