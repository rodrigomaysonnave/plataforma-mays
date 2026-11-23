// Tema da tela (escuro ou claro). Carrega no <head>, antes do CSS pintar,
// para não piscar escuro quando a pessoa escolheu claro. A escolha fica
// neste aparelho: cada um usa o que prefere no seu computador ou celular.
(function () {
  var CHAVE = 'plat_tema';
  function aplicar(t) {
    if (t === 'claro') document.documentElement.setAttribute('data-tema', 'claro');
    else document.documentElement.removeAttribute('data-tema');
  }
  var salvo = null;
  try { salvo = localStorage.getItem(CHAVE); } catch (e) {}
  aplicar(salvo);
  window.PlatTema = {
    atual: function () { return document.documentElement.getAttribute('data-tema') === 'claro' ? 'claro' : 'escuro'; },
    definir: function (t) {
      aplicar(t);
      try { localStorage.setItem(CHAVE, t); } catch (e) {}
    }
  };
})();
