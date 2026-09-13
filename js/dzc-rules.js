/* Interactive Rules: the Dropzone Commander 3.02 rulebook, verbatim.
 *
 * The same screen as the Dropfleet builder's Interactive Rules (renderRules in
 * its js/app.js): a sticky contents rail beside the book, cross-references as
 * #rules/<id> links so Back returns you, tokens drawn beside the rules that
 * call on them, and a search over the special rules. Two differences, both
 * asked for: the rail nests each chapter's sections under it the way a book's
 * contents page does, and the text comes from data/dzc/rules-book.json, built
 * by tools/dzc/build_rules_book.py with the book's bold kept and the errata
 * the 3.02 printing lacks applied.
 *
 * Nothing here writes rules text. Every sentence on the screen is a sentence
 * in that file, and every sentence in that file is one in the PDF.
 */
(function () {
  'use strict';

  const RULEBOOK_URL = 'https://ttcombat.com/pages/dropzone-commander-resources';
  const DATA = 'data/dzc/rules-book.json';

  let book = null;
  let built = false;
  let spy = null;
  let index = null;
  let tokenNames = {};

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function* walk(nodes) {
    for (const n of nodes || []) { yield n; yield* walk(n.children); }
  }
  const plain = runs => (runs || []).map(r => r.t).join('');

  // ------------------------------------------------------------ symbols
  /* The inline transport symbols of 3.2.4.2, carried through the text as
     private-use characters. Drawn in the book's own red, hollow or solid. */
  const SYM = {
    '': ['M3 3h18v18H3z', false, '#d1232a', 'hollow square'],
    '': ['M3 3h18v18H3z', true, '#d1232a', 'solid square'],
    '': ['M12 2l11 19H1z', false, '#ed1c24', 'hollow triangle'],
    '': ['M12 2l11 19H1z', true, '#ed1c24', 'solid triangle']
  };
  function symHtml(ch) {
    const [d, solid, ink, label] = SYM[ch];
    return `<svg class="rules-sym" viewBox="0 0 24 24" width="15" height="15" role="img" aria-label="${label}">`
      + `<path d="${d}" fill="${solid ? ink : 'none'}" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/></svg>`;
  }

  // ------------------------------------------------------------- tokens
  /* Counters off the rulebook's token page (assets/tokens, cut by
     tools/dzc/extract_tokens.py). Names are the book's own, read from
     chapter 12, typo included. */
  const TOK = k => `assets/tokens/${k}.webp`;
  const FEATURE_TOK = {
    'ACM Package': 'acm-package', 'Automated Sentries': 'automated-sentries',
    'Comms Uplink': 'comms-uplink-tower', 'Jamming Device': 'jamming-device',
    'Power Core': 'power-core', 'Seal': 'seal', 'Shield Generator': 'shield-generator',
    'Shimmer Field': 'shimmer-field', 'Basement': 'basement',
    'Excellent Vantage': 'excellent-vantage', 'Internal Flaw': 'internal-flaw',
    'Secret Entrance': 'secret-entrance', 'Underground Monorail': 'underground-tunnel'
  };
  const TABLE_TOK = {
    'Railgun Turret': 'railgun-turret', 'Missile Turret': 'missile-turret',
    'Laser Turret': 'laser-turret', 'Flak Turret': 'flak-turret',
    'Heavy Cannon Turret': 'heavy-cannon', 'Superlaser Turret': 'super-laser'
  };
  // Tokens shown with the rule that places or uses them, by section number.
  // They all appear together again in chapter 12.
  const SECTION_TOKENS = {
    '4.1.2': ['pass'],
    '6.4.5': ['concussed', 'jammed', 'suppressed', 'obscured'],
    '8.8.4': ['bunker-entrance'],
    '9.6.9': ['secure-point'],
    '9.7': ['object'],
    '10.1.30': ['obscured'],
    '10.1.33': ['mapping'],
    '11.1.7': ['concussed'],
    '11.1.22': ['jammed'],
    '11.1.32': ['obscured'],
    '11.1.34': ['suppressed']
  };

  function tokenList(items, extra) {
    return `<ul class="rules-tok-list${extra ? ' ' + extra : ''}">${items.map(t =>
      `<li class="rules-tok"><img src="${esc(t.src)}" alt="" width="40" height="40" loading="lazy" onerror="this.remove()">`
      + `<span class="rules-tok-nm">${esc(t.name)}</span></li>`).join('')}</ul>`;
  }
  function sectionTokens(number) {
    const keys = SECTION_TOKENS[number];
    if (!keys) return '';
    return `<div class="rules-tok-inline">${tokenList(keys.map(k => ({ src: TOK(k), name: tokenNames[TOK(k)] || '' })))}</div>`;
  }

  // -------------------------------------------------------------- links
  /* The book cites by name ("see page 34 'Entry'") far more than by number,
     so a link comes from a quoted section name, a section number, a section
     heading, or a special rule's name. Words that head a section but are
     everywhere in the prose ("Units", "Zones") would turn every line into
     links, so they are left as words. A one-word name only links where the
     book capitalises it, which is how it marks the defined term. */
  const STOP = new Set(['units', 'unit', 'squads', 'squad', 'groups', 'group', 'weapons', 'weapon',
    'zones', 'zone', 'tokens', 'token', 'ground', 'dice', 'ruler', 'command', 'moving', 'attacking',
    'activating', 'scenarios', 'armies', 'preparation', 'special', 'large', 'field', 'strong',
    'critical', 'hold', 'objects', 'scoring', 'entry', 'demo']);
  // Terms the book defines in a section of its own rather than by heading.
  const EXTRA = { 'Kill Points': '9.5', 'Victory Points': '9.5', 'Criticals': '6.2.4', 'Critical': '6.2.4' };

  function ruleNames(heading) {
    const paren = (heading.match(/\(([^)]+)\)/) || [])[1];
    const base = heading.replace(/\s*\(.*?\)\s*/g, ' ')
      .replace(/:?\s+(X\/Y|X Y” Z\+|X\+|X”|-X|X)(\s.*)?$/, '')
      .replace(/X\+?$/, '').trim();
    return [base, paren && paren.replace(/-\s+/g, '-').trim()].filter(Boolean);
  }

  function buildIndex() {
    const terms = {};
    const prio = {};
    const numbers = new Set();
    const add = (phrase, id, p) => {
      const key = String(phrase || '').toLowerCase().trim();
      if (key.length < 4 || STOP.has(key)) return;
      if (key in terms && prio[key] <= p) return;
      terms[key] = id;
      prio[key] = p;
    };
    const glossary = n => /^1[01]\.1\./.test(n.number || '');
    for (const n of walk(book.chapters)) {
      if (!n.number) continue;
      numbers.add(n.number);
      if (glossary(n)) ruleNames(n.heading).forEach(nm => add(nm, n.id, 20));
      else add(n.heading, n.id, n.number.split('.').length);
    }
    Object.entries(EXTRA).forEach(([k, v]) => add(k, v, 0));
    const alt = Object.keys(terms).sort((a, b) => b.length - a.length)
      .map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const re = new RegExp('‘[^’]{3,60}’|\\b(?:\\d+(?:\\.\\d+)+' + (alt ? '|' + alt : '') + ')(?![\\w-])', 'gi');
    index = { terms, numbers, re };
  }

  function linkify(html) {
    return html.replace(index.re, m => {
      let id;
      if (m[0] === '‘') {
        id = index.terms[m.slice(1, -1).toLowerCase()];
        if (!id) return m;
      } else if (/^\d+(?:\.\d+)+$/.test(m)) {
        if (!index.numbers.has(m)) return m;
        id = m;
      } else {
        if (!/[\s-]/.test(m) && m[0] !== m[0].toUpperCase()) return m;
        id = index.terms[m.toLowerCase()];
        if (!id) return m;
      }
      return `<a class="rules-xref" href="#rules/${esc(id)}">${m}</a>`;
    });
  }

  function runsHtml(runs, link) {
    return (runs || []).map(r => {
      let h = esc(r.t);
      // Bold is the book naming the thing being defined ("Shield Generator",
      // "Friendly Lines"), so it is never a link to something else.
      if (link !== false && !r.b) h = linkify(h);
      h = h.replace(/\n\n/g, '<br><br>').replace(/[-]/g, symHtml);
      return r.b ? `<strong>${h}</strong>` : h;
    }).join('');
  }
  const boldOnly = runs => (runs || []).map(r => r.b ? `<b>${esc(r.t)}</b>` : esc(r.t)).join('');

  // -------------------------------------------------------------- blocks
  function paraHtml(node, b) {
    const text = plain(b.runs);
    const first = b.runs && b.runs[0] && b.runs[0].b ? b.runs[0].t.trim() : '';
    const tok = (node.number === '8.8.2' || node.number === '8.8.3') && FEATURE_TOK[first];
    const eg = /^\s*(e\.g\.|for example\b)/i.test(text);
    const p = `<p class="rules-p${eg ? ' rules-eg' : ''}">${runsHtml(b.runs)}</p>`;
    return tok
      ? `<div class="rules-feat"><img src="${TOK(tok)}" alt="" width="40" height="40" loading="lazy" onerror="this.remove()">${p}</div>`
      : p;
  }

  function tableHtml(t) {
    const cell = (c, tag, head) => {
      const attrs = (c.cs ? ` colspan="${c.cs}"` : '') + (c.rs ? ` rowspan="${c.rs}"` : '')
        + (tag === 'th' ? ` scope="${head ? 'col' : 'row'}"` : '');
      const cls = [c.none && 'rules-td-none', c.vertical && 'rules-th-vert'].filter(Boolean).join(' ');
      const tok = TABLE_TOK[plain(c.r).trim()];
      const img = tok ? `<img class="rules-tbl-tok" src="${TOK(tok)}" alt="" width="26" height="26" loading="lazy" onerror="this.remove()">` : '';
      return `<${tag}${attrs}${cls ? ` class="${cls}"` : ''}>${img}${runsHtml(c.r, !head)}</${tag}>`;
    };
    const head = (t.head || []).map(row => `<tr>${row.map(c => cell(c, 'th', true)).join('')}</tr>`).join('');
    const rows = (t.rows || []).map(row => `<tr>${row.map(c => cell(c, c.th ? 'th' : 'td', false)).join('')}</tr>`).join('');
    return `<div class="rules-table-wrap"><table class="rules-table${t.variant ? ' rules-table--' + t.variant : ''}">`
      + `${head ? `<thead>${head}</thead>` : ''}<tbody>${rows}</tbody></table></div>`;
  }

  function figHtml(b) {
    // Cut at 3x from A5 pages; shown a little larger than print size.
    const w = b.w ? ` style="width:${Math.round(b.w / 3 * 1.75)}px"` : '';
    return `<figure class="rules-fig"><img src="${esc(b.src)}" alt="${esc(b.alt)}"`
      + `${b.w ? ` width="${b.w}" height="${b.h}"` : ''}${w} loading="lazy" onerror="this.remove()"></figure>`;
  }

  function bodyHtml(node) {
    return (node.body || []).map(b => {
      switch (b.kind) {
        case 'p': return paraHtml(node, b);
        case 'note': return `<p class="rules-p rules-eg">${runsHtml(b.runs)}</p>`;
        case 'ol': return `<ol class="rules-ol">${b.items.map(it =>
          `<li>${it.map((p, i) => i ? `<p>${runsHtml(p)}</p>` : runsHtml(p)).join('')}</li>`).join('')}</ol>`;
        case 'table': return tableHtml(b);
        case 'fig': return figHtml(b);
        case 'tokens': return tokenList(b.items);
        case 'symbols': return `<div class="rules-tok-grp"><div class="rules-tok-head">${esc(b.title)}</div>`
          + `<p class="rules-p">${runsHtml(b.runs)}</p>${tokenList(b.items, 'rules-tok-list--play')}</div>`;
        default: return '';
      }
    }).join('');
  }

  // ------------------------------------------------------------ sections
  const CHEVRON = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>';
  const SEARCH_CHAPTERS = new Set(['10', '11']);
  const NAV_FLAT = new Set(['10', '11', '12']);

  // A scenario card is one button: its name, its objectives, entry and
  // variants, straight to that scenario in the Scenario Reference.
  function scenarioHtml(n) {
    const rows = (n.body || []).map(b => `<span class="rsb-row">${boldOnly(b.runs)}</span>`).join('');
    return `<a class="rules-scn-btn" id="rules-sec-${esc(n.id)}" href="scenarios/#${esc(n.scenario)}" target="_blank" rel="noopener">`
      + `<span class="rules-scn-btn-nm">${esc(n.heading)}${CHEVRON}</span><span class="rsb-rows">${rows}</span></a>`;
  }

  /* Depth follows the printed number, so 10.1.1 sits two levels in even
     though the book has no 10.1 heading above it. */
  function sectionHtml(n, parentDepth) {
    const depth = n.number ? Math.max(1, n.number.split('.').length - 1) : parentDepth + 1;
    const lvl = Math.min(depth + 2, 6);
    const num = n.number ? `<span class="rules-h-n">${esc(n.number)}</span>` : '';
    const kids = (n.children || []).map(c => sectionHtml(c, depth)).join('');
    return `<div class="rules-sub rules-sub-d${depth}" id="rules-sec-${esc(n.id)}">`
      + `<h${lvl} class="rules-h">${num}${esc(n.heading)}</h${lvl}>`
      + `${bodyHtml(n)}${sectionTokens(n.number)}${kids}</div>`;
  }

  function chapterHtml(ch) {
    const kids = ch.children || [];
    const cards = kids.filter(c => c.scenario);
    const search = SEARCH_CHAPTERS.has(ch.number)
      ? `<input class="rules-search" type="search" placeholder="Search special rules…" aria-label="Search special rules" data-chapter="${esc(ch.id)}">`
      : '';
    return `<section class="rules-chapter" id="rules-sec-${esc(ch.id)}">`
      + `<h2 class="rules-chapter-title"><span class="rules-chapter-n">${esc(ch.number)}</span>${esc(ch.heading)}</h2>`
      + search + bodyHtml(ch) + sectionTokens(ch.number)
      + kids.filter(c => !c.scenario).map(c => sectionHtml(c, 0)).join('')
      + (cards.length ? `<div class="rules-scn-grid">${cards.map(scenarioHtml).join('')}</div>` : '')
      + '</section>';
  }

  /* The contents rail. A chapter, then its sections nested under it, as a
     book's contents page sets them out. The two special-rules chapters and
     the token page stay one line each: their entries are the search. */
  function navHtml(chapters) {
    const item = (n, sub, chapterId) =>
      `<a class="rules-nav-item${sub ? ' rules-nav-item--sub' : ''}" data-target="rules-sec-${esc(n.id)}"`
      + `${sub ? ` data-chapter="rules-sec-${esc(chapterId)}"` : ''} href="#rules/${esc(n.id)}">`
      + `<span class="rules-nav-n">${esc(n.number)}</span><span class="rules-nav-t">${esc(n.heading)}</span></a>`;
    return chapters.map(ch => {
      const subs = NAV_FLAT.has(ch.number) ? [] : (ch.children || []).filter(c => c.number);
      return item(ch, false) + (subs.length
        ? `<div class="rules-nav-sub">${subs.map(s => item(s, true, ch.id)).join('')}</div>` : '');
    }).join('');
  }

  // ---------------------------------------------------------------- build
  function build(el) {
    const chapters = book.chapters || [];
    tokenNames = {};
    for (const n of walk(chapters)) {
      (n.body || []).forEach(b => { if (b.kind === 'tokens') b.items.forEach(t => { tokenNames[t.src] = t.name; }); });
    }
    buildIndex();
    el.innerHTML = `
      <div class="rules-layout">
        <nav class="rules-nav" aria-label="Rulebook contents">${navHtml(chapters)}</nav>
        <div class="rules-doc">
          <div class="rules-intro">
            <p>The Dropzone Commander rulebook, edition ${esc(book.edition)}, reproduced from TTCombat's free download.</p>
            <a class="btn btn-outline" href="${RULEBOOK_URL}" target="_blank" rel="noopener">TTCombat downloads</a>
          </div>
          ${chapters.map(chapterHtml).join('')}
        </div>
      </div>`;

    el.addEventListener('input', e => {
      const box = e.target.closest('.rules-search');
      if (box) filter(box);
    });
    // A link to where you already are changes no hash, so nothing would move.
    el.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#rules/"]');
      if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); jump(location.hash.slice(7)); }
    });
    setupSpy(el);
  }

  function filter(box) {
    const term = box.value.trim().toLowerCase();
    const chapter = document.getElementById('rules-sec-' + box.dataset.chapter);
    if (!chapter) return;
    chapter.querySelectorAll(':scope > .rules-sub').forEach(sec => {
      sec.hidden = !!term && !sec.textContent.toLowerCase().includes(term);
    });
  }

  // Highlight where the reader is, in the rail, as they scroll the book.
  function setupSpy(el) {
    if (spy) spy.disconnect();
    const nav = el.querySelector('.rules-nav');
    if (!nav || !('IntersectionObserver' in window)) return;
    const items = [...nav.querySelectorAll('.rules-nav-item')];
    const byTarget = new Map(items.map(a => [a.dataset.target, a]));
    spy = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const a = byTarget.get(en.target.id);
        if (!a) return;
        const chapter = a.dataset.chapter || a.dataset.target;
        items.forEach(i => i.classList.toggle('active', i === a || i.dataset.target === chapter));
        // Keep the lit entry in view inside the rail, without moving the page.
        const top = a.offsetTop - nav.offsetTop;
        if (top < nav.scrollTop || top > nav.scrollTop + nav.clientHeight - a.offsetHeight) {
          nav.scrollTop = top - nav.clientHeight / 3;
        }
      });
    }, { rootMargin: '-8% 0px -80% 0px', threshold: 0 });
    byTarget.forEach((_a, id) => { const t = document.getElementById(id); if (t) spy.observe(t); });
  }

  function jump(id) {
    const t = document.getElementById('rules-sec-' + id);
    if (!t) return;
    const hiddenBy = t.closest('[hidden]');
    if (hiddenBy) {
      const ch = t.closest('.rules-chapter');
      const box = ch && ch.querySelector('.rules-search');
      if (box) { box.value = ''; filter(box); }
    }
    t.scrollIntoView({ behavior: 'instant', block: 'start' });
    t.classList.remove('rules-hit');
    void t.offsetWidth;
    t.classList.add('rules-hit');
  }

  async function open(param) {
    const el = document.getElementById('view-rules');
    if (!el) return;
    if (!book) {
      try {
        const res = await fetch(DATA);
        book = await res.json();
      } catch (e) {
        console.error('Interactive Rules: the rulebook did not load', e);
        return;
      }
    }
    if (!built) { build(el); built = true; }
    // Straight away, not on the next frame: the book is already in the DOM,
    // and a frame never comes in a tab that is not in front.
    if (!param) return;
    const id = decodeURIComponent(param);
    jump(id);
    /* A cold deep link lands before the web fonts arrive, and the swap reflows
       thirty thousand pixels of book above the target, which carried a link
       to 8.7 three screens past it. Land again once fonts and the page have
       loaded, unless the reader has started scrolling by then. */
    let moved = false;
    const stop = () => { moved = true; };
    ['wheel', 'touchmove', 'keydown'].forEach(ev => window.addEventListener(ev, stop, { once: true, passive: true }));
    const again = () => { if (!moved && location.hash === '#rules/' + param) jump(id); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(again);
    if (document.readyState !== 'complete') window.addEventListener('load', again, { once: true });
  }

  // Lazy figures below the fold would print as empty boxes.
  window.addEventListener('beforeprint', () => {
    document.querySelectorAll('#view-rules img[loading="lazy"]').forEach(img => { img.loading = 'eager'; });
  });

  window.DZCRules = { open };
})();
