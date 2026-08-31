// ══════════════════════════════════════════════════════════════════════
// MÓDULO: LEADS DO SITE
//
// `lead_site` é alimentada pelo formulário da ficha do imóvel desde que o
// site foi ao ar, mas até 18/08/2026 nenhuma tela lia essa tabela. O dado
// sempre existiu no banco; só não tinha onde aparecer. Foi assim que ele
// preencheu o formulário como teste e não achou o próprio cadastro em
// lugar nenhum.
//
// Pendente primeiro, sempre. É a fila de quem está esperando resposta, e
// isso pesa mais que ordem cronológica.
//
// A linha é só um resumo: mensagem cortada, sem espaço pra decidir nada.
// Clicar abre a ficha completa, e é lá que mora a ação de verdade —
// atender e enviar pra um corretor.
//
// Exclusão fica na tela principal também, individual e em lote: teste de
// formulário e robô de spam chegam em rajada, e abrir ficha por ficha pra
// limpar quinze linhas não é limpeza, é castigo. O marcador não abre a
// ficha (o clique na coluna do marcador e na de ação não conta como
// clique na linha), e cada seção tem o próprio marcador de "todos":
// marcar tudo em "Aguardando resposta" nunca alcança os já atendidos.
//
// A exclusão MARCA `excluido_em`, não apaga a linha (migração 39). O
// texto acima dizia "some de vez", e era justamente isso que quebrava:
// apagada a linha, o índice único de `meta_lead_id` perdia o id, a
// varredura do Meta reencontrava o lead cinco minutos depois, inseria de
// novo e o gatilho mandava outro e-mail. Da tela some igual; do banco,
// não.
//
// A ficha ganhou etapa e histórico, no mesmo formato da campanha, porque
// "atendido sim/não" não distingue quem não tem perfil de quem está em
// negociação. Marcar Interessado abre o negócio no funil sozinho, com o
// histórico junto; tirar dessa etapa desfaz, mas só enquanto ninguém
// tiver mexido no negócio.
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  // Menos etapas que a campanha de propósito: quem preencheu o formulário do
  // site já se contatou sozinho, então "Contatado" não quer dizer nada aqui.
  // "Não respondeu" quer: é o lead que a gente procurou e que sumiu, coisa
  // diferente de nunca ter sido trabalhado e diferente de ter dito não.
  const ETAPAS = {
    atendendo:     'Atendendo',
    nao_respondeu: 'Não respondeu',
    interesse:     'Interessado',
    sem_perfil:    'Sem perfil',
    sem_interesse: 'Sem interesse',
  };
  // Cores cheias e vivas, não as do tema: aqui elas são sinal, não decoração,
  // e precisam se separar umas das outras a um metro de distância. Todas são
  // claras o bastante para o texto escuro do selo se apoiar em cima.
  const COR_ETAPA = {
    interesse:     '#2fd07a',   // verde
    atendendo:     '#ffd21e',   // amarelo
    nao_respondeu: '#ff9100',   // laranja, a mesma da campanha em "Não atendeu"
    sem_perfil:    '#ff3b30',   // vermelho
    // Sem interesse fica no mesmo campo do vermelho, mais fechado. São os dois
    // fins de linha, vizinhos no fim da lista, e quem separa um do outro é o
    // nome escrito no selo.
    sem_interesse: '#e0574f',
  };

  // A fila não é cronológica, é por chance de virar negócio: interessado
  // primeiro, quem está em atendimento no meio, e os dois desfechos ruins no
  // fim, onde não roubam a atenção de quem ainda vale trabalho. Lead atendido
  // e ainda sem etapa fica entre o meio e o fim: não é promessa nem descarte.
  const ORDEM_ETAPA = {
    interesse: 0, atendendo: 1, nao_respondeu: 2, sem_perfil: 4, sem_interesse: 5,
  };
  const postoNaFila = l => (l.classificacao ? ORDEM_ETAPA[l.classificacao] ?? 3 : 3);

  // Dentro da mesma etapa vale o mais recente primeiro, que é a ordem que o
  // banco já devolve. `sort` do JS é estável, então basta ordenar pelo posto.
  const porEtapa = itens => [...itens].sort((a, b) => postoNaFila(a) - postoNaFila(b));

  let alvoEl = null;
  let leads = [], imoveisPorId = new Map(), corretores = [];
  let editandoAnotacao = null;

  const dataHora = iso => new Date(iso).toLocaleString('pt-BR',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  // O nome do imóvel diz mais que "Ficha do imóvel" repetido em toda linha.
  // Só cai no rótulo genérico quando o lead não tem imóvel vinculado, o que
  // vai passar a acontecer quando existir um segundo formulário no site.
  function origemDe(l) {
    if (l.imovel_id) {
      const im = imoveisPorId.get(l.imovel_id);
      if (im) return im.titulo || im.codigo || l.origem || 'Ficha do imóvel';
    }
    return l.origem || 'Site';
  }

  function nomeCorretor(id) {
    const c = corretores.find(x => x.id === id);
    return c ? c.nome : null;
  }

  async function montar(alvo) {
    alvoEl = alvo;
    const [dadosLeads, imoveis, equipe] = await Promise.all([
      db(supabaseClient.from('lead_site').select('*').is('excluido_em', null)
        .order('created_at', { ascending: false }), 'carregar leads do site'),
      db(supabaseClient.from('imovel').select('id,titulo,codigo'), 'carregar imóveis'),
      db(supabaseClient.from('perfil').select('id,nome').eq('ativo', true).order('nome'), 'carregar equipe'),
    ]);
    leads = dadosLeads;
    imoveisPorId = new Map(imoveis.map(i => [i.id, i]));
    corretores = equipe;

    const pendentes = porEtapa(leads.filter(l => !l.atendido));
    const atendidos = porEtapa(leads.filter(l => l.atendido));

    const linha = l => `
      <tr class="cad-linha" data-id="${l.id}">
        <td class="lead-marca">
          <input type="checkbox" class="lead-check" value="${l.id}"
                 aria-label="Selecionar o lead de ${esc(l.nome)}"></td>
        <td class="cad-num">${esc(dataHora(l.created_at))}</td>
        <td><div class="cad-end-rua">${esc(l.nome)}</div>
            <div class="cad-end-sub">${esc(l.telefone)}${l.email ? ' · ' + esc(l.email) : ''}</div></td>
        <td>${esc(origemDe(l))}</td>
        <td>${l.classificacao
          ? `<span class="lead-etapa-selo" style="--c:${COR_ETAPA[l.classificacao]}">${esc(ETAPAS[l.classificacao])}</span>`
          : '<span class="cad-vazio">sem etapa</span>'}</td>
        <td class="cad-msg">${esc(l.mensagem || '—')}</td>
        <td>${l.corretor_id
          ? `<span class="cad-selo cad-selo-vitrine">${esc(nomeCorretor(l.corretor_id) || '—')}</span>`
          : '<span class="cad-vazio">no balcão</span>'}</td>
        <td class="lead-acao">
          <button class="btn btn-mini btn-remover" data-excluir="${l.id}"
                  title="Excluir este lead">Excluir</button></td>
      </tr>`;

    const tabela = (titulo, itens, vazio) => `
      <section class="ficha-secao lead-secao">
        <div class="ficha-secao-topo lead-secao-topo">
          <h3>${esc(titulo)}<span class="ini-conta">${itens.length}</span></h3>
          ${itens.length ? `<div class="lead-lote" hidden>
            <span class="lead-lote-conta"></span>
            <button class="btn btn-mini btn-remover lead-lote-btn">Excluir selecionados</button>
          </div>` : ''}
        </div>
        ${itens.length ? `<div class="cad-tabela-scroll"><table class="cad-tabela">
          <thead><tr>
            <th class="lead-marca"><input type="checkbox" class="lead-check-tudo"
                  aria-label="Selecionar todos desta lista"></th>
            <th>Quando</th><th>Contato</th><th>Origem</th><th>Etapa</th><th>Mensagem</th><th>Atribuído</th><th></th>
          </tr></thead>
          <tbody>${itens.map(linha).join('')}</tbody></table></div>`
          : `<p class="ini-vazio" style="padding:18px 20px">${esc(vazio)}</p>`}
      </section>`;

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Leads do site</h2>
            <div class="secao-meta">Quem preencheu o formulário no site. Clique numa linha para
              ver a mensagem inteira e enviar para um corretor.</div></div>
        </div>
      </div>

      <div class="painel-numeros">
        <div class="num${pendentes.length ? ' num-destaque' : ''}"><span class="num-v">${pendentes.length}</span><span class="num-r">Aguardando resposta</span></div>
        <div class="num"><span class="num-v">${leads.length}</span><span class="num-r">Total recebido</span></div>
      </div>

      ${tabela('Aguardando resposta', pendentes, 'Nenhum lead pendente. Tudo respondido.')}
      ${tabela('Já atendidos', atendidos, 'Nenhum lead atendido ainda.')}`;

    // Marcador e botão de excluir moram dentro da linha, e a linha inteira
    // abre a ficha. Clicar num deles não pode abrir ficha nenhuma.
    alvo.querySelectorAll('.cad-linha').forEach(tr =>
      tr.addEventListener('click', e => {
        if (e.target.closest('.lead-marca, .lead-acao')) return;
        abrirFicha(tr.dataset.id);
      }));

    alvo.querySelectorAll('[data-excluir]').forEach(btn =>
      btn.addEventListener('click', () => {
        const l = leads.find(x => x.id === btn.dataset.excluir);
        excluirLeads([btn.dataset.excluir],
          `Excluir o lead de ${l ? l.nome : 'este contato'}? Ele some da lista.`);
      }));

    alvo.querySelectorAll('.lead-secao').forEach(ligarSelecao);
  }

  // Cada seção conta a própria seleção. O marcador do cabeçalho fica
  // indeterminado quando só parte da lista está marcada, senão ele mente
  // sobre o que vai levar o próximo clique.
  function ligarSelecao(secao) {
    const tudo   = secao.querySelector('.lead-check-tudo');
    const checks = [...secao.querySelectorAll('.lead-check')];
    if (!tudo || !checks.length) return;
    const lote  = secao.querySelector('.lead-lote');
    const conta = secao.querySelector('.lead-lote-conta');

    const marcados = () => checks.filter(c => c.checked).map(c => c.value);
    const atualizar = () => {
      const n = marcados().length;
      lote.hidden = n === 0;
      conta.textContent = n === 1 ? '1 selecionado' : `${n} selecionados`;
      tudo.checked = n === checks.length;
      tudo.indeterminate = n > 0 && n < checks.length;
    };

    tudo.addEventListener('change', () => {
      checks.forEach(c => { c.checked = tudo.checked; });
      atualizar();
    });
    checks.forEach(c => c.addEventListener('change', atualizar));
    secao.querySelector('.lead-lote-btn').addEventListener('click', () => {
      const ids = marcados();
      excluirLeads(ids, ids.length === 1
        ? 'Excluir o lead selecionado? Ele some da lista.'
        : `Excluir os ${ids.length} leads selecionados? Eles somem da lista.`);
    });
    atualizar();
  }

  // Lead de teste, lead duplicado e rajada de robô sujam a fila de quem
  // está esperando resposta, e a fila é a razão de a tela existir. Some da
  // tela, mas a LINHA FICA, com `excluido_em` marcado: apagar de verdade
  // devolvia o id ao Meta e a varredura reinseria o lead cinco minutos
  // depois, com e-mail novo. Mesmo caminho pra um lead ou pra quinze.
  async function excluirLeads(ids, pergunta) {
    if (!ids.length || !confirm(pergunta)) return;
    await db(supabaseClient.from('lead_site')
      .update({ excluido_em: new Date().toISOString() }).in('id', ids), 'excluir leads');
    avisar(ids.length === 1 ? 'Lead excluído.' : `${ids.length} leads excluídos.`);
    fecharFicha();
    await montar(alvoEl);
    if (Plataforma.atualizarSino) Plataforma.atualizarSino();
  }

  // ── Ficha completa, em janela ──────────────────────────────────────
  function fecharFicha() {
    const m = document.getElementById('leadModal');
    if (m) m.remove();
  }

  function abrirFicha(id) {
    const l = leads.find(x => x.id === id);
    if (!l) return;
    fecharFicha();

    const im = l.imovel_id ? imoveisPorId.get(l.imovel_id) : null;
    const linkImovel = im ? `<a href="#" data-abrir-imovel="${l.imovel_id}">${esc(im.titulo || im.codigo)}</a>` : null;

    const overlay = document.createElement('div');
    overlay.className = 'cp-modal';
    overlay.id = 'leadModal';
    overlay.innerHTML = `
      <div class="cp-modal-caixa lead-modal-caixa">
        <div class="lead-modal-topo">
          <h3>${esc(l.nome)}</h3>
          <span class="cad-selo ${l.atendido ? 'cad-selo-vitrine' : 'cad-selo-autorizado'}">
            ${l.atendido ? 'atendido' : 'aguardando'}</span>
        </div>
        <div class="lead-modal-linha"><b>Quando</b><span>${esc(dataHora(l.created_at))}</span></div>
        <div class="lead-modal-linha"><b>Telefone</b><span><a href="tel:${esc(l.telefone.replace(/\D/g,''))}">${esc(l.telefone)}</a></span></div>
        ${l.email ? `<div class="lead-modal-linha"><b>E-mail</b><span><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></span></div>` : ''}
        ${linkImovel ? `<div class="lead-modal-linha"><b>Imóvel</b><span>${linkImovel}</span></div>` : ''}
        <div class="lead-modal-linha"><b>Origem</b><span>${esc(origemDe(l))}</span></div>

        <div class="lead-modal-msg">
          <b>Mensagem</b>
          <p>${esc(l.mensagem || 'Sem mensagem.')}</p>
        </div>

        <div class="lead-modal-atribuir">
          <b>Enviar para um corretor</b>
          <div class="lead-modal-atribuir-linha">
            <select id="leadCorretorSel">
              <option value="">No balcão comum, sem atribuir</option>
              ${corretores.map(c => `<option value="${c.id}" ${c.id === l.corretor_id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
            </select>
            <button class="btn btn-mini btn-primario" id="leadEnviarBtn">Enviar</button>
          </div>
          ${l.corretor_id ? `<p class="campo-dica">Atualmente com ${esc(nomeCorretor(l.corretor_id) || '—')}${l.enviado_em ? ', desde ' + esc(dataHora(l.enviado_em)) : ''}.</p>` : ''}
        </div>

        <div class="lead-modal-etapas">
          <b>Etapa</b>
          <div class="cp-etapas">${Object.entries(ETAPAS).map(([k, r]) =>
            `<button class="cp-etapa${l.classificacao === k ? ' ativo' : ''}"
               style="${l.classificacao === k ? `--c:${COR_ETAPA[k]}` : ''}"
               data-etapa="${k}">${r}</button>`).join('')}</div>
          <p class="campo-dica">Interessado abre o negócio no funil sozinho. Clicar na
            etapa em que já está desmarca.</p>
        </div>

        <div id="leadHistorico"></div>

        <div class="lead-modal-nova-anot">
          <b>Nova anotação</b>
          <div class="cp-nova-anot">
            <textarea id="leadNovaAnot" rows="2" placeholder="Registre o que aconteceu neste contato"></textarea>
            <button class="btn btn-primario" id="leadSalvarAnot">Salvar</button>
          </div>
        </div>

        <div class="cp-anot-btns" style="margin-top:18px">
          <button class="btn btn-primario" id="leadAtenderBtn">${l.atendido ? 'Reabrir' : 'Marcar atendido'}</button>
          <a class="btn btn-mini" href="https://wa.me/${esc(waNumero(l.telefone))}" target="_blank" rel="noopener">Abrir WhatsApp</a>
          <button class="btn btn-mini btn-remover" id="leadExcluirBtn"
                  title="Apaga o lead de vez. Serve para teste e para engano.">Excluir</button>
          <button class="btn btn-mini" id="leadFecharBtn">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) fecharFicha(); });
    document.getElementById('leadFecharBtn').addEventListener('click', fecharFicha);

    const abrirImovel = overlay.querySelector('[data-abrir-imovel]');
    if (abrirImovel) abrirImovel.addEventListener('click', e => {
      e.preventDefault(); fecharFicha();
      Plataforma.irPara('imoveis', l.imovel_id);
    });

    document.getElementById('leadEnviarBtn').addEventListener('click', async () => {
      const corretorId = document.getElementById('leadCorretorSel').value || null;
      await db(supabaseClient.from('lead_site')
        .update({ corretor_id: corretorId, enviado_em: corretorId ? new Date().toISOString() : null })
        .eq('id', id), 'atribuir lead');
      avisar(corretorId ? `Enviado para ${nomeCorretor(corretorId)}.` : 'Voltou pro balcão comum.');
      fecharFicha();
      await montar(alvoEl);
    });

    desenharHistorico(l);

    overlay.querySelectorAll('[data-etapa]').forEach(b =>
      b.addEventListener('click', () => classificar(id, b.dataset.etapa)));

    document.getElementById('leadSalvarAnot').addEventListener('click', async () => {
      const t = document.getElementById('leadNovaAnot').value.trim();
      if (!t) return;
      await gravarAnotacao(l, { em: new Date().toISOString(), etapa: l.classificacao || null, texto: t });
      document.getElementById('leadNovaAnot').value = '';
      desenharHistorico(l);
    });

    document.getElementById('leadExcluirBtn').addEventListener('click', () =>
      excluirLeads([id], `Excluir o lead de ${l.nome}? Ele some da lista.`));

    document.getElementById('leadAtenderBtn').addEventListener('click', async () => {
      const atender = !l.atendido;
      // Marcar atendido sem dizer em que pé está deixava o lead no limbo: fora
      // da fila do sino e sem etapa nenhuma na lista. Quem atende está
      // atendendo, então a etapa entra junto. Só quando ainda não há etapa:
      // um lead já marcado Interessado não pode ser rebaixado por um clique
      // em "atendido".
      const marcarEtapa = atender && !l.classificacao;
      const agora = new Date().toISOString();
      await db(supabaseClient.from('lead_site').update({
        atendido: atender,
        ...(marcarEtapa ? { classificacao: 'atendendo', classificado_em: agora } : {}),
      }).eq('id', id), atender ? 'marcar atendido' : 'reabrir');

      if (marcarEtapa) {
        l.classificacao = 'atendendo';
        l.classificado_em = agora;
        l.atendido = true;
        await gravarAnotacao(l, {
          em: agora, etapa: 'atendendo', texto: `Etapa: ${ETAPAS.atendendo}`, automatico: true,
        });
      }
      avisar(atender
        ? (marcarEtapa ? 'Marcado como atendido, na etapa Atendendo.' : 'Marcado como atendido.')
        : 'Reaberto.');
      fecharFicha();
      await montar(alvoEl);
      if (Plataforma.atualizarSino) Plataforma.atualizarSino();
    });
  }


  // ── Etapa, anotações e ponte para o funil ───────────────────────────
  // Mesmo formato de anotação da campanha: array JSON em texto. Ler com
  // try/catch porque a coluna é texto livre, e um dia alguém edita na mão.
  function anotacoesDe(l) {
    try { const a = JSON.parse(l.anotacoes || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }

  async function salvarAnotacoes(l, arr) {
    const json = JSON.stringify(arr);
    await db(supabaseClient.from('lead_site').update({ anotacoes: json }).eq('id', l.id), 'salvar anotação');
    l.anotacoes = json;
  }

  const gravarAnotacao = (l, entrada) => salvarAnotacoes(l, [...anotacoesDe(l), entrada]);

  function desenharHistorico(l) {
    const alvo = document.getElementById('leadHistorico');
    if (!alvo) return;
    const anot = anotacoesDe(l);
    if (!anot.length) {
      alvo.innerHTML = '<div class="lead-modal-hist"><b>Histórico</b>'
                     + '<p class="campo-dica">Nada registrado ainda.</p></div>';
      return;
    }
    alvo.innerHTML = `<div class="lead-modal-hist"><b>Histórico</b>
      <div class="cp-tempo">${anot.map((a, i) => {
        const selo = a.etapa ? `<span class="cp-selo-etapa">${esc(ETAPAS[a.etapa] || a.etapa)}</span>` : '';
        if (editandoAnotacao === i) return `
          <div class="cp-anot">
            <div class="cp-anot-topo"><span class="cp-anot-data">${esc(dataHora(a.em))}</span>${selo}</div>
            <textarea class="cp-anot-edit" id="leadAnotEdit" rows="3">${esc(a.texto)}</textarea>
            <div class="cp-anot-btns">
              <button class="btn btn-mini btn-primario" data-salvar-anot="${i}">Salvar</button>
              <button class="btn btn-mini" data-cancelar-anot>Cancelar</button>
            </div>
          </div>`;
        return `
          <div class="cp-anot">
            <div class="cp-anot-topo"><span class="cp-anot-data">${esc(dataHora(a.em))}</span>${selo}
              ${a.automatico ? '' : `<span class="cp-anot-acoes">
                <button class="btn btn-mini" data-editar-anot="${i}">Editar</button>
                <button class="btn btn-mini" data-apagar-anot="${i}">Apagar</button>
              </span>`}</div>
            <div class="cp-anot-txt">${esc(a.texto)}</div>
          </div>`;
      }).join('')}</div></div>`;

    alvo.querySelectorAll('[data-editar-anot]').forEach(b => b.addEventListener('click', () => {
      editandoAnotacao = Number(b.dataset.editarAnot); desenharHistorico(l);
    }));
    const canc = alvo.querySelector('[data-cancelar-anot]');
    if (canc) canc.addEventListener('click', () => { editandoAnotacao = null; desenharHistorico(l); });
    alvo.querySelectorAll('[data-salvar-anot]').forEach(b => b.addEventListener('click', async () => {
      const t = document.getElementById('leadAnotEdit').value.trim();
      if (!t) return;
      const arr = anotacoesDe(l);
      arr[Number(b.dataset.salvarAnot)].texto = t;
      await salvarAnotacoes(l, arr);
      editandoAnotacao = null;
      desenharHistorico(l);
    }));
    alvo.querySelectorAll('[data-apagar-anot]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Apagar esta anotação?')) return;
      const arr = anotacoesDe(l);
      arr.splice(Number(b.dataset.apagarAnot), 1);
      await salvarAnotacoes(l, arr);
      desenharHistorico(l);
    }));
  }

  // Classificar é dizer que o lead foi trabalhado, então ele sai da fila de
  // quem espera resposta. Sem isso a fila mentiria: um lead marcado "sem
  // perfil" seguiria contando no sino como se ninguém tivesse olhado.
  // Desmarcar não reabre sozinho — pra isso existe o botão Reabrir, que é
  // uma decisão diferente de "errei a etapa".
  async function classificar(id, etapa) {
    const l = leads.find(x => x.id === id);
    if (!l) return;
    const nova = l.classificacao === etapa ? null : etapa;
    const agora = nova ? new Date().toISOString() : null;

    await db(supabaseClient.from('lead_site').update({
      classificacao: nova, classificado_em: agora,
      ...(nova ? { atendido: true } : {}),
    }).eq('id', id), 'salvar etapa');
    l.classificacao = nova;
    l.classificado_em = agora;
    if (nova) l.atendido = true;

    await gravarAnotacao(l, {
      em: agora || new Date().toISOString(), etapa: nova,
      texto: nova ? `Etapa: ${ETAPAS[nova]}` : 'Etapa removida', automatico: true,
    });

    if (nova === 'interesse') await mandarProFunil(l);
    else await tirarDoFunil(l);

    fecharFicha();
    await montar(alvoEl);
    if (Plataforma.atualizarSino) Plataforma.atualizarSino();
    abrirFicha(id);
  }

  const soDigitos = t => String(t || '').replace(/\D/g, '');
  const meuId = () => (Plataforma.perfil && Plataforma.perfil.id) || null;

  function historicoTexto(l) {
    return anotacoesDe(l).map(a => {
      const et = a.etapa ? ` [${ETAPAS[a.etapa] || a.etapa}]` : '';
      return `${dataHora(a.em)}${et} — ${a.texto}`;
    }).join('\n');
  }

  // A marca no `obs` é o que amarra o negócio a este lead. Não há coluna de
  // origem no negócio, e inventar uma só pra isto seria mudança grande pra
  // um vínculo que só esta tela lê. Mesma solução da campanha.
  const marcaDe = l => `Lead do site: ${l.nome} (${dataHora(l.created_at)})`;

  async function mandarProFunil(l) {
    let contatoId = l.contato_id;
    if (!contatoId) {
      // Antes de criar registro novo, procura na carteira quem já tem este
      // telefone: o mesmo interessado costuma preencher o formulário de dois
      // imóveis diferentes, e cada vez viraria um cliente novo.
      const tel = soDigitos(l.telefone);
      let achado = null;
      if (tel) {
        const candidatos = await db(supabaseClient.from('contato').select('id,telefone')
          .not('telefone', 'is', null), 'procurar na carteira');
        achado = (candidatos || []).find(c => soDigitos(c.telefone).endsWith(tel.slice(-8)));
      }
      if (achado) contatoId = achado.id;
      else {
        const novo = await db(supabaseClient.from('contato').insert({
          nome: l.nome, telefone: l.telefone, email: l.email || null,
          corretor_id: l.corretor_id, created_by: meuId(),
          obs: `Veio do formulário do site (${origemDe(l)})`,
        }).select('id').single(), 'criar contato');
        contatoId = novo.id;
      }
      await db(supabaseClient.from('lead_site').update({ contato_id: contatoId }).eq('id', l.id), 'vincular contato');
      l.contato_id = contatoId;
    }

    const marca = marcaDe(l);
    const jaTem = await db(supabaseClient.from('negocio').select('id,obs')
      .eq('contato_id', contatoId), 'conferir o funil');
    if ((jaTem || []).some(n => (n.obs || '').startsWith(marca))) return;

    const etapas = await Crud.listaApoio('etapa_funil');
    const primeira = etapas[0];
    if (!primeira) { avisar('Nenhuma etapa de funil cadastrada.'); return; }

    const hist = historicoTexto(l);
    await db(supabaseClient.from('negocio').insert({
      contato_id: contatoId, imovel_id: l.imovel_id || null, etapa_id: primeira.id,
      corretor_id: l.corretor_id, created_by: meuId(),
      obs: marca + (l.mensagem ? `\n${l.mensagem}` : '')
                 + (hist ? `\n— atendimento do lead —\n${hist}` : ''),
    }), 'criar negócio');
    avisar(`${l.nome} entrou no funil.`);
  }

  // Tirar de Interessado desfaz o negócio, mas só enquanto ele estiver
  // intocado na primeira etapa. Se alguém já trabalhou nele, clique errado
  // aqui não pode apagar trabalho real.
  async function tirarDoFunil(l) {
    if (!l.contato_id) return;
    const marca = marcaDe(l);
    const negocios = await db(supabaseClient.from('negocio').select('id,etapa_id,obs')
      .eq('contato_id', l.contato_id), 'conferir o funil');
    const meu = (negocios || []).find(n => (n.obs || '').startsWith(marca));
    if (!meu) return;
    const etapas = await Crud.listaApoio('etapa_funil');
    if (!etapas.length || meu.etapa_id !== etapas[0].id) return;
    await db(supabaseClient.from('negocio').delete().eq('id', meu.id), 'desfazer negócio');
  }

  // Todo link de WhatsApp é wa.me/55 + DDD + número, sem símbolo. Lista
  // vinda de fora às vezes já traz o 55 na frente: tira, senão vira 5555…
  function waNumero(tel) {
    let d = String(tel || '').replace(/\D/g, '');
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
    return '55' + d;
  }

  Plataforma.registrar('leads', { titulo: 'Leads do site', montar });
})();
