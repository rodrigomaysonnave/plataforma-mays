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

  // Redimensiona no navegador antes de subir. Foto de celular tem 4 a 8MB e
  // 4000px de largura; nenhuma tela precisa disso, e subir o original custaria
  // tempo do usuário e espaço no Storage.
  function redimensionar(arquivo, larguraMax, qualidade) {
    return new Promise((ok, falhou) => {
      const img = new Image();
      const url = URL.createObjectURL(arquivo);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const escala = Math.min(1, larguraMax / img.width);
        const tela = document.createElement('canvas');
        tela.width  = Math.round(img.width  * escala);
        tela.height = Math.round(img.height * escala);
        tela.getContext('2d').drawImage(img, 0, 0, tela.width, tela.height);
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
    const [grande, thumb] = await Promise.all([
      redimensionar(arquivo, LARGURA_GRANDE, 0.82),
      redimensionar(arquivo, LARGURA_THUMB, 0.7),
    ]);
    const [url, url_thumb] = await Promise.all([
      subir(`${base}.jpg`, grande),
      subir(`${base}_thumb.jpg`, thumb),
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
          <span class="fotos-dica">A primeira é a capa. Clique em "Capa" para trocar.</span>
        </div>
        <div class="fotos-grade" id="fotosGrade">
          ${fotos.map((f, i) => `
            <figure class="foto${f.capa || (i === 0 && !fotos.some(x => x.capa)) ? ' foto-capa' : ''}" data-id="${f.id}">
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
        avisar(`${feitas} foto${feitas===1?'':'s'} enviada${feitas===1?'':'s'}.`);
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
            await carregar();
          });
        });
      });
    }

    carregar();
  }

  return { montar, enviarUma };
})();
