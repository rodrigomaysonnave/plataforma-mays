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
// ══════════════════════════════════════════════════════════════════════

(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  let alvoEl = null;

  const dataHora = iso => new Date(iso).toLocaleString('pt-BR',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  function origemDe(l) {
    return l.origem || (l.pagina && l.pagina.startsWith('/imovel/') ? 'Ficha do imóvel' : 'Site');
  }

  async function montar(alvo) {
    alvoEl = alvo;
    const leads = await db(supabaseClient.from('lead_site').select('*')
      .order('created_at', { ascending: false }), 'carregar leads do site');

    const pendentes = leads.filter(l => !l.atendido);
    const atendidos = leads.filter(l => l.atendido);

    const linha = l => `
      <tr class="cad-linha" data-id="${l.id}">
        <td class="cad-num">${esc(dataHora(l.created_at))}</td>
        <td><div class="cad-end-rua">${esc(l.nome)}</div>
            <div class="cad-end-sub">${esc(l.telefone)}${l.email ? ' · ' + esc(l.email) : ''}</div></td>
        <td>${l.imovel_ref
          ? `<span class="cad-selo cad-selo-autorizado">${esc(l.imovel_ref)}</span>`
          : '<span class="cad-vazio">—</span>'}</td>
        <td>${esc(origemDe(l))}</td>
        <td class="cad-msg">${esc(l.mensagem || '—')}</td>
        <td>${l.atendido
          ? '<button class="btn btn-mini" data-acao="reabrir">Reabrir</button>'
          : '<button class="btn btn-mini btn-primario" data-acao="atender">Marcar atendido</button>'}</td>
      </tr>`;

    const tabela = (titulo, itens, vazio) => `
      <section class="ficha-secao">
        <div class="ficha-secao-topo"><h3>${esc(titulo)}<span class="ini-conta">${itens.length}</span></h3></div>
        ${itens.length ? `<div class="cad-tabela-scroll"><table class="cad-tabela">
          <thead><tr><th>Quando</th><th>Contato</th><th>Imóvel</th><th>Origem</th><th>Mensagem</th><th></th></tr></thead>
          <tbody>${itens.map(linha).join('')}</tbody></table></div>`
          : `<p class="ini-vazio" style="padding:18px 20px">${esc(vazio)}</p>`}
      </section>`;

    alvo.innerHTML = `
      <div class="secao-topo">
        <div class="secao-titulo"><div class="ponto"></div>
          <div><h2>Leads do site</h2>
            <div class="secao-meta">Quem preencheu o formulário na ficha do imóvel, com identificação
              da origem. Nada some daqui: o formulário grava direto no banco.</div></div>
        </div>
      </div>

      <div class="painel-numeros">
        <div class="num${pendentes.length ? ' num-destaque' : ''}"><span class="num-v">${pendentes.length}</span><span class="num-r">Aguardando resposta</span></div>
        <div class="num"><span class="num-v">${leads.length}</span><span class="num-r">Total recebido</span></div>
      </div>

      ${tabela('Aguardando resposta', pendentes, 'Nenhum lead pendente. Tudo respondido.')}
      ${tabela('Já atendidos', atendidos, 'Nenhum lead atendido ainda.')}`;

    alvo.querySelectorAll('[data-acao]').forEach(b => {
      b.addEventListener('click', async e => {
        e.stopPropagation();
        const id = b.closest('.cad-linha').dataset.id;
        const atender = b.dataset.acao === 'atender';
        await db(supabaseClient.from('lead_site').update({ atendido: atender }).eq('id', id),
                 atender ? 'marcar atendido' : 'reabrir');
        avisar(atender ? 'Marcado como atendido.' : 'Reaberto.');
        await montar(alvo);
        if (Plataforma.atualizarSino) Plataforma.atualizarSino();
      });
    });
  }

  Plataforma.registrar('leads', { titulo: 'Leads do site', montar });
})();
