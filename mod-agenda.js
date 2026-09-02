// ══════════════════════════════════════════════════════════════════════
// MÓDULO: AGENDA E VISITAS
//
// Substitui a lista genérica que o Crud gerava para `compromisso`. Trocou
// porque agenda não se lê em tabela: se lê por dia, e porque agora ela tem
// duas fontes.
//
// O espelho do Google: os eventos da conta conectada aparecem lado a lado
// com os compromissos da plataforma, marcados como do Google e sem poder
// serem editados aqui. Editar evento que nasceu lá dentro daqui seria
// prometer uma sincronia de campo por campo que não existe.
//
// O que a plataforma cria vai para o Google no salvar, e sai de lá no
// excluir. O evento leva uma marca (`plataforma_mays`) para voltar
// identificado e não aparecer duas vezes na mesma tela.
//
// Regra que vale a pena não esquecer: falha no Google NUNCA impede salvar o
// compromisso. O dado da casa é o que manda; a sincronia é consequência.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  let alvoEl = null;
  let vista = 'lista';        // lista | semana | mes
  let janela = 'semana';      // só na vista de lista
  let ancora = new Date();    // dia de referência da semana ou do mês
  let mostrarGoogle = true;

  const TIPOS = [['visita', 'Visita'], ['reuniao', 'Reunião'], ['ligacao', 'Ligação'],
                 ['vistoria', 'Vistoria'], ['outro', 'Outro']];
  const SITUACOES = [['marcado', 'Marcado', 'autorizado'], ['realizado', 'Realizado', 'vitrine'],
                     ['cancelado', 'Cancelado', 'restrito'], ['remarcado', 'Remarcado', 'mural']];

  // Mesma lista da janela de agendar (agendar.js). Sem lembrete é string
  // vazia no <select> e NULL no banco, que é diferente de zero minutos.
  const LEMBRETES = [['10', '10 minutos antes'], ['30', '30 minutos antes'],
                     ['60', '1 hora antes'], ['120', '2 horas antes'],
                     ['1440', '1 dia antes'], ['', 'Sem lembrete']];

  const rotulo = (lista, v) => (lista.find(x => x[0] === v) || [, v || '—'])[1];
  const selo = v => (SITUACOES.find(x => x[0] === v) || [, , 'restrito'])[2];

  // <input type="datetime-local"> não entende ISO com fuso. Corta para o
  // formato dele e devolve na hora local, que é a hora que a pessoa marcou.
  const paraCampo = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const hora = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // O dia do compromisso é o dia de QUEM MARCOU, não o do meridiano de
  // Greenwich. Com toISOString, uma visita às 21h em Pelotas caía no dia
  // seguinte, porque em UTC já é meia-noite. Aqui é sempre data local.
  const diaDe = iso => {
    const d = new Date(iso), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  function rotuloDoDia(iso) {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    // Meia-noite contra meia-noite. Com meio-dia de um lado, a diferença dava
    // 0,5 e o arredondamento chamava o compromisso de hoje de "amanhã".
    const d = new Date(iso + 'T00:00:00');
    const dias = Math.round((d - hoje) / 86400000);
    const nome = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    if (dias === 0) return 'Hoje · ' + nome;
    if (dias === 1) return 'Amanhã · ' + nome;
    if (dias === -1) return 'Ontem · ' + nome;
    return nome.charAt(0).toUpperCase() + nome.slice(1);
  }

  const meiaNoite = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const somarDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  // Semana começando no domingo, como o Google mostra em português.
  const domingoDa = d => somarDias(meiaNoite(d), -meiaNoite(d).getDay());

  // O mês desenhado é sempre a grade inteira: começa no domingo anterior ao
  // dia 1 e termina no sábado seguinte ao último dia. É por isso que aparecem
  // dias do mês vizinho nas pontas, igual a qualquer calendário de parede.
  function gradeDoMes(d) {
    const primeiro = new Date(d.getFullYear(), d.getMonth(), 1);
    const inicio = domingoDa(primeiro);
    const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const fim = somarDias(domingoDa(ultimo), 7);
    return { inicio, fim };
  }

  function intervalo() {
    if (vista === 'semana') {
      const de = domingoDa(ancora);
      return { de, ate: somarDias(de, 7) };
    }
    if (vista === 'mes') {
      const g = gradeDoMes(ancora);
      return { de: g.inicio, ate: g.fim };
    }
    const de = meiaNoite(new Date());
    const ate = new Date(de);
    if (janela === 'hoje') ate.setDate(ate.getDate() + 1);
    else if (janela === 'semana') ate.setDate(ate.getDate() + 7);
    else if (janela === 'mes') ate.setMonth(ate.getMonth() + 1);
    else { de.setMonth(de.getMonth() - 6); ate.setMonth(ate.getMonth() + 12); }
    return { de, ate };
  }

  function tituloDoPeriodo() {
    if (vista === 'semana') {
      const de = domingoDa(ancora), ate = somarDias(de, 6);
      const mesmoMes = de.getMonth() === ate.getMonth();
      const f = (d, comMes) => d.toLocaleDateString('pt-BR',
        comMes ? { day: '2-digit', month: 'short' } : { day: '2-digit' });
      return `${f(de, !mesmoMes)} a ${f(ate, true)} de ${ate.getFullYear()}`;
    }
    if (vista === 'mes') {
      const t = ancora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    return '';
  }

  // ── Lista ───────────────────────────────────────────────────────────
  async function montarLista() {
    const { de, ate } = intervalo();
    const meus = await db(supabaseClient.from('compromisso').select('*')
      .gte('inicio', de.toISOString()).lt('inicio', ate.toISOString())
      .order('inicio'), 'carregar compromissos');

    // O Google é opcional e pode falhar por mil motivos fora daqui: conta
    // desconectada, rede, cota. Nada disso pode derrubar a agenda da casa,
    // então a falha vira um aviso na tela e a lista segue.
    let doGoogle = [], falhaGoogle = null, ligado = false;
    if (mostrarGoogle && Plataforma.google) {
      try {
        const est = await Plataforma.google('estado');
        ligado = est.conectado;
        if (ligado) {
          const r = await Plataforma.google('eventos', { de: de.toISOString(), ate: ate.toISOString() });
          // O que a própria plataforma mandou para lá volta marcado e é
          // descartado: senão a mesma visita apareceria duas vezes.
          doGoogle = (r.eventos || []).filter(e => !e.daPlataforma);
        }
      } catch (e) { falhaGoogle = e.message; }
    }

    const itens = [
      ...meus.map(c => ({ tipo: 'meu', inicio: c.inicio, dado: c })),
      ...doGoogle.map(e => ({ tipo: 'google', inicio: e.inicio, dado: e })),
    ].sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));

    const porDia = new Map();
    itens.forEach(i => {
      const d = diaDe(i.inicio);
      if (!porDia.has(d)) porDia.set(d, []);
      porDia.get(d).push(i);
    });

    const abas = [['hoje', 'Hoje'], ['semana', '7 dias'], ['mes', '30 dias'], ['tudo', 'Tudo']];
    const layouts = [['lista', 'Lista'], ['semana', 'Semana'], ['mes', 'Mês']];

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Agenda e visitas</h2>
            <div class="secao-meta">${meus.length} da plataforma${
              ligado ? ` · ${doGoogle.length} do Google` : ''}</div></div>
        </div>
        <div class="secao-acoes">
          <div class="cp-abas">${layouts.map(([k, r]) =>
            `<button class="cp-aba${vista === k ? ' ativo' : ''}" data-vista="${k}">${r}</button>`).join('')}</div>
          ${vista === 'lista' ? `<div class="cp-abas">${abas.map(([k, r]) =>
            `<button class="cp-aba${janela === k ? ' ativo' : ''}" data-janela="${k}">${r}</button>`).join('')}</div>`
          : `<div class="ag-nav">
              <button class="btn btn-mini" data-passo="-1" aria-label="Anterior">‹</button>
              <span class="ag-periodo">${esc(tituloDoPeriodo())}</span>
              <button class="btn btn-mini" data-passo="1" aria-label="Próximo">›</button>
              <button class="btn btn-mini" data-passo="0">Hoje</button>
            </div>`}
          ${ligado ? `<label class="campo-check ag-alternar"><input type="checkbox" id="agVerGoogle"${
            mostrarGoogle ? ' checked' : ''}><span>Ver o Google</span></label>` : ''}
          <button class="btn btn-primario" id="agNovo">Novo compromisso</button>
        </div>
      </div>

      ${falhaGoogle ? `<div class="ficha-secao" style="border-color:rgba(224,82,82,.4)">
        <div style="padding:13px 18px"><p class="campo-dica" style="color:var(--vermelho)">
          Os eventos do Google não vieram: ${esc(falhaGoogle)}. A agenda da plataforma está
          completa; só o espelho falhou.</p></div></div>` : ''}

      ${!ligado && mostrarGoogle ? `<div class="ficha-secao">
        <div style="padding:13px 18px"><p class="campo-dica">Sua conta do Google ainda não
          está conectada. Ligue em <strong>Corretores › Agenda do Google</strong> para ver aqui
          o que você marca no celular.</p></div></div>` : ''}

      ${vista === 'semana' ? desenharSemana(porDia)
        : vista === 'mes' ? desenharMes(porDia)
        : porDia.size ? [...porDia.entries()].map(([dia, lista]) => `
            <section class="ag-dia">
              <h3 class="ag-dia-rot">${esc(rotuloDoDia(dia))}</h3>
              <div class="ag-linhas">${lista.map(i => i.tipo === 'meu'
                ? linhaMinha(i.dado) : linhaGoogle(i.dado)).join('')}</div>
            </section>`).join('')
        : `<div class="vazio"><div class="vazio-ico">▦</div>
            <h3>Nada marcado nesse período</h3>
            <p>Visita, reunião, vistoria. O que estiver aqui vai junto para o seu Google,
               se a conta estiver conectada.</p></div>`}`;

    alvoEl.querySelectorAll('[data-janela]').forEach(b => b.addEventListener('click', () => {
      janela = b.dataset.janela; montarLista();
    }));
    alvoEl.querySelectorAll('[data-vista]').forEach(b => b.addEventListener('click', () => {
      vista = b.dataset.vista;
      // Trocar de layout sempre volta para hoje. Ficar em outubro porque foi
      // lá que se parou da última vez é o tipo de memória que confunde.
      ancora = new Date();
      montarLista();
    }));
    alvoEl.querySelectorAll('[data-passo]').forEach(b => b.addEventListener('click', () => {
      const n = Number(b.dataset.passo);
      if (n === 0) ancora = new Date();
      else if (vista === 'semana') ancora = somarDias(ancora, 7 * n);
      else ancora = new Date(ancora.getFullYear(), ancora.getMonth() + n, 1);
      montarLista();
    }));
    // Clicar num espaço vazio do calendário já abre o compromisso naquele
    // dia e hora. É o gesto que todo mundo tenta.
    alvoEl.querySelectorAll('[data-novo-em]').forEach(el => el.addEventListener('click', e => {
      if (e.target.closest('[data-abrir],[data-link]')) return;
      abrirFicha('novo', el.dataset.novoEm);
    }));
    alvoEl.querySelectorAll('[data-link]').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();
      window.open(el.dataset.link, '_blank', 'noopener');
    }));
    const ver = document.getElementById('agVerGoogle');
    if (ver) ver.addEventListener('change', () => { mostrarGoogle = ver.checked; montarLista(); });
    document.getElementById('agNovo').addEventListener('click', () => abrirFicha('novo'));
    alvoEl.querySelectorAll('[data-abrir]').forEach(el =>
      el.addEventListener('click', () => abrirFicha(el.dataset.abrir)));
  }

  // ══ Calendário ════════════════════════════════════════════════════
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const chave = d => { const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const ehHoje = d => chave(d) === chave(new Date());

  const tituloDe = i => i.tipo === 'meu' ? i.dado.titulo : i.dado.titulo;
  const minutos = iso => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };

  // Fim de verdade do item, para desenhar altura. Sem fim gravado, uma hora:
  // é a duração de visita mais comum e evita bloco de altura zero.
  function fimEm(i) {
    const f = i.tipo === 'meu' ? i.dado.fim : i.dado.fim;
    return f ? minutos(f) : minutos(i.inicio) + 60;
  }

  // Dois compromissos na mesma hora não podem se tapar. Agrupa o que se
  // sobrepõe e divide a largura entre eles, como o Google faz.
  function repartir(itens) {
    const ordenados = [...itens].sort((a, b) => minutos(a.inicio) - minutos(b.inicio));
    const grupos = [];
    let atual = [], limite = -1;
    ordenados.forEach(i => {
      if (atual.length && minutos(i.inicio) >= limite) { grupos.push(atual); atual = []; limite = -1; }
      atual.push(i);
      limite = Math.max(limite, fimEm(i));
    });
    if (atual.length) grupos.push(atual);

    const posicao = new Map();
    grupos.forEach(g => g.forEach((i, n) => posicao.set(i, { col: n, de: g.length })));
    return posicao;
  }

  function blocoDoDia(itens, hInicio, hFim) {
    const posicao = repartir(itens.filter(i => !(i.tipo === 'google' && i.dado.diaInteiro)));
    const alturaTotal = (hFim - hInicio) * 60;
    return itens.map(i => {
      const pos = posicao.get(i);
      if (!pos) return '';
      const de = Math.max(minutos(i.inicio) - hInicio * 60, 0);
      const ate = Math.min(fimEm(i) - hInicio * 60, alturaTotal);
      const larg = 100 / pos.de;
      const meu = i.tipo === 'meu';
      const attr = meu ? `data-abrir="${i.dado.id}"`
                       : (i.dado.link ? `data-link="${esc(i.dado.link)}"` : '');
      return `<div class="ag-bloco${meu ? '' : ' ag-bloco-google'}" ${attr}
        style="top:${de / alturaTotal * 100}%;height:${Math.max((ate - de) / alturaTotal * 100, 2.2)}%;
               left:${pos.col * larg}%;width:calc(${larg}% - 3px)"
        title="${esc(tituloDe(i))}">
        <span class="ag-bloco-h">${hora(i.inicio)}</span>
        <span class="ag-bloco-t">${esc(tituloDe(i))}</span>
      </div>`;
    }).join('');
  }

  function desenharSemana(porDia) {
    const de = domingoDa(ancora);
    const dias = [...Array(7)].map((_, n) => somarDias(de, n));
    const todos = dias.flatMap(d => porDia.get(chave(d)) || []);

    // A faixa de horas se ajusta ao que existe. Mostrar 0h às 23h sempre
    // deixaria dois terços da tela vazios num dia comum de trabalho.
    const comHora = todos.filter(i => !(i.tipo === 'google' && i.dado.diaInteiro));
    const hInicio = Math.min(8, ...comHora.map(i => Math.floor(minutos(i.inicio) / 60)));
    const hFim = Math.max(19, ...comHora.map(i => Math.ceil(fimEm(i) / 60)));
    const horas = [...Array(hFim - hInicio)].map((_, n) => hInicio + n);

    const diaInteiro = dias.map(d => (porDia.get(chave(d)) || [])
      .filter(i => i.tipo === 'google' && i.dado.diaInteiro));
    const temDiaInteiro = diaInteiro.some(l => l.length);

    return `
      <div class="ag-cal ag-cal-semana">
        <div class="ag-cal-topo">
          <div class="ag-gutter"></div>
          ${dias.map(d => `
            <div class="ag-cab${ehHoje(d) ? ' hoje' : ''}">
              <span class="ag-cab-dia">${SEMANA[d.getDay()]}</span>
              <span class="ag-cab-num">${d.getDate()}</span>
            </div>`).join('')}
        </div>

        ${temDiaInteiro ? `<div class="ag-cal-inteiro">
          <div class="ag-gutter">dia todo</div>
          ${diaInteiro.map(lista => `<div class="ag-inteiro-cel">${lista.map(i =>
            `<span class="ag-chip ag-chip-google"${i.dado.link ? ` data-link="${esc(i.dado.link)}"` : ''}
             >${esc(i.dado.titulo)}</span>`).join('')}</div>`).join('')}
        </div>` : ''}

        <div class="ag-cal-corpo">
          <div class="ag-gutter ag-gutter-horas">
            ${horas.map(h => `<div class="ag-hora-rot"><span>${String(h).padStart(2, '0')}:00</span></div>`).join('')}
          </div>
          ${dias.map((d, n) => `
            <div class="ag-coluna-dia${ehHoje(d) ? ' hoje' : ''}"
                 data-novo-em="${chave(d)}T09:00">
              ${horas.map(() => '<div class="ag-faixa"></div>').join('')}
              <div class="ag-blocos">${blocoDoDia(porDia.get(chave(d)) || [], hInicio, hFim)}</div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function desenharMes(porDia) {
    const g = gradeDoMes(ancora);
    const celulas = [];
    for (let d = new Date(g.inicio); d < g.fim; d = somarDias(d, 1)) celulas.push(new Date(d));
    const mesAtual = ancora.getMonth();

    return `
      <div class="ag-cal ag-cal-mes">
        <div class="ag-mes-cab">${SEMANA.map(d => `<div>${d}</div>`).join('')}</div>
        <div class="ag-mes-grade">
          ${celulas.map(d => {
            const lista = porDia.get(chave(d)) || [];
            // Três cabem sem espremer a célula; o resto vira contagem, e o
            // clique no dia leva para a lista completa daquele dia.
            const visiveis = lista.slice(0, 3);
            const sobra = lista.length - visiveis.length;
            return `
              <div class="ag-cel${d.getMonth() === mesAtual ? '' : ' fora'}${ehHoje(d) ? ' hoje' : ''}"
                   data-novo-em="${chave(d)}T09:00">
                <span class="ag-cel-num">${d.getDate()}</span>
                <div class="ag-cel-itens">
                  ${visiveis.map(i => {
                    const meu = i.tipo === 'meu';
                    const attr = meu ? `data-abrir="${i.dado.id}"`
                                     : (i.dado.link ? `data-link="${esc(i.dado.link)}"` : '');
                    return `<span class="ag-chip${meu ? '' : ' ag-chip-google'}" ${attr}
                      title="${esc(tituloDe(i))}"><em>${
                      i.tipo === 'google' && i.dado.diaInteiro ? '' : hora(i.inicio)}</em>${esc(tituloDe(i))}</span>`;
                  }).join('')}
                  ${sobra > 0 ? `<span class="ag-mais">+${sobra}</span>` : ''}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function linhaMinha(c) {
    const fim = c.fim ? '–' + hora(c.fim) : '';
    return `
      <article class="ag-linha" data-abrir="${c.id}">
        <span class="ag-hora">${hora(c.inicio)}<em>${fim}</em></span>
        <span class="ag-corpo">
          <span class="ag-titulo">${esc(c.titulo)}</span>
          <span class="ag-sub">${esc(rotulo(TIPOS, c.tipo))}${c.local ? ' · ' + esc(c.local) : ''}</span>
        </span>
        <span class="ag-selos">
          ${c.google_event_id ? '<span class="ag-marca-google" title="Espelhado no seu Google">G</span>' : ''}
          <span class="cad-selo cad-selo-${selo(c.situacao)}">${esc(rotulo(SITUACOES, c.situacao))}</span>
        </span>
      </article>`;
  }

  function linhaGoogle(e) {
    return `
      <article class="ag-linha ag-do-google">
        <span class="ag-hora">${e.diaInteiro ? 'dia todo' : hora(e.inicio)}</span>
        <span class="ag-corpo">
          <span class="ag-titulo">${esc(e.titulo)}</span>
          <span class="ag-sub">${e.local ? esc(e.local) + ' · ' : ''}veio do seu Google</span>
        </span>
        <span class="ag-selos">
          ${e.link ? `<a class="btn btn-mini" href="${esc(e.link)}" target="_blank" rel="noopener">Abrir</a>` : ''}
        </span>
      </article>`;
  }

  // ── Ficha ───────────────────────────────────────────────────────────
  // `quando` chega do clique num dia do calendário, no formato do próprio
  // campo (2026-08-20T09:00). Sem ele, o padrão é daqui a uma hora.
  async function abrirFicha(id, quando) {
    const novo = id === 'novo';
    const [contatos, imoveis] = await Promise.all([
      Crud.listaApoio('contato'), Crud.listaApoio('imovel'),
    ]);
    const c = novo
      ? { tipo: 'visita', situacao: 'marcado',
          inicio: (quando ? new Date(quando) : new Date(Date.now() + 3600000)).toISOString() }
      : (await db(supabaseClient.from('compromisso').select('*').eq('id', id).limit(1), 'abrir'))[0];

    const ops = (lista, sel, vazio) => `<option value="">${vazio}</option>` +
      lista.map(o => `<option value="${o.id}"${o.id === sel ? ' selected' : ''}>${esc(o.nome)}</option>`).join('');
    const fixas = (lista, sel) => lista.map(o =>
      `<option value="${o[0]}"${o[0] === sel ? ' selected' : ''}>${o[1]}</option>`).join('');

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>${novo ? 'Novo compromisso' : esc(c.titulo)}</h2>
            ${c.google_event_id ? '<div class="secao-meta">Espelhado na sua agenda do Google.</div>' : ''}</div>
        </div>
        <div class="secao-acoes">
          ${novo ? '' : '<button class="btn btn-remover" id="agExcluir">Excluir</button>'}
          <button class="btn" id="agVoltar">Voltar</button>
          <button class="btn btn-primario" id="agSalvarC">Salvar</button>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-grade">
          <div class="campo campo-largo"><label for="agTitulo">Título</label>
            <input type="text" id="agTitulo" value="${esc(c.titulo ?? '')}"
                   placeholder="Visita ao apartamento do Centro"></div>
          <div class="campo"><label for="agTipo">Tipo</label>
            <select id="agTipo">${fixas(TIPOS, c.tipo)}</select></div>
          <div class="campo"><label for="agSituacao">Situação</label>
            <select id="agSituacao">${fixas(SITUACOES, c.situacao)}</select></div>
          <div class="campo"><label for="agInicio">Início</label>
            <input type="datetime-local" id="agInicio" value="${paraCampo(c.inicio)}"></div>
          <div class="campo"><label for="agFim">Fim</label>
            <input type="datetime-local" id="agFim" value="${paraCampo(c.fim)}">
            <p class="campo-dica">Em branco vira uma hora.</p></div>
          <div class="campo"><label for="agLembrete">Lembrete</label>
            <select id="agLembrete">${LEMBRETES.map(l =>
              `<option value="${l[0]}"${
                l[0] === (c.lembrete_min == null ? (novo ? '60' : '') : String(c.lembrete_min))
                  ? ' selected' : ''}>${l[1]}</option>`).join('')}</select>
            <p class="campo-dica">Toca no seu Google.</p></div>
          <div class="campo campo-largo"><label for="agLocal">Local</label>
            <input type="text" id="agLocal" value="${esc(c.local ?? '')}"></div>
          <div class="campo"><label for="agContato">Cliente</label>
            <select id="agContato">${ops(contatos, c.contato_id, 'Nenhum')}</select></div>
          <div class="campo"><label for="agImovel">Imóvel</label>
            <select id="agImovel">${ops(imoveis, c.imovel_id, 'Nenhum')}</select></div>
        </div>
      </div>

      <div class="ficha-secao">
        <div class="ficha-secao-topo"><h3>Depois da visita</h3></div>
        <div class="ficha-grade">
          <div class="campo campo-largo"><label for="agObs">Observações</label>
            <textarea id="agObs" rows="2">${esc(c.obs ?? '')}</textarea></div>
          <div class="campo campo-largo"><label for="agFeedback">O que o cliente achou</label>
            <textarea id="agFeedback" rows="4">${esc(c.feedback ?? '')}</textarea>
            <p class="campo-dica">A ficha de visita. É daqui que sai o argumento da próxima oferta.</p></div>
        </div>
      </div>`;

    document.getElementById('agVoltar').addEventListener('click', montarLista);

    document.getElementById('agSalvarC').addEventListener('click', async () => {
      const v = i => document.getElementById(i).value.trim();
      if (!v('agTitulo')) { avisar('O compromisso precisa de título.'); return; }
      if (!v('agInicio')) { avisar('Informe quando começa.'); return; }

      const dados = {
        titulo: v('agTitulo'), tipo: v('agTipo'), situacao: v('agSituacao'),
        inicio: new Date(v('agInicio')).toISOString(),
        fim: v('agFim') ? new Date(v('agFim')).toISOString() : null,
        local: v('agLocal') || null,
        contato_id: v('agContato') || null, imovel_id: v('agImovel') || null,
        obs: v('agObs') || null, feedback: v('agFeedback') || null,
        lembrete_min: v('agLembrete') === '' ? null : Number(v('agLembrete')),
        corretor_id: (Plataforma.perfil || {}).id || null,
      };

      const salvo = novo
        ? await db(supabaseClient.from('compromisso').insert(dados).select('*').single(), 'salvar')
        : await db(supabaseClient.from('compromisso').update(dados).eq('id', id).select('*').single(), 'salvar');
      avisar('Compromisso salvo.');
      await espelharNoGoogle(salvo);
      await montarLista();
    });

    const ex = document.getElementById('agExcluir');
    if (ex) ex.addEventListener('click', async () => {
      if (!confirm('Excluir este compromisso?')) return;
      // Apaga no Google ANTES: se apagasse aqui primeiro e o Google falhasse,
      // o evento ficaria órfão lá, sem nada nesta ponta apontando para ele.
      if (c.google_event_id && Plataforma.google) {
        try { await Plataforma.google('remover', { google_event_id: c.google_event_id }); }
        catch (e) { avisar('Não saiu do Google: ' + e.message); }
      }
      await db(supabaseClient.from('compromisso').delete().eq('id', id), 'excluir');
      avisar('Excluído.');
      await montarLista();
    });
  }

  // Cancelado não fica no Google: agenda com compromisso cancelado dentro
  // atrapalha mais do que ajuda. Sai de lá e o vínculo é desfeito aqui.
  async function espelharNoGoogle(c) {
    if (!Plataforma.google) return;
    try {
      const est = await Plataforma.google('estado');
      if (!est.conectado) return;

      if (c.situacao === 'cancelado') {
        if (!c.google_event_id) return;
        await Plataforma.google('remover', { google_event_id: c.google_event_id });
        await db(supabaseClient.from('compromisso')
          .update({ google_event_id: null }).eq('id', c.id), 'desfazer o vínculo');
        return;
      }

      const r = await Plataforma.google('salvar', { compromisso: c });
      if (r.google_event_id && r.google_event_id !== c.google_event_id) {
        await db(supabaseClient.from('compromisso')
          .update({ google_event_id: r.google_event_id }).eq('id', c.id), 'guardar o id do evento');
      }
    } catch (e) {
      // Nunca derruba o salvar. O compromisso já está gravado na casa; o
      // Google é espelho, e espelho quebrado não apaga o objeto.
      avisar('Salvo aqui, mas não foi para o Google: ' + e.message);
    }
  }

  Plataforma.registrar('agenda', {
    titulo: 'Agenda e visitas',
    async montar(alvo) { alvoEl = alvo; await montarLista(); },
  });
})();
