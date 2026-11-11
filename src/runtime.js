// Injected by TizenBrew into every page (and frame) the module opens.
// Targets the Tizen 6.5 web engine (Chromium 85): no optional chaining, no innerHTML (Trusted Types),
// styles via constructable sheets so a page's CSP can't block them.
(function () {
  'use strict';
  var TOP = window.top === window;

  // A status label drawn straight into the page with nothing but basic DOM calls, so the TV shows whether the
  // script ran at all and what broke. alert() can't be relied on: TizenBrew pages may swallow dialogs.
  var badge = null, badgeDone = false;
  function showBadge(text, bad) {
    if (!TOP || (badgeDone && !bad)) return; // a late retry must not resurrect the 'starting' label
    try {
      if (!document.documentElement) { setTimeout(function () { showBadge(text, bad); }, 50); return; }
      badge = badge || document.createElement('div');
      badge.textContent = text;
      badge.style.cssText = 'position:fixed;left:24px;top:24px;z-index:2147483647;padding:14px 20px;border-radius:12px;' +
        'font:22px/1.4 sans-serif;color:#fff;white-space:pre-wrap;max-width:85vw;background:' + (bad ? '#c62828' : '#333');
      document.documentElement.appendChild(badge);
    } catch (e) { /* nothing left to report with */ }
  }
  function hideBadge() { badgeDone = true; if (badge && badge.parentNode) badge.parentNode.removeChild(badge); }
  if (window.__tizenShield) return;
  window.__tizenShield = true;
  showBadge('TizenShield starting…');
  var CONSTRUCTABLE = (function () {
    try { new CSSStyleSheet(); return 'adoptedStyleSheets' in document; } catch (e) { return false; }
  })();

  var reported = false;
  function report(e) {
    if (!TOP || reported) return;
    reported = true;
    var stack = e && e.stack ? String(e.stack).split('\n').slice(0, 4).join('\n') : '';
    showBadge('TizenShield error: ' + (e && e.message ? e.message : e) + (stack ? '\n' + stack : ''), true);
  }

  // A sheet attached to a document or shadow root; <style> fallback for engines without constructable sheets.
  function newSheet(target) {
    if (CONSTRUCTABLE) {
      try {
        var s = new CSSStyleSheet();
        target.adoptedStyleSheets = target.adoptedStyleSheets.concat([s]);
        return s;
      } catch (e) { /* engine refuses to adopt it here: use a <style> element instead */ }
    }
    var st = document.createElement('style');
    (target === document ? (document.head || document.documentElement) : target).appendChild(st);
    return st.sheet;
  }

  try { main(); } catch (e) { report(e); }

  function main() {
    var FILTERS_URL = /*__FILTERS_URL__*/null;
    var F = null, onFilters = []; // filled once the data file arrives
    var hash = /*__HASH__*/null;
    // Home opens over Brave Search: the start page TizenBrew demonstrably injected into on this TV. A very fast
    // page (example.com) can finish loading before TizenBrew's service registers the module, so nothing is injected.
    var HOME = 'https://search.brave.com/#tizenshield-home';
    var SEARCH = 'https://search.brave.com/search?q=';

    var host = location.hostname.toLowerCase();
    if (!host) { try { host = window.parent.location.hostname.toLowerCase(); } catch (e) { /* cross-origin about:blank */ } }

    function store(k, v) {
      try {
        if (v === undefined) return localStorage.getItem('tizenshield:' + k);
        localStorage.setItem('tizenshield:' + k, v);
      } catch (e) { return null; }
    }
    var shieldsOn = !!FILTERS_URL && store('shields') !== 'off';

    // ---------- rule lookup (see pack() in lib/compile.mjs) ----------
    function bucket(h) { return F.h[hash(h) & (F.h.length - 1)]; }
    function hasRule(kind, h) { return !!F && bucket(h).indexOf('\n' + kind + h + '\n') >= 0; }
    function siteSelectors(kind, h) {
      if (!F) return [];
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

    function whenFilters(fn) { if (F) fn(); else onFilters.push(fn); }

    // Only the top page blocks and hides: ad frames get hidden whole by the page's own rules, and loading
    // the data into every frame would cost the TV memory and time for little gain.
    var origFetch = window.fetch;
    if (shieldsOn && TOP) {

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
        ['NASA+', 'https://plus.nasa.gov/', '#0b3d91'], ['Old Movies', 'https://archive.org/details/feature_films', '#3a3a3a'],
        ['StreameX', 'https://www.streamex.hn/', '#b0124f']]],
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
      65385: 'back', 27: 'back', 403: 'red', 404: 'green', 405: 'yellow', 427: 'pageup', 428: 'pagedown', 33: 'pageup', 34: 'pagedown' };
    var KEYNAMES = { ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', Enter: 'enter',
      Escape: 'back', ColorF0Red: 'red', ColorF1Green: 'green', ColorF2Yellow: 'yellow', PageUp: 'pageup', PageDown: 'pagedown' };
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
      '.row{display:flex;flex-wrap:wrap;gap:22px}.row+.row{margin-top:22px}',
      '.hint{font-size:22px;color:#8d93a1}',
      '.tile{flex:none;width:250px;height:140px;box-sizing:border-box;padding:18px;border-radius:18px;display:flex;',
      'align-items:flex-end;font-size:27px;font-weight:700;color:#fff;transition:transform .12s ease-out,box-shadow .12s;',
      'box-shadow:0 6px 18px rgba(0,0,0,.4);outline:4px solid transparent}',
      '.tile.dark{color:#111}',
      '.tile.action{width:auto;min-width:150px;padding:0 26px;align-items:center;background:#232733;font-weight:500;font-size:24px}',
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

    var cssFailures = [];
    var shadow, cursor, ring, home, clock, search, toastEl, rows = [], fr = 0, fc = 0;
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2, speed = 0, lastMove = 0;
    var idleTimer = 0, toastTimer = 0, clockTimer = 0, snapped = null;
    var cursorOn = store('cursor') !== 'off';
    var launchPage = location.hash.indexOf(LAUNCH_HASH) === 0, pendingAdd = null;

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
      UI_CSS.split('}').forEach(function (r) {
        if (!r.trim()) return;
        try { sheet.insertRule(r + '}', sheet.cssRules.length); } catch (e) { cssFailures.push(r.slice(0, 40)); }
      });

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
    // Your tiles live in the Home page's own storage (one origin), because every website has separate storage.
    // Other pages hand a site over through Home's URL hash (see addCurrentSite), never by writing it themselves.
    var PALETTE = ['#6441a5', '#0066dc', '#e62b1e', '#009270', '#c4161c', '#2c4b8e', '#fa6400', '#8e24aa', '#00838f'];
    function loadList(k) { try { var v = JSON.parse(store(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    function saveList(k, v) { store(k, JSON.stringify(v)); }
    function siteName(u) {
      var h = new URL(u).hostname.replace(/^(www|m)\./, '');
      return h.charAt(0).toUpperCase() + h.split('.')[0].slice(1);
    }

    function addTile(url, name) {
      if (!/^https?:\/\//i.test(url) || url.indexOf(SEARCH) === 0) { toast('That doesn\'t look like a website'); return false; }
      var mine = loadList('tiles').filter(function (t) { return t.u !== url; });
      name = (name || '').split(/\s[-|–—:·]\s/)[0].trim().slice(0, 24) || siteName(url);
      mine.push({ n: name, u: url });
      saveList('tiles', mine);
      saveList('hidden', loadList('hidden').filter(function (u) { return u !== url; }));
      toast('Added ' + name + ' to Home');
      return true;
    }

    function removeFocusedTile() {
      var t = rows[fr] && rows[fr][fc];
      if (!t || !t.__url) return;
      if (t.__custom) saveList('tiles', loadList('tiles').filter(function (x) { return x.u !== t.__url; }));
      else saveList('hidden', loadList('hidden').concat([t.__url]));
      toast('Removed ' + t.textContent + (t.__custom ? '' : ' · "Restore tiles" brings it back'));
      var r = fr, c = fc;
      renderHome();
      focusAt(r, c);
    }

    function addCurrentSite() {
      location.assign(HOME + '&add=' + encodeURIComponent(location.href) + '&name=' + encodeURIComponent(document.title || ''));
    }

    function tile(label, cls, action, color, dark) {
      var t = el('div', 'tile ' + (cls || '') + (dark ? ' dark' : ''), label);
      if (color) t.style.background = color;
      t.__action = action;
      return t;
    }
    function siteTile(name, url, color, dark, custom) {
      var t = tile(name, '', function () { location.assign(url); }, color, dark);
      t.__url = url;
      t.__custom = custom;
      return t;
    }
    function input(placeholder, submit) {
      var i = el('input', 'search');
      i.type = 'text';
      i.placeholder = placeholder;
      i.__action = function () { i.focus(); };
      i.__submit = submit;
      return i;
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
      if (launchPage) top.appendChild(el('div', 'hint', 'OK open · Yellow remove tile'));
      top.appendChild(clock);
      home.appendChild(top);
      tick();
      search = input('Search or type a website', go);

      if (!launchPage) {
        addRow(null, [
          tile('Home', 'action small', function () { location.assign(HOME); }),
          tile('Back to page', 'action small', closeHome),
          tile('Close pop-ups', 'action small', function () { closeHome(); closePopups(); }),
          tile('Add to Home', 'action small', addCurrentSite),
          tile(shieldsOn ? 'Shields on · ' + blockedCount + ' blocked' : 'Shields off', 'action small', function () {
            store('shields', shieldsOn ? 'off' : 'on'); location.reload();
          }),
          tile(cursorOn ? 'Pointer on' : 'Pointer off', 'action small', function () {
            cursorOn = !cursorOn;
            store('cursor', cursorOn ? 'on' : 'off');
            cursor.classList.toggle('off', !cursorOn);
            renderHome();
            focusAt(0, 5);
          }),
          tile('Reload', 'action small', function () { location.reload(); })
        ]);
        addRow(null, [search]);
        return;
      }

      var hidden = loadList('hidden'), first = [search, input('Add a website, e.g. example.com', function (text) {
        if (addTile(toUrl(text))) { renderHome(); focusAt(1, 0); }
      })];
      if (pendingAdd) {
        var p = pendingAdd;
        first.unshift(tile('Add ' + (p.n || siteName(p.u)).split(/\s[-|–—:·]\s/)[0].slice(0, 24) + ' to Home?', 'action small', function () {
          pendingAdd = null;
          addTile(p.u, p.n);
          renderHome();
          focusAt(1, 0);
        }));
      }
      if (hidden.length) first.push(tile('Restore tiles', 'action small', function () { saveList('hidden', []); renderHome(); focusAt(0, 0); }));
      addRow(null, first);
      var mine = loadList('tiles');
      if (mine.length) {
        addRow('My tiles', mine.map(function (t) {
          return siteTile(t.n, t.u, PALETTE[hash(t.u) % PALETTE.length], false, true);
        }));
      }
      SECTIONS.forEach(function (sec) {
        var tiles = sec[1].filter(function (t) { return hidden.indexOf(t[1]) < 0; });
        if (tiles.length) addRow(sec[0], tiles.map(function (t) { return siteTile(t[0], t[1], t[2], t[3], false); }));
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
      // Keep the focused tile on screen; the first rows stay put so the header doesn't jump around.
      var rect = t.getBoundingClientRect();
      var overflow = rect.bottom + 60 - window.innerHeight;
      if (overflow > 0) home.scrollTop += overflow;
      else if (rect.top < 160) home.scrollTop = Math.max(0, home.scrollTop + rect.top - 160);
    }

    // Spatial: the nearest tile beyond the current one's edge in that direction, preferring tiles that line up
    // with it. Works across wrapped rows and wide fields, where comparing tile centres picks diagonals.
    function homeMove(k) {
      var d = DIRS[k], a = rows[fr][fc].getBoundingClientRect(), best = null, bestScore = Infinity;
      rows.forEach(function (row, r) {
        row.forEach(function (t, c) {
          if (r === fr && c === fc) return;
          var b = t.getBoundingClientRect(), along, gap, skew;
          if (d[0]) {
            along = d[0] > 0 ? b.left - a.right : a.left - b.right;
            gap = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
            skew = Math.abs((b.top + b.bottom) - (a.top + a.bottom)) / 2;
          } else {
            along = d[1] > 0 ? b.top - a.bottom : a.top - b.bottom;
            gap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
            skew = Math.abs((b.left + b.right) - (a.left + a.right)) / 2;
          }
          if (along < -12) return; // the focused tile is scaled up, so neighbours overlap it slightly
          var score = Math.max(0, along) + gap * 3 + skew * 0.1;
          if (score < bestScore) { bestScore = score; best = [r, c]; }
        });
      });
      if (best) focusAt(best[0], best[1]);
    }

    function tick() {
      var d = new Date();
      clock.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function openHome() {
      renderHome();
      home.hidden = false;
      clearInterval(clockTimer);
      clockTimer = setInterval(tick, 15000);
      focusAt(launchPage && rows.length > 1 && !pendingAdd ? 1 : 0, 0);
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
        var field = shadow.activeElement;
        if (field && field.__submit) {
          if (k === 'enter') { consume(); field.__submit(field.value); return; }
          if (k === 'back') { consume(); field.blur(); return; }
          if (k === 'left' || k === 'right') return; // caret movement
          field.blur();
        }
        consume();
        if (k === 'back' && launchPage) { if (history.length > 1) history.back(); }
        else if (k === 'back' || k === 'red') closeHome();
        else if (k === 'enter') rows[fr][fc].__action();
        else if (k === 'yellow' && launchPage) removeFocusedTile();
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

    function loadFilters() {
      origFetch.call(window, FILTERS_URL).then(function (r) {
        if (!r.ok) throw new Error('filters ' + r.status);
        return r.text();
      }).then(function (text) {
        var parts = text.split('\u001d');
        F = { g: parts[0], h: parts.slice(1) };
        onFilters.splice(0).forEach(function (fn) { try { fn(); } catch (e) { report(e); } });
      }).catch(function () { /* blocked by the page's CSP, or offline: the page just runs unshielded */ });
    }

    function start() {
      try {
        // TizenBrew evaluates this in every execution context, including isolated worlds that share the page's DOM
        // but not its globals, so the first one to mark <html> owns the page and the rest stand down.
        var root = document.documentElement;
        if (root.hasAttribute('data-tizenshield')) { hideBadge(); return; }
        root.setAttribute('data-tizenshield', '');
        if (shieldsOn) { loadFilters(); whenFilters(hideAds); }
        mount();
        hideBadge();
        if (cssFailures.length) toast('TizenShield: TV skipped styles: ' + cssFailures.join(' | '));
        window.addEventListener('keydown', function (e) { try { onKey(e); } catch (err) { report(err); } }, true);
        window.addEventListener('resize', function () { moveCursor(0, 0); });
        if (launchPage) {
          var q = new URLSearchParams(location.hash.slice(LAUNCH_HASH.length + 1));
          // Any page could send us here with &add=, so the tile waits for an OK instead of being saved outright.
          if (/^https?:\/\//i.test(q.get('add') || '')) pendingAdd = { u: q.get('add'), n: q.get('name') || '' };
          history.replaceState(null, '', location.pathname + location.search + LAUNCH_HASH);
          openHome();
          return;
        }
        // Click-jacking ads navigate the whole tab to an ad network's page; bounce straight back from those.
        if (shieldsOn) whenFilters(function () {
          if (!hostBlocked(host, false)) return;
          toast('Blocked an ad page');
          setTimeout(function () { if (history.length > 1) history.back(); else location.assign(HOME); }, 800);
        });
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
        cursorOn: cursorOn, cssFailures: cssFailures, snapped: snapped && (snapped.id || snapped.tagName),
        tiles: loadList('tiles').map(function (t) { return t.n; }), hidden: loadList('hidden').length,
        focused: rows[fr] && rows[fr][fc] ? rows[fr][fc].textContent || rows[fr][fc].placeholder : null };
    } };
  }
})();
