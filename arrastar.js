// ══════════════════════════════════════════════════════════════════════
// ARRASTAR PARA REORDENAR
//
// Nasceu dentro do módulo Site, para a ordem dos reels e dos vídeos. Agora
// serve também às listas das Configurações (etapas do funil, bairros, tipos),
// então virou ajudante, em vez de existir copiado em dois lugares e ser
// corrigido só em um.
//
// Armadilhas já vividas, registradas para não repetir:
//   1. o arrastar NATIVO do HTML não dispara neste ambiente. Nenhum
//      dragstart acontece. Por isso tudo é feito com eventos de ponteiro.
//   2. com captura de ponteiro na alça, mover a linha no DOM leva a alça
//      junto e a captura se perde no meio do gesto. Por isso os ouvintes
//      ficam no DOCUMENTO, não no elemento.
//   3. a peça precisa ACOMPANHAR o cursor, não pular de lugar. O segredo é
//      medir a posição antes e depois de cada troca no DOM e compensar a
//      diferença: sem isso ela salta de debaixo do dedo quando os vizinhos
//      se reorganizam.
// ══════════════════════════════════════════════════════════════════════

const Arrastar = (() => {
  'use strict';

  // lista    — o container
  // seletor  — o que conta como peça arrastável (as demais linhas são ignoradas)
  // alca     — o que se agarra dentro da peça
  // grudado  — opcional: devolve um elemento que precisa acompanhar a peça
  //            logo abaixo dela (o caso dos subtipos, que pertencem ao pai)
  // aoSoltar — recebe a nova ordem de data-id. Só é chamado se mudou algo.
  function ordenar({ lista, seletor, alca, grudado, aoSoltar }) {
    lista.querySelectorAll(alca).forEach(pega => {
      pega.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        const peca = pega.closest(seletor);
        if (!peca) return;
        const irmaos = () => [...lista.querySelectorAll(seletor)];
        const ordemInicial = irmaos().map(x => x.dataset.id).join(',');

        const inicioY = ev.clientY;
        let correcao = 0;              // compensa o que o DOM move sob a peça
        peca.classList.add('arrastando');
        document.body.style.userSelect = 'none';

        const desenhar = y => {
          peca.style.transform = 'translateY(' + (y - inicioY + correcao) + 'px)';
        };

        const mover = e => {
          desenhar(e.clientY);
          for (const outro of irmaos()) {
            if (outro === peca) continue;
            const c = outro.getBoundingClientRect();
            if (e.clientY < c.top || e.clientY > c.bottom) continue;
            const vizinho = e.clientY < c.top + c.height / 2 ? outro : proximaPeca(outro);
            if (vizinho === peca) break;
            const antes = peca.getBoundingClientRect().top;
            lista.insertBefore(peca, vizinho);
            const filho = grudado && grudado(peca);
            if (filho) peca.after(filho);
            const depois = peca.getBoundingClientRect().top;
            correcao += antes - depois;
            desenhar(e.clientY);
            break;
          }
        };

        // O irmão seguinte pode não ser uma peça (linha de subtipo, por
        // exemplo). Inserir antes dele deixaria a peça no meio do bloco do
        // vizinho, então o salto é até a próxima peça de verdade.
        function proximaPeca(de) {
          let n = de.nextElementSibling;
          while (n && !n.matches(seletor)) n = n.nextElementSibling;
          return n;
        }

        const soltar = async () => {
          document.removeEventListener('pointermove', mover);
          document.removeEventListener('pointerup', soltar);
          document.removeEventListener('pointercancel', soltar);
          peca.classList.remove('arrastando');
          peca.style.transform = '';
          document.body.style.userSelect = '';
          const ids = irmaos().map(x => x.dataset.id);
          if (ids.join(',') === ordemInicial) return;
          await aoSoltar(ids);
        };

        document.addEventListener('pointermove', mover);
        document.addEventListener('pointerup', soltar);
        document.addEventListener('pointercancel', soltar);
      });
    });
  }

  return { ordenar };
})();
