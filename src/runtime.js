// Injected by TizenBrew into every page (and frame) the module opens.
// Targets the Tizen 6.5 web engine (Chromium 85): no optional chaining, no innerHTML (Trusted Types),
// styles via constructable sheets so a page's CSP can't block them.
(function () {
  'use strict';
  var TOP = window.top === window;
  var CONSTRUCTABLE = (function () {
    try { new CSSStyleSheet(); return 'adoptedStyleSheets' in document; } catch (e) { return false; }
  })();

  // TizenBrew evaluates this in every execution context, including isolated worlds that share the page's DOM
  // but not its globals. Adopted sheets live on the shared document, so a marker sheet makes the first context
  // (the page's main world) the only one that runs.
  var MARKER = 'tizen-shield-marker';
  if (CONSTRUCTABLE) {
    if (document.adoptedStyleSheets.some(function (s) { return s.cssRules[0] && s.cssRules[0].selectorText === MARKER; })) return;
    newSheet(document).insertRule(MARKER + '{}');
  } else {
    if (window.__tizenShield) return;
    window.__tizenShield = true;
  }

  var reported = false;
  function report(e) {
    if (!TOP || reported) return;
    reported = true;
    try { alert('TizenShield error: ' + (e && e.message ? e.message : e)); } catch (e2) { /* no alert */ }
  }

  // A sheet attached to a document or shadow root; <style> fallback for engines without constructable sheets.
  function newSheet(target) {
    if (CONSTRUCTABLE) {
      var s = new CSSStyleSheet();
      target.adoptedStyleSheets = target.adoptedStyleSheets.concat([s]);
      return s;
    }
    var st = document.createElement('style');
    (target === document ? (document.head || document.documentElement) : target).appendChild(st);
    return st.sheet;
  }

  try { main(); } catch (e) { report(e); }

  function main() {
    var F = /*__FILTERS__*/null;
    var hash = /*__HASH__*/null;
    var HOME = 'https://example.com/#tizenshield-home';
    var SEARCH = 'https://search.brave.com/search?q=';

    var host = location.hostname.toLowerCase();
    if (!host) { try { host = window.parent.location.hostname.toLowerCase(); } catch (e) { /* cross-origin about:blank */ } }

    function store(k, v) {
      try {
        if (v === undefined) return localStorage.getItem('tizenshield:' + k);
        localStorage.setItem('tizenshield:' + k, v);
      } catch (e) { return null; }
    }
    var shieldsOn = !!F && store('shields') !== 'off';

    // ---------- rule lookup (see pack() in lib/compile.mjs) ----------
    function bucket(h) { return F.h[hash(h) & (F.h.length - 1)]; }
    function hasRule(kind, h) { return bucket(h).indexOf('\n' + kind + h + '\n') >= 0; }
    function siteSelectors(kind, h) {
      var b = bucket(h), key = '\n' + kind + h + '\t', i = b.indexOf(key);
      return i < 0 ? [] : b.slice(i + key.length, b.indexOf('\n', i + 1)).split('\u001f');
    }
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
    var blockedCount = 0;

    function hostBlocked(h, third) {
      var s = suffixes(h), i;
      for (i = 0; i < s.length; i++) if (hasRule('e', s[i])) return false;
      for (i = 0; i < s.length; i++) if (hasRule('n', s[i]) || (third && hasRule('t', s[i]))) return true;
      return false;
    }

    function isBlocked(url) {
      if (!shieldsOn || !url) return false;
      var u;
      try { u = new URL(String(url), location.href); } catch (e) { return false; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      var h = u.hostname.toLowerCase();
      if (!hostBlocked(h, base(h) !== pageBase)) return false;
      blockedCount++;
      return true;
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
    }

    // Ad hiding runs in the top page only: ad frames are hidden whole by the page's rules, and a 29k-selector
    // sheet in every frame is what made ad-heavy sites crawl on the TV.
    function hideAds() {
      var skip = new Set(), sels = [];
      suffixes(host).forEach(function (h) {
        siteSelectors('x', h).forEach(function (s) { skip.add(s); });
        sels = sels.concat(siteSelectors('s', h));
      });
      sels = (F.g ? F.g.split('\n') : []).concat(sels).filter(function (s) { return !skip.has(s); });
      var sheet = newSheet(document);
      for (var i = 0; i < sels.length; i += 25) {
        var group = sels.slice(i, i + 25);
        try { sheet.insertRule(group.join(',') + '{display:none!important}', sheet.cssRules.length); }
        catch (e) {
          // One selector the engine doesn't know drops the whole group, so retry them one by one.
          group.forEach(function (s) {
            try { sheet.insertRule(s + '{display:none!important}', sheet.cssRules.length); } catch (e2) { /* unsupported */ }
          });
        }
      }
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

    // ---------- TV UI (top frame only) ----------
    var LAUNCH_HASH = '#tizenshield-home';
    // [name, url, tile colour, dark text]. No DRM sites: this TV's web engine has no Widevine/PlayReady.
    var SECTIONS = [
      ['Watch', [
        ['Twitch', 'https://www.twitch.tv/', '#6441a5'], ['Dailymotion', 'https://www.dailymotion.com/', '#0066dc'],
        ['Vimeo', 'https://vimeo.com/watch', '#1ab7ea'], ['TED', 'https://www.ted.com/talks', '#e62b1e'],
        ['NASA+', 'https://plus.nasa.gov/', '#0b3d91'], ['Old Movies', 'https://archive.org/details/feature_films', '#3a3a3a']]],
      ['News', [
        ['Google News', 'https://news.google.com/', '#1a73e8'], ['BBC News', 'https://www.bbc.com/news', '#bb1919'],
        ['The Hindu', 'https://www.thehindu.com/', '#24303a'], ['NDTV', 'https://www.ndtv.com/', '#c4161c'],
        ['Reuters', 'https://www.reuters.com/', '#fa6400']]],
      ['Sports', [
        ['Cricbuzz', 'https://www.cricbuzz.com/', '#009270'], ['ESPNcricinfo', 'https://www.espncricinfo.com/', '#03a9f4'],
        ['Formula 1', 'https://www.formula1.com/', '#e10600'], ['ESPN', 'https://www.espn.in/', '#cc0000']]],
      ['Explore', [
        ['Wikipedia', 'https://en.m.wikipedia.org/', '#e8e8e8', true], ['Reddit', 'https://old.reddit.com/', '#ff4500'],
        ['Hacker News', 'https://news.ycombinator.com/', '#ff6600'], ['IMDb', 'https://m.imdb.com/', '#f5c518', true],
        ['Windy', 'https://www.windy.com/', '#2c4b8e'], ['Brave Search', 'https://search.brave.com/', '#fb542b']]]
    ];

    var KEYCODES = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter', 65376: 'enter', 10009: 'back',
      65385: 'back', 27: 'back', 403: 'red', 404: 'green', 427: 'pageup', 428: 'pagedown', 33: 'pageup', 34: 'pagedown' };
    var KEYNAMES = { ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', Enter: 'enter',
      Escape: 'back', ColorF0Red: 'red', ColorF1Green: 'green', PageUp: 'pageup', PageDown: 'pagedown' };
    var DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
    var CLICKABLE = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],' +
      '[role=menuitem],[role=option],[onclick],[tabindex]:not([tabindex="-1"]),[aria-label*="close" i],[class*="close" i]';

    var UI_CSS = [
      ':host{all:initial}',
      '.cursor{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;',
      'background:rgba(255,255,255,.35);border:3px solid #fb542b;box-shadow:0 0 8px rgba(0,0,0,.6);',
      'transition:transform .12s ease-out,opacity .4s}',
      '.cursor.idle{opacity:.35}.cursor.off{display:none}',
      '.ring{position:fixed;border:4px solid #fb542b;border-radius:10px;box-shadow:0 0 0 4px rgba(251,84,43,.25);',
      'transition:all .12s ease-out;pointer-events:none}',
      '.ring[hidden]{display:none}',
      '.home{position:fixed;left:0;top:0;width:100vw;height:100vh;box-sizing:border-box;padding:48px 72px;overflow:hidden;',
      'background:linear-gradient(160deg,#141821,#0b0d12);color:#f2f2f2;font:24px/1.3 system-ui,sans-serif;pointer-events:auto}',
      '.home[hidden]{display:none}',
      '.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}',
      '.brand{font-size:34px;font-weight:700;letter-spacing:.5px}.brand b{color:#fb542b}',
      '.clock{font-size:34px;font-weight:300;color:#c9ccd3}',
      '.label{margin:26px 0 12px;font-size:22px;color:#8d93a1;text-transform:uppercase;letter-spacing:2px}',
      '.row{display:flex;gap:22px}',
      '.tile{flex:none;width:250px;height:140px;box-sizing:border-box;padding:18px;border-radius:18px;display:flex;',
      'align-items:flex-end;font-size:27px;font-weight:700;color:#fff;transition:transform .12s ease-out,box-shadow .12s;',
      'box-shadow:0 6px 18px rgba(0,0,0,.4);outline:4px solid transparent}',
      '.tile.dark{color:#111}',
      '.tile.action{background:#232733;font-weight:500;font-size:24px}',
      '.search{width:520px;padding:0 24px;align-items:center;font:inherit;font-size:26px;color:#fff;background:#232733;',
      'border:0;border-radius:18px;height:84px;outline:4px solid transparent}',
      '.search::placeholder{color:#8d93a1}',
      '.tile.small,.search{height:84px}',
      '.f{transform:scale(1.08);outline-color:#fff;box-shadow:0 12px 32px rgba(0,0,0,.7)}',
      '.toast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);padding:16px 28px;background:#1e2029;',
      'color:#f0f0f0;border-radius:14px;font:24px system-ui,sans-serif;opacity:0;transition:opacity .4s;',
      'box-shadow:0 8px 24px rgba(0,0,0,.6)}',
      '.toast.show{opacity:.96}'
    ].join('');

    var shadow, cursor, ring, home, clock, search, toastEl, rows = [], fr = 0, fc = 0;
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2, speed = 0, lastMove = 0;
    var idleTimer = 0, toastTimer = 0, clockTimer = 0, snapped = null;
    var cursorOn = store('cursor') !== 'off';
    var launchPage = location.hash === LAUNCH_HASH;

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
      var sheet = newSheet(shadow);
      UI_CSS.split('}').forEach(function (r) { if (r.trim()) sheet.insertRule(r + '}', sheet.cssRules.length); });

      ring = el('div', 'ring');
      ring.hidden = true;
      cursor = el('div', 'cursor' + (cursorOn ? '' : ' off'));
      home = el('div', 'home');
      home.hidden = true;
      toastEl = el('div', 'toast');
      [ring, cursor, home, toastEl].forEach(function (n) { shadow.appendChild(n); });
      document.documentElement.appendChild(hostEl);
      // Stay the last child of <html>: at equal z-index the later element paints on top, so an overlay ad
      // appended after us would otherwise cover the pointer. Also restores us if an SPA sweeps <html> clean.
      // ponytail: capped so a page script fighting for the same spot can't loop forever; it wins after 50 rounds
      var moves = 0;
      new MutationObserver(function () {
        if ((!hostEl.isConnected || hostEl.nextElementSibling) && moves++ < 50) document.documentElement.appendChild(hostEl);
      }).observe(document.documentElement, { childList: true });
      window.addEventListener('scroll', function () { ring.hidden = true; snapped = null; }, true);
      moveCursor(0, 0);
    }

    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3500);
    }

    // ---------- Home: full-screen tiles ----------
    function tile(label, cls, action, color, dark) {
      var t = el('div', 'tile ' + (cls || '') + (dark ? ' dark' : ''), label);
      if (color) t.style.background = color;
      t.__action = action;
      return t;
    }

    function renderHome() {
      while (home.firstChild) home.removeChild(home.firstChild);
      rows = [];
      var top = el('div', 'top');
      var brand = el('div', 'brand');
      brand.appendChild(el('b', '', 'Tizen'));
      brand.appendChild(document.createTextNode('Shield'));
      clock = el('div', 'clock');
      top.appendChild(brand);
      top.appendChild(clock);
      home.appendChild(top);

      search = el('input', 'search');
      search.type = 'text';
      search.placeholder = 'Search or type a website';
      search.__action = function () { search.focus(); };
      var first = [search];
      if (!launchPage) {
        first.push(tile('Back to page', 'action small', closeHome));
        first.push(tile('Close pop-ups', 'action small', function () { closeHome(); closePopups(); }));
        first.push(tile(shieldsOn ? 'Shields on · ' + blockedCount + ' blocked' : 'Shields off', 'action small', function () {
          store('shields', shieldsOn ? 'off' : 'on'); location.reload();
        }));
        first.push(tile(cursorOn ? 'Pointer on' : 'Pointer off', 'action small', function () {
          cursorOn = !cursorOn;
          store('cursor', cursorOn ? 'on' : 'off');
          cursor.classList.toggle('off', !cursorOn);
          renderHome();
          focusAt(0, 4);
        }));
        first.push(tile('Reload', 'action small', function () { location.reload(); }));
      }
      addRow(null, first);
      SECTIONS.forEach(function (sec) {
        addRow(sec[0], sec[1].map(function (t) {
          return tile(t[0], '', function () { location.assign(t[1]); }, t[2], t[3]);
        }));
      });
    }

    function addRow(label, items) {
      if (label) home.appendChild(el('div', 'label', label));
      var row = el('div', 'row');
      items.forEach(function (i) { row.appendChild(i); });
      home.appendChild(row);
      rows.push(items);
    }

    function focusAt(r, c) {
      if (rows[fr] && rows[fr][fc]) rows[fr][fc].classList.remove('f');
      fr = Math.max(0, Math.min(rows.length - 1, r));
      fc = Math.max(0, Math.min(rows[fr].length - 1, c));
      var t = rows[fr][fc];
      t.classList.add('f');
      // Keep the focused row on screen; the first rows stay put so the header doesn't jump around.
      var rect = t.getBoundingClientRect();
      var overflow = rect.bottom + 60 - window.innerHeight;
      if (overflow > 0) home.scrollTop += overflow;
      else if (rect.top < 160) home.scrollTop = Math.max(0, home.scrollTop + rect.top - 160);
    }

    function homeMove(k) {
      if (k === 'left' || k === 'right') return focusAt(fr, fc + (k === 'left' ? -1 : 1));
      var nr = Math.max(0, Math.min(rows.length - 1, fr + (k === 'up' ? -1 : 1)));
      if (nr === fr) return;
      // Land on the tile in the next row that sits closest under/over the current one.
      var r0 = rows[fr][fc].getBoundingClientRect(), x = r0.left + r0.width / 2, best = 0, bestD = Infinity;
      rows[nr].forEach(function (t, i) {
        var r = t.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - x);
        if (d < bestD) { bestD = d; best = i; }
      });
      focusAt(nr, best);
    }

    function tick() {
      var d = new Date();
      clock.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function openHome() {
      renderHome();
      home.hidden = false;
      tick();
      clockTimer = setInterval(tick, 15000);
      focusAt(launchPage ? 1 : 0, 0);
    }
    function closeHome() {
      if (launchPage) return; // nothing behind it
      if (search) search.blur();
      clearInterval(clockTimer);
      home.hidden = true;
    }

    // ---------- page navigation: hop between clickable things ----------
    function moveCursor(dx, dy) {
      var w = window.innerWidth, h = window.innerHeight, edge = 4;
      var nx = cx + dx, ny = cy + dy;
      if (nx < edge || nx > w - edge || ny < edge || ny > h - edge) {
        scrollAt(nx < edge ? -1 : nx > w - edge ? 1 : 0, ny < edge ? -1 : ny > h - edge ? 1 : 0, 0.3);
      }
      setCursor(Math.max(edge, Math.min(w - edge, nx)), Math.max(edge, Math.min(h - edge, ny)));
    }

    function setCursor(x, y) {
      cx = x; cy = y;
      cursor.style.transform = 'translate(' + cx + 'px,' + cy + 'px)';
      cursor.classList.remove('idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { cursor.classList.add('idle'); }, 3000);
    }

    function visibleTargets() {
      var w = window.innerWidth, h = window.innerHeight, out = [];
      var list = document.querySelectorAll(CLICKABLE);
      // ponytail: scans every clickable each press; cap it so huge pages stay responsive on the TV
      for (var i = 0; i < list.length && out.length < 800; i++) {
        var r = list[i].getBoundingClientRect();
        if (r.width < 6 || r.height < 6 || r.bottom < 0 || r.right < 0 || r.top > h || r.left > w) continue;
        out.push({ el: list[i], r: r, x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }
      return out;
    }

    function reachable(t) {
      var hit = document.elementFromPoint(t.x, t.y);
      return !!hit && (hit === t.el || t.el.contains(hit) || hit.contains(t.el));
    }

    // Arrow keys jump to the nearest link/button in that direction; with nothing there, the page scrolls.
    function snapMove(k) {
      var d = DIRS[k], best = [];
      visibleTargets().forEach(function (t) {
        if (snapped && t.el === snapped) return;
        var along = (t.x - cx) * d[0] + (t.y - cy) * d[1];
        if (along < 10) return;
        var across = Math.abs((t.x - cx) * d[1] - (t.y - cy) * d[0]);
        t.score = along + across * 2.5;
        best.push(t);
      });
      best.sort(function (a, b) { return a.score - b.score; });
      for (var i = 0; i < best.length && i < 12; i++) {
        if (!reachable(best[i])) continue;
        snapTo(best[i]);
        return;
      }
      if (d[1]) { scrollAt(0, d[1], 0.45); return; }
      var now = Date.now();
      speed = now - lastMove < 180 ? Math.min(speed + 6, 70) : 24;
      lastMove = now;
      ring.hidden = true;
      snapped = null;
      moveCursor(d[0] * speed, 0);
    }

    function snapTo(t) {
      snapped = t.el;
      setCursor(t.x, t.y);
      ring.style.left = (t.r.left - 6) + 'px';
      ring.style.top = (t.r.top - 6) + 'px';
      ring.style.width = (t.r.width + 4) + 'px';
      ring.style.height = (t.r.height + 4) + 'px';
      ring.hidden = false;
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

    // Green button: hide fixed overlays that cover the page (ad interstitials, sign-up walls, app banners)
    // and give the page its scrolling back. Samples the screen instead of walking the whole DOM.
    function closePopups() {
      var w = window.innerWidth, h = window.innerHeight, seen = new Set(), hidden = 0;
      [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.25, 0.7], [0.75, 0.7], [0.5, 0.95], [0.5, 0.15]].forEach(function (p) {
        var stack = document.elementsFromPoint(w * p[0], h * p[1]);
        for (var i = 0; i < stack.length; i++) {
          var n = stack[i];
          if (seen.has(n) || n === document.body || n === document.documentElement) continue;
          seen.add(n);
          var cs = getComputedStyle(n);
          if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
          var r = n.getBoundingClientRect();
          var big = (r.width * r.height) / (w * h) > 0.2, bottomBar = r.bottom >= h - 2 && r.top > h * 0.5;
          if (big || bottomBar) { n.style.setProperty('display', 'none', 'important'); hidden++; }
        }
      });
      [document.documentElement, document.body].forEach(function (n) {
        if (!n) return;
        n.style.setProperty('overflow', 'auto', 'important');
        // Modals often lock scrolling by pinning <body> with position:fixed.
        if (getComputedStyle(n).position === 'fixed') n.style.setProperty('position', 'static', 'important');
      });
      ring.hidden = true;
      toast(hidden ? 'Closed ' + hidden + ' pop-up' + (hidden > 1 ? 's' : '') : 'No pop-ups found');
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

    function toUrl(text) {
      text = (text || '').trim();
      if (!text) return '';
      if (/^https?:\/\//i.test(text)) return text;
      if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return 'https://' + text;
      return SEARCH + encodeURIComponent(text);
    }
    function go(text) { var u = toUrl(text); if (u) location.assign(u); }

    // ---------- keys ----------
    function onKey(e) {
      var k = KEYCODES[e.keyCode] || KEYNAMES[e.key];
      if (!k) return;
      var consume = function () { e.preventDefault(); e.stopImmediatePropagation(); };

      if (!home.hidden) {
        if (shadow.activeElement === search) {
          if (k === 'enter') { consume(); go(search.value); return; }
          if (k === 'back') { consume(); search.blur(); return; }
          if (k === 'left' || k === 'right') return; // caret movement
          search.blur();
        }
        consume();
        if (k === 'back' || k === 'red') closeHome();
        else if (k === 'enter') rows[fr][fc].__action();
        else if (DIRS[k]) homeMove(k);
        return;
      }

      if (k === 'red') { consume(); openHome(); return; }
      if (k === 'green') { consume(); closePopups(); return; }
      if (!cursorOn) return; // TV-native sites drive themselves with the remote

      if (isEditable(deepActive())) {
        if (k === 'back') { consume(); deepActive().blur(); }
        return; // let the TV keyboard and caret keys work
      }

      consume();
      if (k === 'back') history.back();
      else if (k === 'enter') clickAt(cx, cy);
      else if (k === 'pageup' || k === 'pagedown') scrollAt(0, k === 'pageup' ? -1 : 1, 0.8);
      else snapMove(k);
    }

    function start() {
      try {
        if (shieldsOn) hideAds();
        mount();
        window.addEventListener('keydown', function (e) { try { onKey(e); } catch (err) { report(err); } }, true);
        window.addEventListener('resize', function () { moveCursor(0, 0); });
        if (launchPage) { openHome(); return; }
        // Click-jacking ads navigate the whole tab to an ad network's page; bounce straight back from those.
        if (shieldsOn && hostBlocked(host, false)) {
          toast('Blocked an ad page');
          setTimeout(function () { if (history.length > 1) history.back(); else location.assign(HOME); }, 800);
          return;
        }
        if (store('hinted') !== '1') {
          store('hinted', '1');
          toast('Arrows jump between links · OK opens · Red: Home · Green: close pop-ups');
        }
      } catch (e) { report(e); }
    }

    if (document.documentElement) start();
    else {
      new MutationObserver(function (r, obs) {
        if (document.documentElement) { obs.disconnect(); start(); }
      }).observe(document, { childList: true });
    }

    window.__tizenShieldTest = { isBlocked: isBlocked, toUrl: toUrl, state: function () {
      return { cx: cx, cy: cy, homeOpen: !home.hidden, row: fr, col: fc, blocked: blockedCount, shieldsOn: shieldsOn,
        cursorOn: cursorOn, snapped: snapped && (snapped.id || snapped.tagName) };
    } };
  }
})();
