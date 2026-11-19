// ══════════════════════════════════════════════════════════════════════
// APROVAÇÃO DO PROPRIETÁRIO — bloco da ficha do imóvel     (migração 86)
//
// Fluxo decidido em 18/11/2026: você revisa o imóvel, clica "Enviar ao
// proprietário", ele recebe o anúncio por e-mail e aprova. A aprovação
// vale como autorização de intermediação sem exclusividade e publica o
// imóvel sozinha; quando a página abre no site, ele recebe a confirmação
// com a cópia do termo. Quem envia e grava é a função
// aprovacao-proprietario; aqui só se lê o histórico e se aperta o botão.
//
// Só administrador: o termo aceito guarda IP e e-mail.
// ══════════════════════════════════════════════════════════════════════

const Aprovacao = (() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  const quando = iso => iso ? new Date(iso).toLocaleString('pt-BR',
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const dia = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '';

  async function chamar(corpo) {
    const { data, error } = await supabaseClient.functions.invoke('aprovacao-proprietario', { body: corpo });
    let motivo = data && data.erro;
    if (error) {
      motivo = error.message;
      if (error.context && typeof error.context.json === 'function') {
        try { const c = await error.context.json(); if (c && c.erro) motivo = c.erro; } catch (e) { /* mantém */ }
      }
    }
    if (motivo) throw new Error(motivo);
    return data;
  }

  function situacao(a) {
    const vencido = a.situacao === 'enviado' && Date.parse(a.expira_em) < Date.now();
    if (a.situacao === 'aprovado') return {
      classe: 'apr-ok', titulo: 'Aprovado pelo proprietário',
      texto: `${esc(a.email)} aprovou e aceitou o termo em ${quando(a.respondido_em)}${a.ip ? `, do IP ${esc(a.ip)}` : ''}. ` +
        (a.ensaio ? 'Ensaio: não publicou.' : a.no_ar_em ? `Página no ar e confirmação enviada em ${quando(a.no_ar_em)}.`
          : 'Esperando a página abrir no site para mandar a confirmação a ele.'),
    };
    if (a.situacao === 'ajuste') return {
      classe: a.resolvido_em ? 'apr-neutro' : 'apr-alerta',
      titulo: a.resolvido_em ? 'Ajuste pedido (já reenviado)' : 'O proprietário pediu ajuste',
      texto: `Em ${quando(a.respondido_em)}: “${esc(a.comentario)}”` +
        (a.resolvido_em ? '' : '<br>Corrija a ficha, salve e envie de novo. O link antigo deixa de valer.'),
    };
    if (vencido) return { classe: 'apr-neutro', titulo: 'Link vencido', texto: `Enviado para ${esc(a.email)} em ${dia(a.enviado_em)} e não respondido em 30 dias.` };
    if (a.situacao === 'cancelado') return { classe: 'apr-neutro', titulo: 'Substituído por um envio mais novo', texto: `Enviado para ${esc(a.email)} em ${dia(a.enviado_em)}.` };
    return {
      classe: 'apr-espera', titulo: 'Esperando o proprietário',
      texto: `Enviado para ${esc(a.email)} em ${quando(a.enviado_em)}. ` +
        (a.aberto_em ? `Ele abriu o link em ${quando(a.aberto_em)}.` : 'Ele ainda não abriu o link.') +
        ` Vale até ${dia(a.expira_em)}.`,
    };
  }

  async function montar(el, imovelId) {
    if (!el) return;
    el.innerHTML = '<p class="campo-dica">Carregando…</p>';
    let lista;
    try {
      lista = await db(supabaseClient.from('aprovacao_proprietario').select('*')
        .eq('imovel_id', imovelId).order('enviado_em', { ascending: false }).limit(6), 'carregar as aprovações');
    } catch (e) { el.innerHTML = '<p class="campo-dica">Não consegui carregar o histórico de aprovação.</p>'; return; }

    const atual = lista[0];
    const s = atual && situacao(atual);
    const jaAprovou = atual && atual.situacao === 'aprovado';
    el.innerHTML = `
      ${s ? `<div class="apr-caixa ${s.classe}"><b>${s.titulo}</b><p>${s.texto}</p>
        ${jaAprovou && atual.termo_texto ? `<details class="apr-termo"><summary>Ver o termo aceito</summary><div>${atual.termo_texto}</div></details>` : ''}</div>`
        : '<p class="campo-dica">Ainda não foi enviado ao proprietário.</p>'}
      <div class="apr-acoes">
        <button class="btn ${jaAprovou ? '' : 'btn-primario'}" type="button" id="aprEnviar">${
          !atual ? 'Enviar ao proprietário para aprovar' : jaAprovou ? 'Pedir nova aprovação' : 'Enviar de novo ao proprietário'}</button>
        <button class="btn btn-fantasma btn-mini" type="button" id="aprPrevia">Ver o e-mail (manda uma prévia para você)</button>
      </div>
      <p class="campo-dica">Ele recebe o anúncio <b>como está salvo</b>. Salve antes as mudanças. Ao aprovar, ele aceita o termo de autorização sem exclusividade e o imóvel vai ao ar sozinho.</p>
      ${lista.length > 1 ? `<details class="apr-historico"><summary>Envios anteriores (${lista.length - 1})</summary><ul>${
        lista.slice(1).map(a => { const x = situacao(a); return `<li><b>${x.titulo}</b>: ${x.texto}</li>`; }).join('')}</ul></details>` : ''}`;

    el.querySelector('#aprEnviar').addEventListener('click', async e => {
      const b = e.currentTarget;
      if (!confirm(jaAprovou
        ? 'Ele já aprovou. Mandar um novo pedido de aprovação mesmo assim?'
        : 'Mandar agora o anúncio salvo para o proprietário aprovar?')) return;
      b.disabled = true; b.textContent = 'Enviando…';
      try {
        const r = await chamar({ acao: 'enviar', imovel_id: imovelId });
        avisar(`Enviado para ${r.email}.`);
        await montar(el, imovelId);
        mostrarWhatsapp(el, r);
        Plataforma.atualizarSino();
      } catch (err) {
        avisar(err.message);
        b.disabled = false; b.textContent = 'Tentar de novo';
      }
    });

    el.querySelector('#aprPrevia').addEventListener('click', async e => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const r = await chamar({ acao: 'previa', imovel_id: imovelId, qual: 'pedido' });
        avisar(`Prévia enviada para ${r.para}.`);
      } catch (err) { avisar(err.message); }
      b.disabled = false;
    });
  }

  // Logo depois de enviar: o mesmo link pelo WhatsApp. No Gmail, e-mail
  // automático às vezes cai na aba Promoções e o proprietário não vê. O
  // link não fica gravado; some ao sair da ficha.
  function mostrarWhatsapp(el, r) {
    const fone = String(r.telefone || '').replace(/\D/g, '').replace(/^55/, '');
    const texto = `Olá${r.nome ? ', ' + r.nome : ''}! O anúncio do ${r.titulo} está pronto. ` +
      `Mandei também por e-mail. Dá uma olhada e aprova por aqui: ${r.link}`;
    const caixa = document.createElement('div');
    caixa.className = 'apr-caixa apr-espera';
    caixa.innerHTML = `<b>Avise também pelo WhatsApp</b>
      <p>E-mail automático às vezes cai na aba Promoções do Gmail. Mandando o link pelo WhatsApp ele não passa batido.</p>
      <div class="apr-acoes" style="margin-top:8px">
        ${fone.length >= 10 ? `<a class="btn btn-primario" target="_blank" rel="noopener"
          href="https://wa.me/55${fone}?text=${encodeURIComponent(texto)}">Mandar no WhatsApp</a>` : ''}
        <button class="btn" type="button" data-copiar>Copiar mensagem com o link</button>
      </div>
      ${fone.length >= 10 ? '' : '<p>O proprietário não tem telefone cadastrado. Copie a mensagem e mande por onde você fala com ele.</p>'}`;
    el.prepend(caixa);
    caixa.querySelector('[data-copiar]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(texto); avisar('Mensagem copiada.'); }
      catch (e) { prompt('Copie a mensagem:', texto); }
    });
  }

  return { montar };
})();
