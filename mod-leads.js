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
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  let alvoEl = null;
  let leads = [], imoveisPorId = new Map(), corretores = [];

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
      db(supabaseClient.from('lead_site').select('*')
        .order('created_at', { ascending: false }), 'carregar leads do site'),
      db(supabaseClient.from('imovel').select('id,titulo,codigo'), 'carregar imóveis'),
      db(supabaseClient.from('perfil').select('id,nome').eq('ativo', true).order('nome'), 'carregar equipe'),
    ]);
    leads = dadosLeads;
    imoveisPorId = new Map(imoveis.map(i => [i.id, i]));
    corretores = equipe;

    const pendentes = leads.filter(l => !l.atendido);
    const atendidos = leads.filter(l => l.atendido);

    const linha = l => `
      <tr class="cad-linha" data-id="${l.id}">
        <td class="cad-num">${esc(dataHora(l.created_at))}</td>
        <td><div class="cad-end-rua">${esc(l.nome)}</div>
            <div class="cad-end-sub">${esc(l.telefone)}${l.email ? ' · ' + esc(l.email) : ''}</div></td>
        <td>${esc(origemDe(l))}</td>
        <td class="cad-msg">${esc(l.mensagem || '—')}</td>
        <td>${l.corretor_id
          ? `<span class="cad-selo cad-selo-vitrine">${esc(nomeCorretor(l.corretor_id) || '—')}</span>`
          : '<span class="cad-vazio">no balcão</span>'}</td>
      </tr>`;

    const tabela = (titulo, itens, vazio) => `
      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>${esc(titulo)}<span class="ini-conta">${itens.length}</span></h3></div>
        ${itens.length ? `<div class="cad-tabela-scroll"><table class="cad-tabela">
          <thead><tr><th>Quando</th><th>Contato</th><th>Origem</th><th>Mensagem</th><th>Atribuído</th></tr></thead>
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

    alvo.querySelectorAll('.cad-linha').forEach(tr =>
      tr.addEventListener('click', () => abrirFicha(tr.dataset.id)));
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

    // Lead de teste e lead duplicado sujam a fila de quem está esperando
    // resposta, e a fila é a razão de a tela existir. Some de vez: não há
    // arquivo morto de lead, e nada mais no banco aponta pra esta linha.
    document.getElementById('leadExcluirBtn').addEventListener('click', async () => {
      if (!confirm(`Excluir o lead de ${l.nome}? A ação não pode ser desfeita.`)) return;
      await db(supabaseClient.from('lead_site').delete().eq('id', id), 'excluir lead');
      avisar('Lead excluído.');
      fecharFicha();
      await montar(alvoEl);
      if (Plataforma.atualizarSino) Plataforma.atualizarSino();
    });

    document.getElementById('leadAtenderBtn').addEventListener('click', async () => {
      const atender = !l.atendido;
      await db(supabaseClient.from('lead_site').update({ atendido: atender }).eq('id', id),
               atender ? 'marcar atendido' : 'reabrir');
      avisar(atender ? 'Marcado como atendido.' : 'Reaberto.');
      fecharFicha();
      await montar(alvoEl);
      if (Plataforma.atualizarSino) Plataforma.atualizarSino();
    });
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
