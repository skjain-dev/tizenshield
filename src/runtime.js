// Injected by TizenBrew into every page (and frame) the module opens.
// Targets the Tizen 6.5 web engine (Chromium 85): no optional chaining, no innerHTML (Trusted Types),
// styles via constructable sheets so a page's CSP can't block them.
(function () {
  'use strict';
  // TizenBrew evaluates this in every execution context, including isolated worlds that share the page's DOM
  // but not its globals. Adopted sheets live on the shared document, so a marker sheet makes the first context
  // (the page's main world) the only one that runs.
  var MARKER = 'tizen-shield-marker';
  if (document.adoptedStyleSheets.some(function (s) { return s.cssRules[0] && s.cssRules[0].selectorText === MARKER; })) return;
  var marker = new CSSStyleSheet();
  marker.insertRule(MARKER + '{}');
  document.adoptedStyleSheets = document.adoptedStyleSheets.concat([marker]);

  var F = /*__FILTERS__*/null;
  var HOME = 'https://search.brave.com/';
  var SEARCH = 'https://search.brave.com/search?q=';
  var BOOKMARKS = [
    ['Brave Search', HOME],
    ['Wikipedia', 'https://www.wikipedia.org/'],
    ['Reddit', 'https://old.reddit.com/'],
    ['Hacker News', 'https://news.ycombinator.com/'],
    ['Google News', 'https://news.google.com/'],
    ['IMDb', 'https://m.imdb.com/']
  ];

  var TOP = window.top === window;
  var host = location.hostname.toLowerCase();
  if (!host) { try { host = window.parent.location.hostname.toLowerCase(); } catch (e) { /* cross-origin about:blank */ } }

  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem('tizenshield:' + k);
      localStorage.setItem('tizenshield:' + k, v);
    } catch (e) { return null; }
  }
  var shieldsOn = !!F && store('shields') !== 'off';

  // ---------- network blocking ----------
  function hostSet(s) { return new Set(s ? s.split('\n') : []); }
  function suffixes(h) {
    var out = [];
    while (h) { out.push(h); var d = h.indexOf('.'); h = d < 0 ? '' : h.slice(d + 1); }
    return out;
  }
  // ponytail: two/three-label guess instead of the Public Suffix List; misjudges shared hosts like *.github.io
  function base(h) {
    var p = h.split('.');
    var n = p.length > 2 && p[p.length - 1].length === 2 && p[p.length - 2].length <= 3 ? 3 : 2;
    return p.slice(-n).join('.');
  }
  var pageBase = base(host);
  var N = shieldsOn ? hostSet(F.n) : new Set();
  var T = shieldsOn ? hostSet(F.t) : new Set();
  var E = shieldsOn ? hostSet(F.e) : new Set();
  var blockedCount = 0;

  function isBlocked(url) {
    if (!shieldsOn || !url) return false;
    var u;
    try { u = new URL(String(url), location.href); } catch (e) { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    var h = u.hostname.toLowerCase(), s = suffixes(h), i;
    for (i = 0; i < s.length; i++) if (E.has(s[i])) return false;
    var third = base(h) !== pageBase;
    for (i = 0; i < s.length; i++) {
      if (N.has(s[i]) || (third && T.has(s[i]))) { blockedCount++; return true; }
    }
    return false;
  }

  function fireError(el) { setTimeout(function () { el.dispatchEvent(new Event('error')); }, 0); }

  if (shieldsOn) {
    var origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (input) {
        var url = typeof input === 'string' ? input : input && input.url;
        if (isBlocked(url)) return Promise.reject(new TypeError('Failed to fetch'));
        return origFetch.apply(this, arguments);
      };
    }

    var xp = XMLHttpRequest.prototype, origOpen = xp.open, origSend = xp.send;
    xp.open = function (method, url) {
      this.__tsBlocked = isBlocked(url);
      return origOpen.apply(this, arguments);
    };
    xp.send = function () {
      if (!this.__tsBlocked) return origSend.apply(this, arguments);
      var x = this;
      setTimeout(function () { x.dispatchEvent(new Event('error')); x.dispatchEvent(new Event('loadend')); }, 0);
    };

    if (navigator.sendBeacon) {
      var origBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function (url, data) { return isBlocked(url) ? true : origBeacon(url, data); };
    }

    var SRC_TYPES = [HTMLScriptElement, HTMLIFrameElement, HTMLImageElement];
    SRC_TYPES.forEach(function (C) {
      var d = Object.getOwnPropertyDescriptor(C.prototype, 'src');
      if (!d || !d.set) return;
      Object.defineProperty(C.prototype, 'src', {
        configurable: true,
        enumerable: d.enumerable,
        get: d.get,
        set: function (v) {
          if (isBlocked(v)) { if (this instanceof HTMLScriptElement) fireError(this); return; }
          d.set.call(this, v);
        }
      });
    });
    var origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (typeof name === 'string' && name.toLowerCase() === 'src' &&
          SRC_TYPES.some(function (C) { return this instanceof C; }, this) && isBlocked(value)) {
        if (this instanceof HTMLScriptElement) fireError(this);
        return;
      }
      return origSetAttr.apply(this, arguments);
    };

    // Parser-inserted tags: the observer runs before the parser executes a script, so retyping it stops it.
    new MutationObserver(function (records) {
      records.forEach(function (r) {
        r.addedNodes.forEach(function (el) {
          if (el.nodeType !== 1 || !el.getAttribute) return;
          var src = el.getAttribute('src');
          if (!src || !isBlocked(src)) return;
          if (el.tagName === 'SCRIPT') el.type = 'javascript/blocked';
          if (el.tagName === 'SCRIPT' || el.tagName === 'IFRAME') el.remove();
        });
      });
    }).observe(document, { childList: true, subtree: true });

    // ---------- cosmetic filtering ----------
    var hs = suffixes(host), skip = new Set(), extra = [];
    hs.forEach(function (h) {
      if (F.x[h]) F.x[h].split('\n').forEach(function (s) { skip.add(s); });
      if (F.s[h]) extra = extra.concat(F.s[h].split('\n'));
    });
    var sels = (F.g ? F.g.split('\n') : []).concat(extra).filter(function (s) { return !skip.has(s); });
    // ponytail: every generic selector in one sheet; switch to uBO-style lazy matching if pages feel sluggish
    adopt(hideSheet(sels));
  }

  function hideSheet(selectors) {
    var sheet = new CSSStyleSheet();
    for (var i = 0; i < selectors.length; i += 25) {
      var group = selectors.slice(i, i + 25);
      try { sheet.insertRule(group.join(',') + '{display:none!important}', sheet.cssRules.length); }
      catch (e) {
        // One selector the engine doesn't know drops the whole group, so retry them one by one.
        group.forEach(function (s) {
          try { sheet.insertRule(s + '{display:none!important}', sheet.cssRules.length); } catch (e2) { /* unsupported */ }
        });
      }
    }
    return sheet;
  }
  function adopt(sheet, target) {
    target = target || document;
    target.adoptedStyleSheets = target.adoptedStyleSheets.concat([sheet]);
  }

  // Popups can't open on a TV and are mostly ads: same-site ones navigate in place, the rest are dropped.
  window.open = function (url) {
    if (!url || isBlocked(url)) return null;
    try {
      var u = new URL(String(url), location.href);
      if (!shieldsOn || base(u.hostname) === pageBase) (TOP ? location : window.top.location).assign(u.href);
    } catch (e) { /* bad url */ }
    return null;
  };

  if (!TOP) return;

  // ---------- remote-control UI (top frame only) ----------
  var KEYCODES = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter', 65376: 'enter', 10009: 'back',
    65385: 'back', 27: 'back', 403: 'red', 427: 'pageup', 428: 'pagedown', 33: 'pageup', 34: 'pagedown' };
  var KEYNAMES = { ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', Enter: 'enter',
    Escape: 'back', ColorF0Red: 'red', PageUp: 'pageup', PageDown: 'pagedown' };

  var UI_CSS = [
    ':host{all:initial}',
    '.cursor{position:fixed;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;',
    'background:rgba(255,255,255,.35);border:3px solid #fb542b;box-shadow:0 0 8px rgba(0,0,0,.6);transition:opacity .4s}',
    '.cursor.idle{opacity:.35}.cursor.off{display:none}',
    '.panel{position:fixed;left:50%;top:60px;transform:translateX(-50%);width:1100px;max-width:92vw;padding:28px;',
    'background:#1e2029;color:#f0f0f0;border-radius:18px;box-shadow:0 12px 48px rgba(0,0,0,.7);',
    'font:24px/1.3 system-ui,sans-serif;pointer-events:auto}',
    '.panel[hidden]{display:none}',
    '.url{box-sizing:border-box;width:100%;padding:16px 20px;font:inherit;color:#fff;background:#2c2f3a;',
    'border:3px solid #444;border-radius:12px;outline:none}',
    '.row{display:flex;flex-wrap:wrap;gap:14px;margin-top:20px}',
    '.btn{padding:14px 22px;background:#2c2f3a;border:3px solid transparent;border-radius:12px;color:#f0f0f0}',
    '.f{border-color:#fb542b!important;background:#3a3d4a}',
    '.label{margin-top:24px;color:#9aa0ad;font-size:20px}',
    '.toast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);padding:14px 24px;background:#1e2029;',
    'color:#f0f0f0;border-radius:12px;font:22px system-ui,sans-serif;opacity:0;transition:opacity .4s}',
    '.toast.show{opacity:.95}'
  ].join('');

  var shadow, cursor, panel, urlInput, toastEl, items = [], focus = 0;
  var cx = window.innerWidth / 2, cy = window.innerHeight / 2, speed = 0, lastMove = 0, idleTimer = 0, toastTimer = 0;
  var cursorOn = store('cursor') !== 'off';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function mount() {
    var hostEl = document.createElement('tizen-shield-ui');
    // Inline !important beats any cosmetic rule a filter list might accidentally aim at our element.
    [['display', 'block'], ['position', 'fixed'], ['left', '0'], ['top', '0'], ['width', '100vw'],
      ['height', '100vh'], ['z-index', '2147483647'], ['pointer-events', 'none']]
      .forEach(function (p) { hostEl.style.setProperty(p[0], p[1], 'important'); });
    shadow = hostEl.attachShadow({ mode: 'closed' });
    var sheet = new CSSStyleSheet();
    UI_CSS.split('}').forEach(function (r) { if (r.trim()) sheet.insertRule(r + '}', sheet.cssRules.length); });
    adopt(sheet, shadow);

    cursor = el('div', 'cursor' + (cursorOn ? '' : ' off'));
    panel = el('div', 'panel');
    panel.hidden = true;
    toastEl = el('div', 'toast');
    shadow.appendChild(cursor);
    shadow.appendChild(panel);
    shadow.appendChild(toastEl);
    document.documentElement.appendChild(hostEl);
    // Some SPAs rebuild <html>'s children; put the UI back if it gets swept away.
    new MutationObserver(function () {
      if (!hostEl.isConnected) document.documentElement.appendChild(hostEl);
    }).observe(document.documentElement, { childList: true });
    moveCursor(0, 0);
    if (store('hinted') !== '1') { store('hinted', '1'); toast('Red button: address bar & menu · arrows move the pointer'); }
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3500);
  }

  // ---------- pointer ----------
  function moveCursor(dx, dy) {
    var w = window.innerWidth, h = window.innerHeight, edge = 4;
    var nx = cx + dx, ny = cy + dy;
    if (nx < edge || nx > w - edge || ny < edge || ny > h - edge) {
      scrollAt(nx < edge ? -1 : nx > w - edge ? 1 : 0, ny < edge ? -1 : ny > h - edge ? 1 : 0, 0.3);
    }
    cx = Math.max(edge, Math.min(w - edge, nx));
    cy = Math.max(edge, Math.min(h - edge, ny));
    cursor.style.transform = 'translate(' + cx + 'px,' + cy + 'px)';
    cursor.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { cursor.classList.add('idle'); }, 3000);
  }

  function scrollAt(dirX, dirY, fraction) {
    var target = document.elementFromPoint(cx, cy);
    var dx = dirX * window.innerWidth * fraction, dy = dirY * window.innerHeight * fraction;
    for (var n = target; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      var cs = getComputedStyle(n);
      var canY = dy && /auto|scroll/.test(cs.overflowY) && n.scrollHeight > n.clientHeight;
      var canX = dx && /auto|scroll/.test(cs.overflowX) && n.scrollWidth > n.clientWidth;
      if (canY || canX) { n.scrollBy({ left: dx, top: dy, behavior: 'smooth' }); return; }
    }
    window.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
  }

  function isEditable(n) {
    if (!n) return false;
    if (n.isContentEditable || n.tagName === 'TEXTAREA') return true;
    return n.tagName === 'INPUT' &&
      !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(n.type || '');
  }

  function deepActive() {
    var a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  function clickAt(x, y) {
    var t = document.elementFromPoint(x, y);
    while (t && t.shadowRoot) {
      var inner = t.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === t) break;
      t = inner;
    }
    if (!t) return;
    var link = t.closest && t.closest('a[target]');
    if (link && link.target !== '_self') link.target = '_self';
    if (isEditable(t)) { t.focus(); return; } // focusing a field opens the TV keyboard
    var o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 };
    var po = Object.assign({ pointerType: 'mouse', isPrimary: true, pointerId: 1 }, o);
    t.dispatchEvent(new PointerEvent('pointerdown', po));
    t.dispatchEvent(new MouseEvent('mousedown', o));
    if (t.focus) t.focus({ preventScroll: true });
    o.buttons = 0; po.buttons = 0;
    t.dispatchEvent(new PointerEvent('pointerup', po));
    t.dispatchEvent(new MouseEvent('mouseup', o));
    t.dispatchEvent(new MouseEvent('click', o));
  }

  // ---------- panel ----------
  function toUrl(text) {
    text = (text || '').trim();
    if (!text) return '';
    if (/^https?:\/\//i.test(text)) return text;
    if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return 'https://' + text;
    return SEARCH + encodeURIComponent(text);
  }
  function go(text) { var u = toUrl(text); if (u) location.assign(u); }

  function button(label, action) {
    var b = el('div', 'btn', label);
    b.__action = action;
    items.push(b);
    return b;
  }

  function renderPanel() {
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    items = [];
    urlInput = el('input', 'url');
    urlInput.type = 'text';
    urlInput.value = location.href;
    urlInput.placeholder = 'Search or type a web address';
    urlInput.__action = function () { urlInput.focus(); urlInput.select(); };
    items.push(urlInput);
    panel.appendChild(urlInput);

    var nav = el('div', 'row');
    nav.appendChild(button('◀ Back', function () { history.back(); }));
    nav.appendChild(button('Forward ▶', function () { history.forward(); }));
    nav.appendChild(button('Reload', function () { location.reload(); }));
    nav.appendChild(button('Home', function () { location.assign(HOME); }));
    nav.appendChild(button(shieldsOn ? 'Shields ON · ' + blockedCount + ' blocked' : 'Shields OFF',
      function () { store('shields', shieldsOn ? 'off' : 'on'); location.reload(); }));
    nav.appendChild(button(cursorOn ? 'Pointer ON' : 'Pointer OFF (site keys)', function () {
      cursorOn = !cursorOn;
      store('cursor', cursorOn ? 'on' : 'off');
      cursor.classList.toggle('off', !cursorOn);
      renderPanel();
      setFocus(6);
    }));
    panel.appendChild(nav);

    panel.appendChild(el('div', 'label', 'Bookmarks'));
    var bm = el('div', 'row');
    BOOKMARKS.forEach(function (b) { bm.appendChild(button(b[0], function () { location.assign(b[1]); })); });
    panel.appendChild(bm);
  }

  function setFocus(i) {
    if (items[focus]) items[focus].classList.remove('f');
    focus = (i + items.length) % items.length;
    items[focus].classList.add('f');
  }

  function openPanel() {
    renderPanel();
    panel.hidden = false;
    setFocus(0);
  }
  function closePanel() {
    if (urlInput) urlInput.blur();
    panel.hidden = true;
  }

  // ---------- keys ----------
  function onKey(e) {
    var k = KEYCODES[e.keyCode] || KEYNAMES[e.key];
    if (!k) return;
    var consume = function () { e.preventDefault(); e.stopImmediatePropagation(); };

    if (!panel.hidden) {
      var typing = shadow.activeElement === urlInput;
      if (typing) {
        if (k === 'enter') { consume(); go(urlInput.value); return; }
        if (k === 'back') { consume(); urlInput.blur(); return; }
        if (k === 'left' || k === 'right') return; // caret movement
        urlInput.blur();
      }
      consume();
      if (k === 'back' || k === 'red') closePanel();
      else if (k === 'left' || k === 'up') setFocus(focus - 1);
      else if (k === 'right' || k === 'down') setFocus(focus + 1);
      else if (k === 'enter') items[focus].__action();
      return;
    }

    if (k === 'red') { consume(); openPanel(); return; }
    if (!cursorOn) return; // TV-native sites (YouTube TV etc.) drive themselves with the remote

    if (isEditable(deepActive())) {
      if (k === 'back') { consume(); deepActive().blur(); }
      return; // let the TV keyboard and caret keys work
    }

    consume();
    if (k === 'back') { history.back(); return; }
    if (k === 'enter') { clickAt(cx, cy); return; }
    if (k === 'pageup' || k === 'pagedown') { scrollAt(0, k === 'pageup' ? -1 : 1, 0.8); return; }

    var now = Date.now();
    speed = now - lastMove < 180 ? Math.min(speed + 6, 70) : 14; // held key accelerates
    lastMove = now;
    moveCursor(k === 'left' ? -speed : k === 'right' ? speed : 0, k === 'up' ? -speed : k === 'down' ? speed : 0);
  }

  function start() {
    mount();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', function () { moveCursor(0, 0); });
  }

  if (document.documentElement) start();
  else {
    new MutationObserver(function (r, obs) {
      if (document.documentElement) { obs.disconnect(); start(); }
    }).observe(document, { childList: true });
  }

  window.__tizenShieldTest = { isBlocked: isBlocked, toUrl: toUrl, state: function () {
    return { cx: cx, cy: cy, panelOpen: !panel.hidden, focus: focus, blocked: blockedCount, shieldsOn: shieldsOn, cursorOn: cursorOn };
  } };
})();
