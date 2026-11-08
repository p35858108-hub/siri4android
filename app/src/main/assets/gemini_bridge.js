// Se inyecta en la web de Gemini (WebView oculto). Idempotente.
// IMPORTANTE: los selectores dependen del DOM de Google y pueden cambiar.
// Compruébalos con chrome://inspect (el WebView se puede depurar en builds debug).
(function () {
  if (window.__siriBridge) return;
  window.__siriBridge = true;

  var CFG = {
    input:    ['rich-textarea .ql-editor', 'div.ql-editor[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]', 'textarea'],
    send:     ['button.send-button', 'button[aria-label*="Send" i]', 'button[aria-label*="Enviar" i]'],
    stop:     ['button.stop', 'button[aria-label*="Stop" i]', 'button[aria-label*="Detener" i]'],
    response: ['model-response', '[data-test-id="model-response"]', '.model-response-text'],
    text:     ['message-content', '.markdown'],
    stableMs: 1500, timeoutMs: 120000, waitInputMs: 10000
  };

  function q(list, root) {
    root = root || document;
    for (var i = 0; i < list.length; i++) { var el = root.querySelector(list[i]); if (el) return el; }
    return null;
  }
  function qAll(list) {
    for (var i = 0; i < list.length; i++) { var n = document.querySelectorAll(list[i]); if (n.length) return n; }
    return [];
  }
  function post(text, done, err) {
    try { SiriBridge.onResponse(text || '', !!done, err || ''); } catch (e) {}
  }
  function clean(t) {
    return (t || '').replace(/^\s*(Gemini said|Gemini ha dicho)\s*/i, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  function lastResponse() {
    var all = qAll(CFG.response);
    if (!all.length) return { count: 0, text: '' };
    var last = all[all.length - 1];
    var node = q(CFG.text, last) || last;
    return { count: all.length, text: clean(node.innerText) };
  }
  function enabled(b) { return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true'; }

  function fill(el, text) {
    el.focus();
    if (el.isContentEditable) {
      var sel = window.getSelection(), r = document.createRange();
      r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('delete');
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } else {
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  function pressEnter(el) {
    ['keydown', 'keypress', 'keyup'].forEach(function (t) {
      el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    });
  }

  var active = null;   // limpieza de la petición en curso

  window.__siriSend = function (text) {
    if (active) active();
    var interval, observer, timeout;
    function finish() { clearInterval(interval); clearTimeout(timeout); if (observer) observer.disconnect(); active = null; }
    active = finish;

    var t0 = Date.now();
    (function waitInput() {
      var el = q(CFG.input);
      if (!el) {
        if (Date.now() - t0 > CFG.waitInputMs) {
          finish();
          var login = /accounts\.google\.com/.test(location.host) || !!document.querySelector('a[href*="accounts.google.com/ServiceLogin"], a[href*="accounts.google.com/signin"]');
          return post('', true, login ? 'LOGIN_REQUIRED' : 'INPUT_NOT_FOUND');
        }
        return setTimeout(waitInput, 250);
      }

      var base = lastResponse().count;
      fill(el, text);

      var t1 = Date.now();
      (function clickSend() {
        var b = q(CFG.send);
        if (enabled(b)) b.click();
        else if (Date.now() - t1 > 3000) pressEnter(el);
        else return setTimeout(clickSend, 100);
        watch(base);
      })();
    })();

    function watch(base) {
      var lastText = '', lastChange = Date.now();
      function tick() {
        var r = lastResponse();
        if (r.count <= base) return;                      // aún no hay respuesta nueva
        if (r.text && r.text !== lastText) { lastText = r.text; lastChange = Date.now(); post(lastText, false); }
        var generating = !!q(CFG.stop);
        if (lastText && !generating && Date.now() - lastChange >= CFG.stableMs) { finish(); post(lastText, true); }
      }
      observer = new MutationObserver(tick);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      interval = setInterval(tick, 250);
      timeout = setTimeout(function () { var t = lastText; finish(); post(t, true, t ? '' : 'TIMEOUT'); }, CFG.timeoutMs);
    }
  };
})();
