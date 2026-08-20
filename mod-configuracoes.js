// ══════════════════════════════════════════════════════════════════════
// MÓDULO: CONFIGURAÇÕES
//
// Primeiro módulo da plataforma, e primeiro de propósito: é ele que faz o
// resto do sistema deixar de ter lista escrita no código. Foi exatamente esse
// o problema do sistema anterior — o cadastro não oferecia "Casa" porque a
// lista de tipos vivia dentro do HTML e só um programador mudava.
//
// A tela é UMA só, dirigida pelo array LISTAS abaixo. Adicionar uma lista nova
// ao sistema passa a ser: uma linha aqui + uma tabela no banco com a mesma
// forma (id, nome, ativo, ordem). Não é uma tela nova.
//
// Exclusão é lógica, nunca DELETE: apagar um bairro que 8 imóveis usam
// quebraria os 8. Item desativado some dos seletores e continua legível no
// que já foi cadastrado.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  const LISTAS = [
    { grupo: 'Localização', tabela: 'cidade', titulo: 'Cidades', comRegiao: true,
      descricao: 'Cidades em que você opera. A região agrupa cidades numa vitrine do site, '
               + 'como "Litoral SC": cadastre a região uma vez e todo imóvel daquela cidade entra nela.' },
    { grupo: 'Localização', tabela: 'bairro', titulo: 'Bairros',
      descricao: 'Bairros usados no cadastro, na busca e nos filtros da vitrine.' },
    { grupo: 'Localização', tabela: 'zona', titulo: 'Zonas',
      descricao: 'Agrupamento maior que bairro, quando fizer sentido (zona norte, orla).' },

    { grupo: 'Imóvel', tabela: 'tipo_imovel', titulo: 'Tipos de imóvel', hierarquica: true,
      descricao: 'O que o imóvel é. Cada tipo pode ter subtipos: Casa tem Sobrado, Geminado, Casa em condomínio.' },
    { grupo: 'Imóvel', tabela: 'tipo_empreendimento', titulo: 'Tipos de condomínio', comVertical: true,
      descricao: 'O que o condomínio é. Marcado como vertical, o cadastro dele pede pavimentos e unidades por andar.' },
    { grupo: 'Imóvel', tabela: 'caracteristica', titulo: 'Características',
      descricao: 'Piscina, elevador, esquina. Marcadas no imóvel e usadas como filtro.' },
    { grupo: 'Imóvel', tabela: 'origem_captacao', titulo: 'Origem da captação',
      descricao: 'Como o imóvel chegou até você. É o que mostra qual esforço de captação rende.' },

    { grupo: 'Atendimento', tabela: 'etapa_funil', titulo: 'Etapas do funil', comResultado: true,
      descricao: 'As etapas por onde um negócio passa. Vieram do funil que ele já usa hoje. Mexer aqui muda o kanban inteiro.' },
    { grupo: 'Atendimento', tabela: 'origem_lead', titulo: 'Origem do lead',
      descricao: 'De onde veio o contato. É a base do relatório de retorno por canal.' },
    { grupo: 'Atendimento', tabela: 'motivo_perda', titulo: 'Motivos de perda',
      descricao: 'Por que a negociação caiu. Preenchido ao perder, vira aprendizado.' },
    { grupo: 'Atendimento', tabela: 'categoria_cliente', titulo: 'Categorias de cliente',
      descricao: 'Investidor, comprador, proprietário. Organiza a carteira.' },
  ];

  const SEGMENTOS = [['residencial', 'Residencial'], ['comercial', 'Comercial'], ['rural', 'Rural']];
  const RESULTADOS = [
    ['andamento', 'Em andamento', ''],
    ['ganho',     'Ganho',        'selo-ganho'],
    ['perda',     'Perda',        'selo-perda'],
  ];

  const AJUSTES = { tabela: '__ajustes', titulo: 'Ajustes gerais', grupo: 'Geral',
    descricao: 'Dados da imobiliária, usados no sistema, no site e nas peças.' };

  let selecionada = AJUSTES.tabela;
  let contagens = {};
  let alvoEl = null;

  const cfg = () => selecionada === AJUSTES.tabela ? AJUSTES : LISTAS.find(l => l.tabela === selecionada);

  // ── Ajustes gerais ────────────────────────────────────────────────
  // Registro único. É aqui que moram o CRECI e o WhatsApp, que no projeto da
  // vitrine estavam escritos à mão dentro do gerar.py e por isso só mudavam
  // com um programador junto.
  async function desenharAjustes() {
    const linhas = await db(supabaseClient.from('configuracao').select('*').limit(1), 'carregar ajustes');
    const c = linhas[0] || {};
    const cp = (id, rot, val, ph, dica) => `
      <div class="campo">
        <label for="${id}">${rot}</label>
        <input type="text" id="${id}" value="${esc(val ?? '')}" placeholder="${ph || ''}">
        ${dica ? `<p class="campo-dica">${dica}</p>` : ''}
      </div>`;

    alvoEl.querySelector('#cfgPainel').innerHTML = `
      <div class="cfg-painel-topo">
        <div><h3>${AJUSTES.titulo}</h3><p>${AJUSTES.descricao}</p></div>
      </div>
      <div class="ficha-grade">
        ${cp('cfgNomeSistema', 'Nome do sistema', c.nome_sistema, 'Plataforma Mays', 'Aparece no topo da barra lateral e no título da aba.')}
        ${cp('cfgNomeImob', 'Nome da imobiliária', c.nome_imobiliaria, 'Maysonnave Imóveis')}
        ${cp('cfgCreci', 'CRECI', c.creci, 'CRECI/RS 61580', 'Vai nas peças e no site. Exigido em publicidade.')}
        ${cp('cfgWhatsapp', 'WhatsApp', c.whatsapp, '5553981041499', 'Só dígitos, com país e DDD. É o número dos botões de conversa.')}
        ${cp('cfgEmail', 'E-mail de contato', c.email_contato, '')}
        ${cp('cfgCidade', 'Cidade padrão', c.cidade_padrao, 'Pelotas', 'Já vem preenchida ao cadastrar imóvel.')}
        ${cp('cfgEstado', 'Estado padrão', c.estado_padrao, 'RS')}
        ${cp('cfgEndereco', 'Endereço da imobiliária', c.endereco, 'Rua XV de Novembro, 666 · loja 67', 'Aparece no rodapé do site. Endereço físico também conta para o Google entender que existe um negócio real em Pelotas.')}
        ${cp('cfgSite', 'Endereço do site', c.site_url, 'https://maysimoveis.com', 'O endereço ONDE O SITE ESTÁ NO AR agora, não o domínio que você pretende usar. É ele que o botão "Ver no site" abre, e é dele que saem os endereços canônicos e o sitemap quando o site é gerado. Trocou de domínio, troque aqui e gere o site de novo.')}
      </div>
      <div class="ficha-rodape" style="padding:0 20px 18px">
        <button class="btn btn-primario" id="cfgSalvarAjustes">Salvar ajustes</button>
      </div>`;

    alvoEl.querySelector('#cfgSalvarAjustes').addEventListener('click', async () => {
      const v = id => alvoEl.querySelector('#' + id).value.trim() || null;
      await db(supabaseClient.from('configuracao').update({
        nome_sistema: v('cfgNomeSistema') || 'Plataforma Mays',
        nome_imobiliaria: v('cfgNomeImob') || 'Maysonnave Imóveis',
        creci: v('cfgCreci'), whatsapp: v('cfgWhatsapp'), email_contato: v('cfgEmail'),
        cidade_padrao: v('cfgCidade'), estado_padrao: v('cfgEstado'), site_url: v('cfgSite'),
        endereco: v('cfgEndereco'),
      }).eq('id', true), 'salvar os ajustes');
      // Reflete na hora na barra lateral, sem exigir recarregar.
      document.getElementById('nomeSistema').textContent = v('cfgNomeSistema') || 'Plataforma Mays';
      document.getElementById('nomeImobiliaria').textContent = v('cfgNomeImob') || '';
      avisar('Ajustes salvos. Publicando no site…');
      Publicacao.pedir();
    });
  }

  async function carregarItens(tabela) {
    return db(supabaseClient.from(tabela).select('*').order('ordem').order('nome'),
              `carregar ${tabela}`);
  }

  async function carregarContagens() {
    // Conta só os ativos: é o número que importa quando se olha a barra lateral.
    //
    // Busca os ids e conta aqui, em vez de usar `{ count:'exact', head:true }`.
    // O jeito com head manda requisição HEAD, e o navegador marca ela como
    // falha depois de receber os cabeçalhos, mesmo entregando o número certo.
    // Funcionava, mas enchia o console de erro falso e escondia falha de
    // verdade. Estas tabelas têm dezenas de linhas, então buscar os ids
    // não custa nada.
    const pares = await Promise.all(LISTAS.map(async l => {
      const { data } = await supabaseClient.from(l.tabela).select('id').eq('ativo', true);
      return [l.tabela, (data || []).length];
    }));
    contagens = Object.fromEntries(pares);
  }

  // ── Desenho ────────────────────────────────────────────────────────
  function htmlListas() {
    let html = `<div class="cfg-grupo">${esc(AJUSTES.grupo)}</div>
      <button class="cfg-lista-btn${selecionada === AJUSTES.tabela ? ' ativo' : ''}" data-tabela="${AJUSTES.tabela}">
        <span>${esc(AJUSTES.titulo)}</span></button>`;
    let grupoAtual = null;
    for (const l of LISTAS) {
      if (l.grupo !== grupoAtual) {
        grupoAtual = l.grupo;
        html += `<div class="cfg-grupo">${esc(grupoAtual)}</div>`;
      }
      html += `
        <button class="cfg-lista-btn${l.tabela === selecionada ? ' ativo' : ''}" data-tabela="${l.tabela}">
          <span>${esc(l.titulo)}</span>
          <span class="cfg-contagem">${contagens[l.tabela] ?? '—'}</span>
        </button>`;
    }
    return html;
  }

  function htmlItem(item, l, subtipos) {
    let seg = '';
    if (l.hierarquica) {
      seg = `<span class="cfg-selo-seg">${esc((SEGMENTOS.find(s => s[0] === item.segmento) || [,item.segmento])[1])}</span>`;
    } else if (l.comRegiao) {
      // UF e região ficam na própria linha: são duas palavras por cidade, e
      // abrir uma ficha inteira para isso seria desproporcional.
      seg = `<span class="cfg-geo">
        <input type="text" value="${esc(item.uf ?? '')}" data-campo="uf"
               placeholder="UF" maxlength="2" aria-label="Estado" class="cfg-uf">
        <input type="text" value="${esc(item.regiao ?? '')}" data-campo="regiao"
               placeholder="Região (ex.: Litoral SC)" aria-label="Região">
      </span>`;
    } else if (l.comResultado) {
      // Etapa de ganho e de perda precisam se distinguir na lista: são elas que
      // definem o que conta como negócio ganho e perdido no relatório.
      const r = RESULTADOS.find(x => x[0] === item.resultado) || ['', item.resultado, ''];
      seg = `<span class="cfg-selo-seg ${r[2]}">${esc(r[1])}</span>`;
    } else if (l.comVertical) {
      // Vertical ou horizontal decide se o cadastro do condomínio pede
      // pavimentos e unidades por andar — clicável, alterna na hora.
      seg = `<button class="cfg-selo-seg${item.vertical ? '' : ' inativo'}" data-acao="alternar-vertical">
        ${item.vertical ? 'Vertical' : 'Horizontal'}</button>`;
    }
    let html = `
      <li class="cfg-item${item.ativo ? '' : ' inativo'}" data-id="${item.id}">
        <span class="cfg-alca" title="Arraste para mudar a ordem">⠿</span>
        <span class="cfg-item-nome">
          <input type="text" value="${esc(item.nome)}" data-campo="nome" aria-label="Nome">
        </span>
        ${seg}
        <span class="cfg-item-acoes">
          <button class="btn btn-mini" data-acao="alternar">${item.ativo ? 'Desativar' : 'Reativar'}</button>
        </span>
      </li>`;

    if (l.hierarquica) {
      const meus = (subtipos || []).filter(s => s.tipo_imovel_id === item.id);
      html += `
        <li class="cfg-sub" data-pai="${item.id}">
          <span class="cfg-sub-rotulo">Subtipos:</span>
          ${meus.map(s => `
            <span class="cfg-sub-chip${s.ativo ? '' : ' inativo'}">
              ${esc(s.nome)}
              <button class="cfg-sub-x" data-sub="${s.id}" data-ativo="${s.ativo}"
                      title="${s.ativo ? 'Desativar' : 'Reativar'}">${s.ativo ? '×' : '↺'}</button>
            </span>`).join('')}
          <input type="text" class="cfg-sub-novo" placeholder="+ subtipo e Enter" data-pai="${item.id}">
        </li>`;
    }
    return html;
  }

  async function desenharPainel() {
    if (selecionada === AJUSTES.tabela) return desenharAjustes();
    const l = cfg();
    const itens = await carregarItens(l.tabela);
    const subtipos = l.hierarquica
      ? await db(supabaseClient.from('subtipo_imovel').select('*').order('ordem').order('nome'),
                 'carregar subtipos')
      : [];

    const ativos = itens.filter(i => i.ativo).length;
    const painel = alvoEl.querySelector('#cfgPainel');
    painel.innerHTML = `
      <div class="cfg-painel-topo">
        <div>
          <h3>${esc(l.titulo)}</h3>
          <p>${esc(l.descricao)}</p>
        </div>
        <span class="secao-meta">${ativos} ativo${ativos === 1 ? '' : 's'}${
          itens.length - ativos ? ` · ${itens.length - ativos} desativado${itens.length - ativos === 1 ? '' : 's'}` : ''}</span>
      </div>

      <div class="cfg-novo">
        <input type="text" id="cfgNovoNome" placeholder="Nome do novo item">
        ${l.hierarquica ? `<select id="cfgNovoSegmento">
          ${SEGMENTOS.map(([v, r]) => `<option value="${v}">${r}</option>`).join('')}
        </select>` : ''}
        ${l.comResultado ? `<select id="cfgNovoResultado">
          ${RESULTADOS.map(([v, r]) => `<option value="${v}">${r}</option>`).join('')}
        </select>` : ''}
        ${l.comVertical ? `<label class="check" style="margin:0 4px">
          <input type="checkbox" id="cfgNovoVertical"><span>Vertical (tem andar)</span></label>` : ''}
        <button class="btn btn-primario" id="cfgAdicionar">Adicionar</button>
      </div>

      <ul class="cfg-itens">
        ${itens.length ? itens.map(i => htmlItem(i, l, subtipos)).join('')
          : '<li class="vazio"><p>Nenhum item ainda. Adicione o primeiro acima.</p></li>'}
      </ul>`;

    ligarPainel(l);
  }

  // ── Ações ──────────────────────────────────────────────────────────
  async function adicionar(l) {
    const campo = alvoEl.querySelector('#cfgNovoNome');
    const nome = campo.value.trim();
    if (!nome) { campo.focus(); return; }
    const registro = { nome, ordem: 999 };
    if (l.hierarquica) registro.segmento = alvoEl.querySelector('#cfgNovoSegmento').value;
    if (l.comResultado) registro.resultado = alvoEl.querySelector('#cfgNovoResultado').value;
    if (l.comVertical) registro.vertical = alvoEl.querySelector('#cfgNovoVertical').checked;
    try {
      await db(supabaseClient.from(l.tabela).insert(registro), `adicionar em ${l.titulo}`);
    } catch (e) {
      // `unique (nome)` no banco impede duplicado. Dizer isso é mais útil que
      // repetir a mensagem crua do Postgres.
      if (String(e.message).includes('duplicate')) avisar(`"${nome}" já existe nesta lista.`);
      return;
    }
    campo.value = '';
    avisar(`"${nome}" adicionado.`);
    await carregarContagens();
    atualizarContagens();
    await desenharPainel();
    alvoEl.querySelector('#cfgNovoNome').focus();
  }

  async function renomear(id, tabela, nome, original) {
    const limpo = nome.trim();
    if (!limpo || limpo === original) return;
    await db(supabaseClient.from(tabela).update({ nome: limpo }).eq('id', id), 'renomear');
    avisar('Renomeado.');
  }

  async function alternarVertical(id, tabela, verticalAgora) {
    await db(supabaseClient.from(tabela).update({ vertical: !verticalAgora }).eq('id', id), 'mudar o tipo');
    avisar(verticalAgora ? 'Virou horizontal.' : 'Virou vertical.');
    await desenharPainel();
  }

  async function alternarAtivo(id, tabela, ativoAgora) {
    await db(supabaseClient.from(tabela).update({ ativo: !ativoAgora }).eq('id', id),
             ativoAgora ? 'desativar' : 'reativar');
    avisar(ativoAgora ? 'Desativado. Some dos seletores, continua no que já foi cadastrado.' : 'Reativado.');
    await carregarContagens();
    atualizarContagens();
    await desenharPainel();
  }

  function atualizarContagens() {
    alvoEl.querySelectorAll('.cfg-lista-btn').forEach(b => {
      const c = b.querySelector('.cfg-contagem');
      if (c) c.textContent = contagens[b.dataset.tabela] ?? '—';
    });
  }

  function ligarPainel(l) {
    alvoEl.querySelector('#cfgAdicionar').addEventListener('click', () => adicionar(l));
    alvoEl.querySelector('#cfgNovoNome').addEventListener('keydown', e => {
      if (e.key === 'Enter') adicionar(l);
    });

    alvoEl.querySelectorAll('.cfg-item').forEach(li => {
      const id = li.dataset.id;
      const campo = li.querySelector('input[data-campo="nome"]');
      const original = campo.value;
      campo.addEventListener('blur', () => renomear(id, l.tabela, campo.value, original));
      campo.addEventListener('keydown', e => { if (e.key === 'Enter') campo.blur(); });

      // UF e região gravam ao sair do campo, igual ao nome. Região em branco
      // apaga o vínculo, que é como se tira uma cidade da vitrine.
      li.querySelectorAll('input[data-campo="uf"],input[data-campo="regiao"]').forEach(c => {
        const antes = c.value;
        c.addEventListener('blur', async () => {
          if (c.value === antes) return;
          const valor = c.value.trim().toUpperCase && c.dataset.campo === 'uf'
            ? c.value.trim().toUpperCase() : c.value.trim();
          await db(supabaseClient.from(l.tabela)
            .update({ [c.dataset.campo]: valor || null }).eq('id', id), 'salvar');
          avisar('Salvo.');
        });
        c.addEventListener('keydown', e => { if (e.key === 'Enter') c.blur(); });
      });

      li.querySelector('[data-acao="alternar"]').addEventListener('click', () =>
        alternarAtivo(id, l.tabela, !li.classList.contains('inativo')));

      const btnVertical = li.querySelector('[data-acao="alternar-vertical"]');
      if (btnVertical) btnVertical.addEventListener('click', () =>
        alternarVertical(id, l.tabela, !btnVertical.classList.contains('inativo')));
    });

    // A ordem destas listas é a ordem em que elas aparecem nos seletores do
    // sistema inteiro. No funil ela é mais que estética: define a sequência
    // das colunas do kanban, ou seja, o caminho que o negócio percorre.
    const lista = alvoEl.querySelector('.cfg-itens');
    if (lista) Arrastar.ordenar({
      lista, seletor: '.cfg-item', alca: '.cfg-alca',
      // Numa lista hierárquica cada tipo tem logo abaixo a linha dos subtipos
      // dele. Ela precisa viajar junto, senão o pai muda de lugar e os filhos
      // ficam órfãos embaixo de outro.
      grudado: peca => lista.querySelector(`.cfg-sub[data-pai="${peca.dataset.id}"]`),
      aoSoltar: async ids => {
        await Promise.all(ids.map((id, i) =>
          db(supabaseClient.from(l.tabela).update({ ordem: i }).eq('id', id), 'reordenar')));
        avisar('Ordem salva.');
        await desenharPainel();
      },
    });

    if (!l.hierarquica) return;

    alvoEl.querySelectorAll('.cfg-sub-novo').forEach(campo => {
      campo.addEventListener('keydown', async e => {
        if (e.key !== 'Enter') return;
        const nome = campo.value.trim();
        if (!nome) return;
        try {
          await db(supabaseClient.from('subtipo_imovel')
            .insert({ tipo_imovel_id: campo.dataset.pai, nome, ordem: 999 }), 'adicionar subtipo');
        } catch (err) { return; }
        campo.value = '';
        avisar(`Subtipo "${nome}" adicionado.`);
        await desenharPainel();
      });
    });

    alvoEl.querySelectorAll('.cfg-sub-x').forEach(b => {
      b.addEventListener('click', async () => {
        const ativo = b.dataset.ativo === 'true';
        await db(supabaseClient.from('subtipo_imovel').update({ ativo: !ativo }).eq('id', b.dataset.sub),
                 'alterar subtipo');
        await desenharPainel();
      });
    });
  }

  // ── Montagem ───────────────────────────────────────────────────────
  async function montar(alvo) {
    alvoEl = alvo;
    await carregarContagens();

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo">
          <div class="ponto"></div>
          <div>
            <h2>Configurações</h2>
            <div class="secao-meta">As listas que alimentam os seletores do sistema.
              Mudar aqui muda em todo lugar, sem precisar de programador.</div>
          </div>
        </div>
      </div>

      <div class="cfg">
        <div class="cfg-listas" id="cfgListas">${htmlListas()}</div>
        <div class="cfg-painel" id="cfgPainel"></div>
      </div>`;

    alvo.querySelector('#cfgListas').addEventListener('click', async e => {
      const b = e.target.closest('.cfg-lista-btn');
      if (!b || b.dataset.tabela === selecionada) return;
      selecionada = b.dataset.tabela;
      alvo.querySelectorAll('.cfg-lista-btn').forEach(x =>
        x.classList.toggle('ativo', x.dataset.tabela === selecionada));
      await desenharPainel();
    });

    await desenharPainel();
  }

  Plataforma.registrar('configuracoes', { titulo: 'Configurações', montar });
})();
