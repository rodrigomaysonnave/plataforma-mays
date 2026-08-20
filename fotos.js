// ══════════════════════════════════════════════════════════════════════
// FOTOS — envio, galeria e capa
//
// Reaproveitável: qualquer módulo que precise de galeria usa isto. Hoje é o
// imóvel; empreendimento e proprietário virão depois.
//
// Duas decisões que vêm de erro caro no sistema anterior:
//
//   1. FOTO NUNCA VAI PRO BANCO. Lá elas eram gravadas em base64 dentro do
//      Postgres, inflavam 33%, desciam inteiras em toda listagem e sozinhas
//      consumiram 4,3GB de tráfego num mês. Aqui vão pro Storage e o banco
//      guarda a URL.
//
//   2. MINIATURA É GERADA E USADA. Lá a miniatura era criada no envio e
//      nenhuma tela apontava pra ela: os cartões baixavam a foto de 1400px
//      pra desenhar 140px de altura. Aqui o thumb entra no banco junto e a
//      galeria pede ele.
// ══════════════════════════════════════════════════════════════════════

const Fotos = (() => {
  'use strict';
  const { db, esc, avisar } = Plataforma;

  const BUCKET = 'imoveis';
  const LARGURA_GRANDE = 1600;
  const LARGURA_THUMB  = 500;

  // Marca d'água em efeito "gota d'água": refrata o fundo (borra de leve a
  // própria região da foto), soma brilho especular e um aro claro na borda
  // — nunca escurece o que está atrás, só clareia. Mesmo tratamento do
  // script marca_dagua.py, que carimba o que já estava no Storage; aqui é
  // a versão que roda no navegador pra foto nova, no mesmo instante do
  // envio. Só a foto de imóvel/empreendimento passa por aqui; retrato de
  // corretor usa recortarQuadrado, função separada, e não é tocado.
  const MARCA_TAMANHO = 0.20 * 4 / 3;  // fração da largura da foto
  const MARCA_OPACIDADE = 0.30;
  let logoMaskPromise = null, logoAroPromise = null;
  function carregarImg(src) {
    return new Promise((ok, falhou) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => falhou(new Error(`não consegui carregar ${src} pra marca d'água`));
      img.src = src;
    });
  }
  function carregarMarcaDagua() {
    if (!logoMaskPromise) logoMaskPromise = carregarImg('logo-marca-mask.png');
    if (!logoAroPromise) logoAroPromise = carregarImg('logo-marca-aro.png');
    return Promise.all([logoMaskPromise, logoAroPromise]);
  }

  function brilhoEspecular(vctx, cx, cy, r, alpha) {
    const g = vctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    vctx.fillStyle = g;
    vctx.beginPath(); vctx.arc(cx, cy, r, 0, Math.PI * 2); vctx.fill();
  }

  function aplicarMarcaDagua(ctx, largura, altura, logoMask, logoAro) {
    const lw = largura * MARCA_TAMANHO;
    const lh = lw * (logoMask.height / logoMask.width);
    const x0 = (largura - lw) / 2, y0 = (altura - lh) / 2;

    const vidro = document.createElement('canvas');
    vidro.width = Math.max(1, Math.round(lw));
    vidro.height = Math.max(1, Math.round(lh));
    const vctx = vidro.getContext('2d');

    // refrata: recorta o fundo dessa região da própria foto e borra de leve
    vctx.filter = `blur(${Math.max(1.5, lw * 0.006)}px)`;
    vctx.drawImage(ctx.canvas, x0, y0, lw, lh, 0, 0, vidro.width, vidro.height);
    vctx.filter = 'none';

    // véu bem leve, só pra esfriar a cor (água, não vidro amarelado)
    vctx.fillStyle = 'rgba(240,247,253,0.12)';
    vctx.fillRect(0, 0, vidro.width, vidro.height);

    brilhoEspecular(vctx, vidro.width * 0.30, vidro.height * 0.18, vidro.width * 0.24, 0.55);
    brilhoEspecular(vctx, vidro.width * 0.335, vidro.height * 0.205, vidro.width * 0.08, 0.8);

    vctx.drawImage(logoAro, 0, 0, vidro.width, vidro.height);

    // recorta pela forma fina do logo — só o que sobrar dentro dela conta
    vctx.globalCompositeOperation = 'destination-in';
    vctx.drawImage(logoMask, 0, 0, vidro.width, vidro.height);
    vctx.globalCompositeOperation = 'source-over';

    ctx.globalAlpha = MARCA_OPACIDADE;
    ctx.drawImage(vidro, x0, y0, lw, lh);
    ctx.globalAlpha = 1;
  }

  // Redimensiona no navegador antes de subir. Foto de celular tem 4 a 8MB e
  // 4000px de largura; nenhuma tela precisa disso, e subir o original custaria
  // tempo do usuário e espaço no Storage.
  async function redimensionar(arquivo, larguraMax, qualidade, marcaDagua) {
    const [logoMask, logoAro] = marcaDagua ? await carregarMarcaDagua() : [];
    return new Promise((ok, falhou) => {
      const img = new Image();
      const url = URL.createObjectURL(arquivo);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const escala = Math.min(1, larguraMax / img.width);
        const tela = document.createElement('canvas');
        tela.width  = Math.round(img.width  * escala);
        tela.height = Math.round(img.height * escala);
        const ctx = tela.getContext('2d');
        ctx.drawImage(img, 0, 0, tela.width, tela.height);

        if (marcaDagua) aplicarMarcaDagua(ctx, tela.width, tela.height, logoMask, logoAro);

        tela.toBlob(b => b ? ok(b) : falhou(new Error('não consegui gerar o JPEG')),
                    'image/jpeg', qualidade);
      };
      img.onerror = () => { URL.revokeObjectURL(url); falhou(new Error('o arquivo não é uma imagem válida')); };
      img.src = url;
    });
  }

  async function subir(caminho, blob) {
    const { error } = await supabaseClient.storage.from(BUCKET)
      .upload(caminho, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
    if (error) throw new Error(error.message);
    return supabaseClient.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl;
  }

  // Sobe grande e miniatura, e devolve as duas URLs.
  async function enviarUma(arquivo, pasta) {
    const base = `${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Só foto de imóvel carimba. Empreendimento e LP são material do
    // condomínio/construtora ou peça de campanha — a marca ali não é dele.
    const marcaDagua = pasta === 'imoveis';
    const [grande, thumb] = await Promise.all([
      redimensionar(arquivo, LARGURA_GRANDE, 0.82, marcaDagua),
      redimensionar(arquivo, LARGURA_THUMB, 0.7, marcaDagua),
    ]);
    const [url, url_thumb] = await Promise.all([
      subir(`${base}.jpg`, grande),
      subir(`${base}_thumb.jpg`, thumb),
    ]);
    return { url, url_thumb };
  }

  // ── Retrato do corretor ────────────────────────────────────────────
  // Foto de pessoa é sempre quadrada aqui, e o corte é feito pelo sistema.
  // Se dependesse de cada um mandar no formato certo, a página do imóvel
  // teria uma foto vertical, uma horizontal e uma cortada no queixo, e o
  // admin viraria máquina de recusar por motivo técnico.
  //
  // O corte é central e um pouco acima do meio: em retrato, o rosto quase
  // nunca está no centro geométrico, está no terço de cima.
  const LADO_RETRATO = 600;
  const LADO_RETRATO_MINI = 160;
  const LADO_MINIMO = 400;   // abaixo disso a foto aparece borrada na página

  function recortarQuadrado(arquivo, lado) {
    return new Promise((ok, falhou) => {
      const img = new Image();
      const url = URL.createObjectURL(arquivo);
      img.onload = () => {
        URL.revokeObjectURL(url);
        if (Math.min(img.width, img.height) < LADO_MINIMO) {
          falhou(new Error(`a imagem tem ${img.width}x${img.height}. O menor lado precisa ter pelo menos ${LADO_MINIMO} pixels`));
          return;
        }
        const corte = Math.min(img.width, img.height);
        const x = (img.width - corte) / 2;
        const y = Math.max((img.height - corte) / 2 - corte * 0.08, 0);
        const tela = document.createElement('canvas');
        tela.width = tela.height = lado;
        tela.getContext('2d').drawImage(img, x, y, corte, corte, 0, 0, lado, lado);
        tela.toBlob(b => b ? ok(b) : falhou(new Error('não consegui gerar o JPEG')), 'image/jpeg', 0.86);
      };
      img.onerror = () => { URL.revokeObjectURL(url); falhou(new Error('o arquivo não é uma imagem válida')); };
      img.src = url;
    });
  }

  async function enviarRetrato(arquivo, pasta) {
    const base = `${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [grande, mini] = await Promise.all([
      recortarQuadrado(arquivo, LADO_RETRATO),
      recortarQuadrado(arquivo, LADO_RETRATO_MINI),
    ]);
    const [url, url_thumb] = await Promise.all([
      subir(`${base}.jpg`, grande),
      subir(`${base}_mini.jpg`, mini),
    ]);
    return { url, url_thumb };
  }

  // ── Galeria ────────────────────────────────────────────────────────
  // `dono` é { tabela, coluna, id } — assim serve para imóvel hoje e para
  // empreendimento depois, sem duplicar código.
  function montar(alvo, dono) {
    let fotos = [];

    async function carregar() {
      fotos = await db(supabaseClient.from(dono.tabela)
        .select('*').eq(dono.coluna, dono.id).order('ordem').order('created_at'),
        'carregar as fotos');
      desenhar();
    }

    function desenhar() {
      alvo.innerHTML = `
        <div class="fotos-barra">
          <label class="btn btn-primario">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            Adicionar fotos
            <input type="file" accept="image/*" multiple hidden id="fotoEntrada">
          </label>
          <span class="fotos-conta">${fotos.length ? `${fotos.length} foto${fotos.length===1?'':'s'}` : 'Nenhuma foto ainda'}</span>
          <span class="fotos-dica">A primeira é a capa. Arraste pra reordenar, ou use as setas.</span>
        </div>
        <div class="fotos-grade" id="fotosGrade">
          ${fotos.map((f, i) => `
            <figure class="foto${f.capa || (i === 0 && !fotos.some(x => x.capa)) ? ' foto-capa' : ''}" data-id="${f.id}" draggable="true">
              <img src="${esc(f.url_thumb || f.url)}" alt="${esc(f.legenda || 'Foto do imóvel')}" loading="lazy">
              ${f.capa || (i === 0 && !fotos.some(x => x.capa)) ? '<span class="foto-selo">Capa</span>' : ''}
              <figcaption>
                <button class="btn btn-mini" data-acao="capa" title="Usar como capa">Capa</button>
                <button class="btn btn-mini" data-acao="sobe" title="Mover para a esquerda">←</button>
                <button class="btn btn-mini" data-acao="desce" title="Mover para a direita">→</button>
                <button class="btn btn-mini btn-remover" data-acao="remove" title="Remover">×</button>
              </figcaption>
            </figure>`).join('')}
        </div>`;
      ligar();
    }

    function ligar() {
      alvo.querySelector('#fotoEntrada').addEventListener('change', async e => {
        const arquivos = [...e.target.files];
        if (!arquivos.length) return;
        const barra = alvo.querySelector('.fotos-conta');
        let feitas = 0;
        for (const arq of arquivos) {
          barra.textContent = `Enviando ${++feitas} de ${arquivos.length}…`;
          try {
            const { url, url_thumb } = await enviarUma(arq, dono.pasta || 'imoveis');
            await db(supabaseClient.from(dono.tabela).insert({
              [dono.coluna]: dono.id, url, url_thumb,
              ordem: fotos.length + feitas,
            }), 'gravar a foto');
          } catch (err) {
            avisar(`Falhou em "${arq.name}": ${err.message}`);
          }
        }
        e.target.value = '';
        avisar(`${feitas} foto${feitas===1?'':'s'} enviada${feitas===1?'':'s'}. Publicando no site…`);
        Publicacao.pedir();
        await carregar();
      });

      alvo.querySelectorAll('.foto').forEach(fig => {
        const id = fig.dataset.id;
        fig.querySelectorAll('[data-acao]').forEach(b => {
          b.addEventListener('click', async ev => {
            ev.preventDefault();
            const acao = b.dataset.acao;
            if (acao === 'capa') {
              await db(supabaseClient.from(dono.tabela).update({ capa: false }).eq(dono.coluna, dono.id), 'trocar a capa');
              await db(supabaseClient.from(dono.tabela).update({ capa: true }).eq('id', id), 'trocar a capa');
            } else if (acao === 'remove') {
              // Remove só o registro. O arquivo fica no Storage de propósito:
              // apagar de verdade é irreversível, e o custo de guardar é
              // centavos. Limpeza do que sobrou é tarefa separada.
              await db(supabaseClient.from(dono.tabela).delete().eq('id', id), 'remover a foto');
            } else {
              const i = fotos.findIndex(f => f.id === id);
              const j = acao === 'sobe' ? i - 1 : i + 1;
              if (j < 0 || j >= fotos.length) return;
              await Promise.all([
                db(supabaseClient.from(dono.tabela).update({ ordem: j }).eq('id', fotos[i].id), 'reordenar'),
                db(supabaseClient.from(dono.tabela).update({ ordem: i }).eq('id', fotos[j].id), 'reordenar'),
              ]);
            }
            Publicacao.pedir();
            await carregar();
          });
        });
      });

      // Arrastar solta a foto no lugar de outra — todo mundo entre as duas
      // posições reflui, então grava a ordem da grade inteira de uma vez,
      // não só das duas trocadas (diferente do botão de seta).
      let arrastandoId = null;
      alvo.querySelectorAll('.foto').forEach(fig => {
        fig.addEventListener('dragstart', () => {
          arrastandoId = fig.dataset.id;
          fig.classList.add('foto-arrastando');
        });
        fig.addEventListener('dragend', () => fig.classList.remove('foto-arrastando'));
        fig.addEventListener('dragover', ev => {
          ev.preventDefault();
          if (fig.dataset.id !== arrastandoId) fig.classList.add('foto-alvo');
        });
        fig.addEventListener('dragleave', () => fig.classList.remove('foto-alvo'));
        fig.addEventListener('drop', async ev => {
          ev.preventDefault();
          fig.classList.remove('foto-alvo');
          const destinoId = fig.dataset.id;
          if (!arrastandoId || arrastandoId === destinoId) return;
          const nova = fotos.filter(f => f.id !== arrastandoId);
          const j = nova.findIndex(f => f.id === destinoId);
          nova.splice(j, 0, fotos.find(f => f.id === arrastandoId));
          await Promise.all(nova.map((f, i) =>
            db(supabaseClient.from(dono.tabela).update({ ordem: i }).eq('id', f.id), 'reordenar')));
          Publicacao.pedir();
          await carregar();
        });
      });
    }

    carregar();
  }

  return { montar, enviarUma, enviarRetrato };
})();
