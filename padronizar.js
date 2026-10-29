// ══════════════════════════════════════════════════════════════════════
// PADRONIZAR — ajuste automático de luz e cor das fotos, sem IA
//
// Roda no navegador, sobre um canvas, e não custa nada. Só mexe em luz e
// cor: nunca tira nem acrescenta nada da foto, então não tem como "inventar"
// o imóvel (o risco que fez a gente descartar a IA para isto).
//
// Cada foto é medida e levada para o MESMO alvo (branco neutro, preto e
// branco no lugar, tom médio parecido). É isso que deixa as fotos de um
// imóvel com cara de série, e não cada uma de um jeito.
//
// Todos os ajustes são contidos de propósito: foto de imóvel exagerada
// parece falsa, e quem visita sente a diferença na porta.
// ══════════════════════════════════════════════════════════════════════

const Padronizar = (() => {
  'use strict';

  const TOM_MEDIO  = 0.47;   // mediana de luz que se busca (0 preto, 1 branco)
  const FORCA_COR  = 0.6;    // quanto do desvio de cor se corrige (1 = tudo)
  const CONTRASTE  = 0.22;   // força da curva em S
  const VIBRACAO   = 0.14;   // realce de cor, maior nas cores apagadas
  const NITIDEZ    = 0.22;   // reforço de borda, só na foto grande

  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

  // Mede numa cópia pequena: a estatística não muda e fica 50x mais rápido.
  function medir(tela) {
    const larg = Math.min(240, tela.width);
    const alt = Math.max(1, Math.round(tela.height * larg / tela.width));
    const mini = document.createElement('canvas');
    mini.width = larg; mini.height = alt;
    const mctx = mini.getContext('2d');
    mctx.drawImage(tela, 0, 0, larg, alt);
    const px = mctx.getImageData(0, 0, larg, alt).data;

    const hist = new Uint32Array(256);
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      hist[l]++;
      // Cor medida só nos tons médios: janela estourada e sombra preta não
      // dizem nada sobre a cor da luz do ambiente.
      if (l > 30 && l < 225) { sr += px[i]; sg += px[i + 1]; sb += px[i + 2]; n++; }
    }
    const total = px.length / 4;
    const percentil = p => {
      let acc = 0;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * p) return v; }
      return 255;
    };
    return {
      preto: percentil(0.005), branco: percentil(0.995), mediana: percentil(0.5),
      media: n ? [sr / n, sg / n, sb / n] : [128, 128, 128],
    };
  }

  // Uma tabela por canal junta cor, níveis, tom médio e contraste: o ajuste
  // pesado é calculado 256 vezes, e não uma vez por pixel.
  function tabelas(m) {
    const cinza = (m.media[0] + m.media[1] + m.media[2]) / 3;
    const ganho = m.media.map(c => limitar(1 + FORCA_COR * (cinza / Math.max(c, 1) - 1), 0.88, 1.15));

    // Níveis sem esticar demais: foto já boa quase não muda.
    const preto  = Math.min(m.preto, 25) / 255;
    const branco = Math.max(m.branco, 215) / 255;
    const nivel = v => limitar((v - preto) / (branco - preto), 0, 1);

    // Gama que leva a mediana ao tom médio. Clareia mais do que escurece:
    // foto escura é o defeito comum; foto clara demais quase nunca é.
    const med = limitar(nivel(m.mediana / 255), 0.04, 0.96);
    const gama = limitar(Math.log(TOM_MEDIO) / Math.log(med), 0.62, 1.2);

    return ganho.map(g => {
      const t = new Uint8ClampedArray(256);
      for (let x = 0; x < 256; x++) {
        let v = nivel(limitar((x / 255) * g, 0, 1));
        v = Math.pow(v, gama);
        v = v + CONTRASTE * (v * v * (3 - 2 * v) - v);   // S suave
        t[x] = Math.round(v * 255);
      }
      return t;
    });
  }

  function nitidez(d, larg, alt) {
    const orig = new Uint8ClampedArray(d);
    const linha = larg * 4;
    for (let y = 1; y < alt - 1; y++) {
      for (let x = 1; x < larg - 1; x++) {
        const i = y * linha + x * 4;
        for (let c = 0; c < 3; c++) {
          const p = orig[i + c];
          const borda = 4 * p - orig[i + c - 4] - orig[i + c + 4] - orig[i + c - linha] - orig[i + c + linha];
          d[i + c] = p + NITIDEZ * borda;
        }
      }
    }
  }

  // Ajusta o canvas no lugar. `comNitidez` só na foto grande: na miniatura o
  // reforço vira serrilhado.
  function ajustar(tela, comNitidez = true) {
    const ctx = tela.getContext('2d');
    const [tr, tg, tb] = tabelas(medir(tela));
    const img = ctx.getImageData(0, 0, tela.width, tela.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let r = tr[d[i]], g = tg[d[i + 1]], b = tb[d[i + 2]];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      const f = 1 + VIBRACAO * (1 - sat);
      d[i] = l + (r - l) * f; d[i + 1] = l + (g - l) * f; d[i + 2] = l + (b - l) * f;
    }
    if (comNitidez) nitidez(d, tela.width, tela.height);
    ctx.putImageData(img, 0, 0);
    return tela;
  }

  // Foto já no Storage → canvas. crossOrigin porque sem ele o canvas fica
  // "contaminado" e o navegador recusa gerar o JPEG de volta.
  function carregar(url) {
    return new Promise((ok, falhou) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const tela = document.createElement('canvas');
        tela.width = img.naturalWidth; tela.height = img.naturalHeight;
        tela.getContext('2d').drawImage(img, 0, 0);
        ok(tela);
      };
      img.onerror = () => falhou(new Error('não consegui abrir a foto'));
      img.src = url + (url.includes('?') ? '&' : '?') + 'padronizar=1';
    });
  }

  function reduzir(tela, larguraMax) {
    const escala = Math.min(1, larguraMax / tela.width);
    const nova = document.createElement('canvas');
    nova.width = Math.round(tela.width * escala);
    nova.height = Math.round(tela.height * escala);
    nova.getContext('2d').drawImage(tela, 0, 0, nova.width, nova.height);
    return nova;
  }

  const jpeg = (tela, qualidade) => new Promise((ok, falhou) =>
    tela.toBlob(b => b ? ok(b) : falhou(new Error('não consegui gerar o JPEG')), 'image/jpeg', qualidade));

  // Foto do Storage → versão padronizada, grande e miniatura, ainda sem subir.
  async function processar(url, larguraThumb) {
    const grande = ajustar(await carregar(url));
    const thumb = reduzir(grande, larguraThumb);
    const [blobGrande, blobThumb] = await Promise.all([jpeg(grande, 0.86), jpeg(thumb, 0.72)]);
    return { grande: blobGrande, thumb: blobThumb };
  }

  return { ajustar, processar };
})();
