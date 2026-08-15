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
  let janela = 'semana';
  let mostrarGoogle = true;

  const TIPOS = [['visita', 'Visita'], ['reuniao', 'Reunião'], ['ligacao', 'Ligação'],
                 ['vistoria', 'Vistoria'], ['outro', 'Outro']];
  const SITUACOES = [['marcado', 'Marcado', 'autorizado'], ['realizado', 'Realizado', 'vitrine'],
                     ['cancelado', 'Cancelado', 'restrito'], ['remarcado', 'Remarcado', 'mural']];

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

  function intervalo() {
    const de = new Date(); de.setHours(0, 0, 0, 0);
    const ate = new Date(de);
    if (janela === 'hoje') ate.setDate(ate.getDate() + 1);
    else if (janela === 'semana') ate.setDate(ate.getDate() + 7);
    else if (janela === 'mes') ate.setMonth(ate.getMonth() + 1);
    else { de.setMonth(de.getMonth() - 6); ate.setMonth(ate.getMonth() + 12); }
    return { de, ate };
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

    alvoEl.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Agenda e visitas</h2>
            <div class="secao-meta">${meus.length} da plataforma${
              ligado ? ` · ${doGoogle.length} do Google` : ''}</div></div>
        </div>
        <div class="secao-acoes">
          <div class="cp-abas">${abas.map(([k, r]) =>
            `<button class="cp-aba${janela === k ? ' ativo' : ''}" data-janela="${k}">${r}</button>`).join('')}</div>
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

      ${porDia.size ? [...porDia.entries()].map(([dia, lista]) => `
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
    const ver = document.getElementById('agVerGoogle');
    if (ver) ver.addEventListener('change', () => { mostrarGoogle = ver.checked; montarLista(); });
    document.getElementById('agNovo').addEventListener('click', () => abrirFicha('novo'));
    alvoEl.querySelectorAll('[data-abrir]').forEach(el =>
      el.addEventListener('click', () => abrirFicha(el.dataset.abrir)));
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
  async function abrirFicha(id) {
    const novo = id === 'novo';
    const [contatos, imoveis] = await Promise.all([
      Crud.listaApoio('contato'), Crud.listaApoio('imovel'),
    ]);
    const c = novo
      ? { tipo: 'visita', situacao: 'marcado', inicio: new Date(Date.now() + 3600000).toISOString() }
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
