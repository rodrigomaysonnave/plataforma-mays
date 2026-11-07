// ══════════════════════════════════════════════════════════════════════
// MÓDULO: ANÚNCIOS RECEBIDOS
//
// Fila do que os proprietários cadastram em maysimoveis.com/anunciar
// (migração 74). Nada daqui vai para o site sozinho: aprovar cria o
// proprietário e um imóvel em RASCUNHO, com as fotos já carimbadas, e abre
// a ficha. Publicar segue pelo caminho de sempre, que exige autorização de
// venda registrada.
//
// Quem começou e não terminou aparece embaixo: deixou nome e WhatsApp, e
// isso é um proprietário querendo anunciar.
//
// Só administrador: a tabela tem CPF e endereço residencial.
// ══════════════════════════════════════════════════════════════════════
(() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  const BUCKET = 'anuncios';
  const SITUACAO = { rascunho: 'Não terminou', em_analise: 'Em análise', aprovado: 'Aprovado', recusado: 'Recusado' };
  const FINALIDADE = { venda: 'Venda', aluguel: 'Aluguel', venda_aluguel: 'Venda e aluguel' };

  let alvoEl = null;

  const dinheiro = v => v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const dataHora = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const simNao = v => v == null ? '' : v ? 'Sim' : 'Não';
  const nomeDe = a => [a.nome, a.sobrenome].filter(Boolean).join(' ') || 'Sem nome';
  const local = a => [a.bairro, a.cidade].filter(Boolean).join(', ');
  const zap = a => `https://wa.me/55${esc(a.whatsapp)}`;
  const cpfBonito = c => c ? c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '';

  function linhaTabela(a) {
    return `
      <tr class="cad-linha" data-id="${a.id}">
        <td class="cad-num">${esc(dataHora(a.enviado_em || a.criado_em))}</td>
        <td><div class="cad-end-rua">${esc(nomeDe(a))}</div><div class="cad-end-sub">${esc(a.whatsapp || '')}</div></td>
        <td><div class="cad-end-rua">${esc(a.tipo || 'Sem tipo')}</div><div class="cad-end-sub">${esc(local(a))}</div></td>
        <td class="cad-num">${esc(dinheiro(a.valor ?? a.valor_aluguel) || 'A avaliar')}</td>
        <td class="cad-num">${Number(a.forca) || 0}%</td>
      </tr>`;
  }

  function secao(titulo, dica, itens) {
    return `
      <section class="ficha-secao an-secao">
        <div class="ficha-secao-topo"><h3>${esc(titulo)} (${itens.length})</h3><p>${esc(dica)}</p></div>
        ${itens.length ? `<div class="cad-tabela-scroll"><table class="cad-tabela">
          <thead><tr><th>Quando</th><th>Proprietário</th><th>Imóvel</th><th>Valor</th><th>Força</th></tr></thead>
          <tbody>${itens.map(linhaTabela).join('')}</tbody></table></div>`
        : '<p class="an-vazio">Nada por aqui.</p>'}
      </section>`;
  }

  async function lista() {
    alvoEl.innerHTML = '<p class="iv-carregando">Carregando…</p>';
    const todos = await db(supabaseClient.from('anuncio_proprietario')
      .select('id,situacao,criado_em,enviado_em,nome,sobrenome,whatsapp,tipo,bairro,cidade,valor,valor_aluguel,forca')
      .order('criado_em', { ascending: false }), 'carregar os anúncios recebidos');
    const de = s => todos.filter(a => a.situacao === s);
    const fila = de('em_analise');
    alvoEl.innerHTML = `
      <div class="secao-topo"><div class="secao-titulo"><div class="ponto"></div>
        <div><h2>Anúncios recebidos</h2>
        <div class="secao-meta">O que os proprietários cadastraram em maysimoveis.com/anunciar. Nada vai ao site sem a sua aprovação.</div></div></div>
      </div>
      ${secao('Para analisar', 'Clique para ver tudo e decidir.', fila)}
      ${secao('Começaram e não terminaram', 'Deixaram nome e WhatsApp. Vale uma mensagem.', de('rascunho'))}
      ${secao('Aprovados', 'Já viraram imóvel em rascunho.', de('aprovado'))}
      ${secao('Recusados', 'Não seguiram para o cadastro.', de('recusado'))}`;
    alvoEl.querySelectorAll('.cad-linha').forEach(tr => tr.addEventListener('click', () => ficha(tr.dataset.id)));
  }

  const dado = (rotulo, valor) => valor === '' || valor == null ? '' : `<div class="an-dado"><span>${esc(rotulo)}</span><b>${esc(valor)}</b></div>`;

  async function ficha(id) {
    alvoEl.innerHTML = '<p class="iv-carregando">Carregando…</p>';
    const [a, fotos] = await Promise.all([
      db(supabaseClient.from('anuncio_proprietario').select('*').eq('id', id).single(), 'carregar o anúncio'),
      db(supabaseClient.from('anuncio_foto').select('*').eq('anuncio_id', id).order('ordem'), 'carregar as fotos'),
    ]);
    let urls = [];
    if (fotos.length) {
      const r = await db(supabaseClient.storage.from(BUCKET).createSignedUrls(fotos.map(f => f.caminho), 3600), 'abrir as fotos');
      urls = r.map(x => x.signedUrl);
    }
    const analisando = a.situacao === 'em_analise';
    alvoEl.innerHTML = `
      <div class="secao-topo"><div class="secao-titulo"><div class="ponto"></div>
        <div><h2>${esc(a.tipo || 'Imóvel')}${local(a) ? ' · ' + esc(local(a)) : ''}</h2>
        <div class="secao-meta">${esc(SITUACAO[a.situacao])} · força ${Number(a.forca) || 0}% · ${esc(nomeDe(a))}</div></div></div>
        <div class="secao-acoes"><button class="btn btn-mini btn-fantasma" id="anVoltar">← Voltar</button></div>
      </div>

      ${analisando ? `
      <section class="ficha-secao an-decisao">
        <div class="an-decisao-txt"><b>Aprovar cria o proprietário e um imóvel em rascunho.</b>
          Ele não vai para o site. Revise a ficha e registre a autorização de venda antes de publicar.</div>
        <div class="an-acoes">
          <button class="btn btn-primario" id="anAprovar">Aprovar e criar imóvel</button>
          <button class="btn btn-remover" id="anRecusar">Recusar</button>
        </div>
      </section>` : ''}
      ${a.situacao === 'aprovado' && a.imovel_id ? `<div class="an-acoes an-solta"><button class="btn btn-primario" id="anAbrir">Abrir o imóvel</button></div>` : ''}
      ${a.motivo_recusa ? `<div class="iv-aviso"><b>Motivo da recusa</b>${esc(a.motivo_recusa)}</div>` : ''}

      <div class="an-grade">
        <section class="ficha-secao"><div class="ficha-secao-topo"><h3>Proprietário</h3></div>
          <div class="an-corpo">
            ${dado('Nome', nomeDe(a))}
            ${a.whatsapp ? `<div class="an-dado"><span>WhatsApp</span><b><a href="${zap(a)}" target="_blank" rel="noopener">${esc(a.whatsapp)}</a></b></div>` : ''}
            ${dado('E-mail', a.email)}${dado('CPF', cpfBonito(a.cpf))}
            ${dado('Nascimento', a.nascimento ? a.nascimento.split('-').reverse().join('/') : '')}
            ${dado('Endereço residencial', a.endereco_residencial)}
            ${dado('Declarou ser proprietário', simNao(a.declara_proprietario))}
            ${dado('Quer relatório mensal', simNao(a.aceita_relatorio))}
          </div></section>
        <section class="ficha-secao"><div class="ficha-secao-topo"><h3>Imóvel</h3></div>
          <div class="an-corpo">
            ${dado('Finalidade', FINALIDADE[a.finalidade])}${dado('Tipo', a.tipo)}
            ${dado('Endereço', [a.endereco, a.numero, a.complemento].filter(Boolean).join(', '))}
            ${dado('Bairro e cidade', [local(a), a.uf].filter(Boolean).join('/'))}${dado('CEP', a.cep)}
            ${dado('Dormitórios', a.dormitorios)}${dado('Suítes', a.suites)}${dado('Banheiros', a.banheiros)}${dado('Vagas', a.vagas)}
            ${dado('Área', a.area_util || a.area_total ? `${a.area_util || a.area_total} m²` : '')}
            ${dado('Valor de venda', dinheiro(a.valor))}${dado('Aluguel', dinheiro(a.valor_aluguel))}
            ${dado('Condomínio', dinheiro(a.condominio))}${dado('Quitado', simNao(a.quitado))}
            ${dado('Aceita financiamento', simNao(a.aceita_financiamento))}${dado('Aceita permuta', simNao(a.aceita_permuta))}
          </div></section>
      </div>

      ${a.descricao ? `<section class="ficha-secao an-secao"><div class="ficha-secao-topo"><h3>Descrição do proprietário</h3></div>
        <p class="an-texto">${esc(a.descricao)}</p></section>` : ''}

      <section class="ficha-secao an-secao"><div class="ficha-secao-topo"><h3>Fotos (${fotos.length})</h3><p>Originais, sem marca d'água.</p></div>
        ${fotos.length ? `<div class="an-fotos">${fotos.map((f, i) => `
          <a href="${esc(urls[i] || '#')}" target="_blank" rel="noopener"><img src="${esc(urls[i] || '')}" alt="${esc(f.ambiente || 'Foto')}" loading="lazy"><span>${esc(f.ambiente || '')}</span></a>`).join('')}</div>`
        : '<p class="an-vazio">O proprietário não mandou fotos.</p>'}
      </section>

      <div class="an-acoes an-solta"><button class="btn btn-mini btn-remover" id="anExcluir">Excluir este cadastro e as fotos</button></div>`;

    const liga = (i, fn) => { const b = document.getElementById(i); if (b) b.addEventListener('click', fn); };
    liga('anVoltar', lista);
    liga('anAbrir', () => Plataforma.irPara('imoveis', a.imovel_id));
    liga('anAprovar', e => aprovar(a, fotos, e.currentTarget));
    liga('anRecusar', () => recusar(a));
    liga('anExcluir', () => excluir(a, fotos));
  }

  const porNome = (lista, nome) => lista.find(x => x.nome.toLowerCase() === String(nome || '').trim().toLowerCase());

  // Tolera repetir: se cair no meio, o imóvel já criado é reaproveitado e
  // as fotos seguem de onde pararam.
  async function aprovar(a, fotos, botao) {
    if (!confirm(`Criar o imóvel em rascunho a partir do cadastro de ${nomeDe(a)}?`)) return;
    botao.disabled = true; botao.textContent = 'Criando…';
    try {
      const eu = Plataforma.perfil;
      let proprietarioId = a.proprietario_id;
      if (!proprietarioId) {
        const ja = a.cpf ? await db(supabaseClient.from('proprietario').select('id').eq('cpf_cnpj', a.cpf).limit(1), 'procurar o proprietário') : [];
        proprietarioId = ja[0] ? ja[0].id : (await db(supabaseClient.from('proprietario').insert({
          nome: nomeDe(a), telefone: a.whatsapp, email: a.email, cpf_cnpj: a.cpf, created_by: eu.id,
          obs: [a.nascimento && `Nascimento: ${a.nascimento.split('-').reverse().join('/')}`,
                a.endereco_residencial && `Residência: ${a.endereco_residencial}`, 'Cadastrado pelo site.'].filter(Boolean).join('\n'),
        }).select('id').single(), 'criar o proprietário')).id;
        await db(supabaseClient.from('anuncio_proprietario').update({ proprietario_id: proprietarioId }).eq('id', a.id), 'ligar o proprietário');
      }

      let imovelId = a.imovel_id;
      if (!imovelId) {
        const [tipos, cidades, bairros, origens] = await Promise.all([
          db(supabaseClient.from('tipo_imovel').select('id,nome'), 'carregar tipos'),
          db(supabaseClient.from('cidade').select('id,nome'), 'carregar cidades'),
          db(supabaseClient.from('bairro').select('id,nome'), 'carregar bairros'),
          db(supabaseClient.from('origem_captacao').select('id,nome'), 'carregar origens'),
        ]);
        const bairro = porNome(bairros, a.bairro), cidade = porNome(cidades, a.cidade), origem = porNome(origens, 'Proprietário procurou');
        const obs = [
          'Cadastrado pelo proprietário em maysimoveis.com/anunciar.',
          a.quitado != null && `Quitado: ${simNao(a.quitado)}`,
          !bairro && a.bairro && `Bairro informado: ${a.bairro}`,
          !cidade && a.cidade && `Cidade informada: ${a.cidade}`,
        ].filter(Boolean).join('\n');
        imovelId = (await db(supabaseClient.from('imovel').insert({
          finalidade: a.finalidade || 'venda',
          tipo_imovel_id: (porNome(tipos, a.tipo) || {}).id || null,
          titulo: [a.tipo, a.bairro && `no ${a.bairro}`].filter(Boolean).join(' ') || null,
          cidade_id: cidade ? cidade.id : null, bairro_id: bairro ? bairro.id : null,
          endereco: a.endereco, numero: a.numero, complemento: a.complemento, cep: a.cep,
          proprietario_id: proprietarioId, valor: a.valor, valor_aluguel: a.valor_aluguel,
          iptu: a.iptu, condominio: a.condominio,
          aceita_financiamento: !!a.aceita_financiamento, aceita_permuta: !!a.aceita_permuta,
          dormitorios: a.dormitorios, suites: a.suites, banheiros: a.banheiros, vagas: a.vagas,
          area_util: a.area_util, area_total: a.area_total, descricao_publica: a.descricao, obs_internas: obs,
          origem_captacao_id: origem ? origem.id : null, captado_em: new Date().toLocaleDateString('en-CA'),
          rascunho: true, publicar_no_site: false, autorizacao_venda: false, created_by: eu.id,
        }).select('id').single(), 'criar o imóvel')).id;
        await db(supabaseClient.from('anuncio_proprietario').update({ imovel_id: imovelId }).eq('id', a.id), 'ligar o imóvel');
      }

      const prontas = (await db(supabaseClient.from('imovel_foto').select('id').eq('imovel_id', imovelId), 'contar as fotos')).length;
      for (let i = prontas; i < fotos.length; i++) {
        botao.textContent = `Foto ${i + 1} de ${fotos.length}…`;
        const blob = await db(supabaseClient.storage.from(BUCKET).download(fotos[i].caminho), 'baixar a foto');
        const { url, url_thumb } = await Fotos.enviarUma(new File([blob], 'foto.jpg', { type: 'image/jpeg' }), 'imoveis');
        await db(supabaseClient.from('imovel_foto').insert({
          imovel_id: imovelId, url, url_thumb, legenda: fotos[i].ambiente, ordem: i, capa: i === 0,
        }), 'gravar a foto');
      }

      await db(supabaseClient.from('anuncio_proprietario').update({
        situacao: 'aprovado', analisado_por: eu.id, analisado_em: new Date().toISOString(),
      }).eq('id', a.id), 'concluir a aprovação');
      avisar('Imóvel criado em rascunho. Revise a ficha antes de publicar.');
      Plataforma.irPara('imoveis', imovelId);
    } catch (e) {
      console.error(e);
      avisar('A aprovação parou no meio. Clique de novo para continuar de onde parou.');
      await ficha(a.id);
    }
  }

  async function recusar(a) {
    const motivo = prompt('Motivo da recusa (fica só aqui na Plataforma):', '');
    if (motivo === null) return;
    await db(supabaseClient.from('anuncio_proprietario').update({
      situacao: 'recusado', motivo_recusa: motivo.trim().slice(0, 500) || null,
      analisado_por: Plataforma.perfil.id, analisado_em: new Date().toISOString(),
    }).eq('id', a.id), 'recusar o anúncio');
    avisar('Anúncio recusado.');
    await lista();
  }

  async function excluir(a, fotos) {
    if (!confirm(`Apagar de vez o cadastro de ${nomeDe(a)} e as fotos originais? O imóvel já criado não é afetado.`)) return;
    if (fotos.length) await db(supabaseClient.storage.from(BUCKET).remove(fotos.map(f => f.caminho)), 'apagar as fotos');
    await db(supabaseClient.from('anuncio_proprietario').delete().eq('id', a.id), 'apagar o cadastro');
    avisar('Cadastro apagado.');
    await lista();
  }

  async function montar(alvo, arg) {
    alvoEl = alvo;
    const eu = Plataforma.perfil;
    if (!eu || eu.papel !== 'admin') {
      alvo.innerHTML = `
        <div class="vazio"><div class="vazio-ico">✦</div>
          <h3>Só administrador vê os anúncios recebidos</h3>
          <p>Eles têm CPF e endereço dos proprietários.</p></div>`;
      return;
    }
    if (arg) await ficha(arg); else await lista();
  }

  Plataforma.registrar('anuncios', { titulo: 'Anúncios recebidos', montar });
})();
