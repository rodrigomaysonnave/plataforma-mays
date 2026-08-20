// ══════════════════════════════════════════════════════════════════════
// CRUD — gerador de módulo
//
// Proprietários, Clientes, Agenda, Contratos e Financeiro são a mesma tela
// com campos diferentes: lista com busca e filtros, ficha em seções, salvar,
// excluir. Escrever cinco vezes garantiria que em seis meses estivessem
// divergentes — foi assim que o sistema antigo acumulou inconsistência.
//
// Aqui cada módulo vira um descritor. Módulo novo do mesmo feitio passa a ser
// uma configuração, não uma tela.
//
// O que NÃO cabe aqui: funil (kanban), início (painel) e relatórios. Aqueles
// têm forma própria e ganham arquivo próprio, como deve ser.
// ══════════════════════════════════════════════════════════════════════

const Crud = (() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  const brl = v => v == null || v === '' ? '—' :
    'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const data = v => v ? new Date(v + (v.length <= 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR') : '—';
  const dataHora = v => v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  // Cache das listas de apoio, uma vez por sessão.
  const apoio = {};
  async function listaApoio(tabela, filtro) {
    const chave = tabela + (filtro || '');
    if (apoio[chave]) return apoio[chave];

    // Nem toda tabela tem coluna `nome`. Imóvel se identifica por código mais
    // título, e é assim que ele precisa aparecer num seletor.
    if (tabela === 'imovel') {
      const linhas = await db(supabaseClient.from('imovel')
        .select('id,codigo,titulo,endereco').eq('rascunho', false).order('codigo'), 'carregar imóveis');
      apoio[chave] = linhas.map(r => ({
        id: r.id, nome: `${r.codigo} · ${r.titulo || r.endereco || 'sem título'}` }));
      return apoio[chave];
    }

    let q = supabaseClient.from(tabela).select('id,nome');
    if (['cidade','bairro','zona','caracteristica','origem_captacao','origem_lead',
         'motivo_perda','categoria_cliente','tipo_imovel','etapa_funil'].includes(tabela)) {
      q = q.eq('ativo', true).order('ordem');
    } else if (['contato','proprietario'].includes(tabela)) {
      q = q.eq('ativo', true);
    }
    apoio[chave] = await db(q.order('nome'), `carregar ${tabela}`);
    return apoio[chave];
  }
  function limparCache() { Object.keys(apoio).forEach(k => delete apoio[k]); }

  function criar(d) {
    let alvoEl = null, editando = null, refs = {};

    // ── Opções dos seletores ──────────────────────────────────────────
    async function carregarRefs() {
      const campos = d.campos.filter(c => c.tipo === 'ref');
      const vistos = {};
      for (const c of campos) {
        if (vistos[c.ref]) continue;
        vistos[c.ref] = true;
        refs[c.ref] = await listaApoio(c.ref);
      }
    }

    const ops = (lista, sel, vazio) =>
      `<option value="">${vazio || '—'}</option>` + (lista || []).map(o =>
        `<option value="${o.id}"${String(o.id) === String(sel ?? '') ? ' selected' : ''}>${esc(o.nome)}</option>`).join('');

    const opsFixas = (lista, sel) => lista.map(([v, r]) =>
      `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(r)}</option>`).join('');

    // ── Célula da lista ───────────────────────────────────────────────
    function celula(reg, col) {
      const v = reg[col.campo];
      if (col.tipo === 'moeda')    return `<span class="cad-valor">${brl(v)}</span>`;
      if (col.tipo === 'data')     return `<span class="cad-num">${data(v)}</span>`;
      if (col.tipo === 'datahora') return `<span class="cad-num">${dataHora(v)}</span>`;
      if (col.tipo === 'bool')     return v ? '<span class="cad-selo cad-selo-vitrine">sim</span>' : '<span class="cad-vazio">não</span>';
      if (col.tipo === 'ref') {
        const item = (refs[col.ref] || []).find(x => x.id === v);
        return esc(item ? item.nome : '—');
      }
      if (col.tipo === 'fixa')     return esc((col.opcoes.find(o => o[0] === v) || [, '—'])[1]);
      if (col.tipo === 'selo') {
        const r = (col.opcoes.find(o => o[0] === v) || [, v, 'autorizado']);
        return `<span class="cad-selo cad-selo-${r[2] || 'autorizado'}">${esc(r[1] || '—')}</span>`;
      }
      return v == null || v === '' ? '<span class="cad-vazio">—</span>' : esc(v);
    }

    async function desenharLista() {
      let q = supabaseClient.from(d.tabela).select('*');
      q = d.ordem ? q.order(d.ordem.campo, { ascending: d.ordem.asc !== false })
                  : q.order('created_at', { ascending: false });
      const todos = await db(q, `carregar ${d.titulo.toLowerCase()}`);

      const busca = (document.getElementById('cBusca')?.value || '').trim().toLowerCase();
      const filtro = document.getElementById('cFiltro')?.value || '';
      const lista = todos.filter(r => {
        if (filtro && String(r[d.filtro.campo] ?? '') !== filtro) return false;
        if (!busca) return true;
        return (d.busca || ['nome']).some(c => String(r[c] ?? '').toLowerCase().includes(busca));
      });

      document.getElementById('cMeta').textContent = lista.length === todos.length
        ? `${todos.length} ${todos.length === 1 ? d.singular : d.plural}`
        : `${lista.length} de ${todos.length}`;

      const corpo = document.getElementById('cCorpo');
      if (!todos.length) {
        corpo.innerHTML = `<div class="vazio"><div class="vazio-ico">◎</div>
          <h3>Nenhum ${esc(d.singular)} ainda</h3>
          <p>Comece pelo botão <strong>${esc(d.rotuloNovo)}</strong>, ali em cima à direita.</p></div>`;
        return;
      }
      if (!lista.length) {
        corpo.innerHTML = `<div class="vazio"><div class="vazio-ico">◎</div>
          <h3>Nada com esse filtro</h3><p>Ajuste a busca ou limpe os filtros.</p></div>`;
        return;
      }
      corpo.innerHTML = `
        <div class="cad-tabela-scroll"><table class="cad-tabela">
          <thead><tr>${d.colunas.map(c => `<th>${esc(c.rotulo)}</th>`).join('')}</tr></thead>
          <tbody>${lista.map(r => `<tr class="cad-linha" data-id="${r.id}">
            ${d.colunas.map(c => `<td>${celula(r, c)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>`;
      corpo.querySelectorAll('.cad-linha').forEach(tr =>
        tr.addEventListener('click', () => abrirFicha(tr.dataset.id)));
    }

    async function montarLista() {
      await carregarRefs();
      alvoEl.innerHTML = `
        <div class="secao-topo">
          <div class="secao-titulo"><div class="ponto"></div>
            <div><h2>${esc(d.titulo)}</h2><div class="secao-meta" id="cMeta">Carregando…</div></div>
          </div>
          <div class="secao-acoes">
            <input type="search" id="cBusca" placeholder="${esc(d.placeholderBusca || 'Buscar…')}">
            ${d.filtro ? `<select id="cFiltro"><option value="">${esc(d.filtro.rotulo)}</option>
              ${d.filtro.opcoes.map(([v, r]) => `<option value="${v}">${esc(r)}</option>`).join('')}</select>` : ''}
            <button class="btn btn-primario" id="cNovo">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              ${esc(d.rotuloNovo)}
            </button>
          </div>
        </div>
        <div id="cCorpo"></div>`;
      document.getElementById('cNovo').addEventListener('click', () => abrirFicha('novo'));
      ['cBusca', 'cFiltro'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', desenharLista);
      });
      await desenharLista();
    }

    // ── Ficha ─────────────────────────────────────────────────────────
    function htmlCampo(c, reg) {
      const v = reg[c.campo];
      const id = 'f_' + c.campo;
      let dentro;
      if (c.tipo === 'ref') {
        dentro = `<select id="${id}">${ops(refs[c.ref], v, c.vazio)}</select>`;
        // Cadastro que depende de outro cadastro ganha um atalho pra criar
        // o que falta sem sair da tela — chegou na hora de cadastrar o
        // empreendimento e a construtora dele ainda não existe, por exemplo.
        if (c.criarRapido) {
          dentro = `<div class="linha-com-botao">${dentro}` +
            `<button class="btn" type="button" data-criar-rapido="${c.campo}">+ Novo</button></div>`;
        }
      }
      else if (c.tipo === 'fixa' || c.tipo === 'selo')
                                     dentro = `<select id="${id}">${opsFixas(c.opcoes, v)}</select>`;
      else if (c.tipo === 'texto')   dentro = `<textarea id="${id}" rows="${c.linhas || 3}" placeholder="${esc(c.ph || '')}">${esc(v ?? '')}</textarea>`;
      else if (c.tipo === 'bool')    return `<div class="campo"><label class="check"><input type="checkbox" id="${id}"${v ? ' checked' : ''}>
                                              <span><strong>${esc(c.rotulo)}</strong>${c.dica ? `<em>${esc(c.dica)}</em>` : ''}</span></label></div>`;
      else if (c.tipo === 'moeda')   dentro = `<input type="number" id="${id}" value="${v ?? ''}" step="0.01" min="0" placeholder="${esc(c.ph || '')}">`;
      else if (c.tipo === 'numero')  dentro = `<input type="number" id="${id}" value="${v ?? ''}" step="${c.passo || 1}" min="0" placeholder="${esc(c.ph || '')}">`;
      else if (c.tipo === 'data')    dentro = `<input type="date" id="${id}" value="${v ?? ''}">`;
      else if (c.tipo === 'datahora') dentro = `<input type="datetime-local" id="${id}" value="${v ? String(v).slice(0, 16) : ''}">`;
      else                           dentro = `<input type="${c.tipo === 'email' ? 'email' : c.tipo === 'tel' ? 'tel' : 'text'}" id="${id}" value="${esc(v ?? '')}" placeholder="${esc(c.ph || '')}">`;
      return `<div class="campo${c.largo ? ' campo-largo' : ''}"><label for="${id}">${esc(c.rotulo)}</label>${dentro}${c.dica ? `<p class="campo-dica">${esc(c.dica)}</p>` : ''}</div>`;
    }

    async function abrirFicha(id) {
      await carregarRefs();
      // Cadastro com galeria nasce no banco na hora, igual ao imóvel: foto
      // precisa de um dono existente pra se ligar, e obrigar a preencher o
      // resto do formulário antes inverte a ordem que quem cadastra usa de
      // verdade (chega com as fotos na mão, quer soltar tudo já).
      const criandoAgora = id === 'novo' && !!d.galeria;
      if (criandoAgora) {
        const rotuloCampo = d.rotuloCampo || 'nome';
        const rascunho = { ...(d.padrao || {}) };
        if (!rascunho[rotuloCampo]) rascunho[rotuloCampo] = `Novo ${d.singular}`;
        const r = await db(supabaseClient.from(d.tabela).insert(rascunho).select('id'),
                            `iniciar o cadastro de ${d.singular}`);
        id = r[0].id;
      }
      editando = id;
      const reg = id === 'novo' ? (d.padrao || {})
        : (await db(supabaseClient.from(d.tabela).select('*').eq('id', id).limit(1), 'abrir'))[0];
      const novo = id === 'novo' || criandoAgora;

      const secoes = {};
      d.campos.forEach(c => { (secoes[c.secao || 'Dados'] ||= []).push(c); });

      alvoEl.innerHTML = `
        <div class="secao-topo">
          <div class="secao-titulo"><div class="ponto"></div>
            <div><h2>${novo ? 'Novo ' + esc(d.singular) : esc(reg[d.rotuloCampo || 'nome'] || d.singular)}</h2>
            <div class="secao-meta">${novo ? '' : esc(d.subtitulo ? d.subtitulo(reg, refs) : '')}</div></div>
          </div>
          <div class="secao-acoes">
            ${novo ? '' : '<button class="btn btn-remover" id="cExcluir">Excluir</button>'}
            <button class="btn" id="cVoltar">Voltar à lista</button>
            <button class="btn btn-primario" id="cSalvar">Salvar</button>
          </div>
        </div>
        ${Object.entries(secoes).map(([nome, campos]) => `
          <div class="ficha-secao">
            <div class="ficha-secao-topo"><h3>${esc(nome)}</h3></div>
            <div class="ficha-grade">${campos.map(c => htmlCampo(c, reg)).join('')}</div>
          </div>`).join('')}
        ${d.galeria
          ? `<div class="ficha-secao"><div class="ficha-secao-topo"><h3>Fotos</h3></div>
              <div id="cFotos"></div></div>`
          : ''}
        <div class="ficha-rodape">
          <button class="btn" id="cVoltar2">Voltar à lista</button>
          <button class="btn btn-primario" id="cSalvar2">Salvar</button>
        </div>`;

      ['cVoltar', 'cVoltar2'].forEach(i => document.getElementById(i).addEventListener('click', montarLista));
      ['cSalvar', 'cSalvar2'].forEach(i => document.getElementById(i).addEventListener('click', salvar));
      alvoEl.querySelectorAll('[data-criar-rapido]').forEach(b =>
        b.addEventListener('click', () => criarRapido(b.dataset.criarRapido)));
      const ex = document.getElementById('cExcluir');
      if (ex) ex.addEventListener('click', excluir);
      if (d.galeria)
        Fotos.montar(document.getElementById('cFotos'), { tabela: d.galeria.tabela, coluna: d.galeria.coluna, id, pasta: d.galeria.pasta });
    }

    // Cria pelo nome só, na tabela referenciada, e já seleciona no campo —
    // sem sair da ficha nem perder o resto do formulário já preenchido.
    async function criarRapido(campo) {
      const c = d.campos.find(x => x.campo === campo);
      if (!c) return;
      const nome = prompt(`Nome ${c.criarRapido.rotulo || ''}:`.replace('  ', ' '));
      if (!nome || !nome.trim()) return;
      const r = await db(supabaseClient.from(c.ref).insert({ nome: nome.trim() }).select('id'),
                          `cadastrar ${c.criarRapido.rotulo || c.ref}`);
      const novoId = r && r[0] && r[0].id;
      limparCache();
      refs[c.ref] = await listaApoio(c.ref);
      const sel = document.getElementById('f_' + campo);
      if (sel) sel.innerHTML = ops(refs[c.ref], novoId, c.vazio);
      avisar(`${c.criarRapido.rotulo || 'Cadastro'} criado.`);
    }

    async function salvar() {
      const dados = {};
      for (const c of d.campos) {
        const el = document.getElementById('f_' + c.campo);
        if (!el) continue;
        if (c.tipo === 'bool') dados[c.campo] = el.checked;
        else if (c.tipo === 'moeda' || c.tipo === 'numero')
          dados[c.campo] = el.value === '' ? null : Number(el.value);
        else dados[c.campo] = el.value.trim() === '' ? null : el.value;
      }
      const falta = (d.obrigatorios || []).find(campo => !dados[campo]);
      if (falta) {
        const c = d.campos.find(x => x.campo === falta);
        avisar(`${c ? c.rotulo : falta} é obrigatório.`);
        document.getElementById('f_' + falta)?.focus();
        return;
      }
      if (d.validar) {
        const erro = await d.validar(dados, editando);
        if (erro) { avisar(erro); return; }
      }
      if (editando === 'novo') {
        await db(supabaseClient.from(d.tabela).insert(dados), `salvar o ${d.singular}`);
        avisar(`${d.singular[0].toUpperCase() + d.singular.slice(1)} cadastrado.`);
      } else {
        await db(supabaseClient.from(d.tabela).update(dados).eq('id', editando), `salvar o ${d.singular}`);
        avisar('Salvo.');
      }
      limparCache();
      await montarLista();
    }

    async function excluir() {
      if (!confirm(`Excluir este ${d.singular}? A ação não pode ser desfeita.`)) return;
      await db(supabaseClient.from(d.tabela).delete().eq('id', editando), 'excluir');
      avisar('Excluído.');
      limparCache();
      await montarLista();
    }

    Plataforma.registrar(d.nome, {
      titulo: d.titulo,
      async montar(alvo, arg) {
        alvoEl = alvo;
        if (arg === 'novo') { await abrirFicha('novo'); return; }
        await montarLista();
      },
    });
  }

  return { criar, listaApoio, limparCache, brl, data, dataHora };
})();
