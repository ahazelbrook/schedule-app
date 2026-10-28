// A small DOM for the unit checks of the Blade panel (no jsdom in this repo): real nodes for everything the panel BUILDS (createElement,
// createTextNode, appendChild, insertBefore, replaceChild, removeChild, textContent, classList, attributes, a serialiser), so a test can read what
// the renderer made, and can see that model text came out escaped. The panel's one big static template is not parsed: the host is a stub whose
// querySelector hands back one element per selector (see fakeBrowser in gm-assist-panel.test.mjs).
//
// innerHTML: a setter is recorded in `writes` (element selector or tag, and the string) and clears the children; a getter serialises the children
// (text escaped), or returns the last string written when nothing has been appended since. That is what lets a test assert the ONLY string
// written as HTML is B68Markdown's output.

export const writes = [];

const VOID = new Set(['img', 'br', 'input', 'hr']);
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

export class MiniText {
  constructor(data) { this.nodeType = 3; this.data = String(data); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return p.children[i + 1] || null; }
  get outerHTML() { return escText(this.data); }
}

export class MiniEl {
  constructor(tag, onFocus) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.attrs = {}; this.children = []; this.parentNode = null; this.hidden = false;
    this.disabled = false; this.value = ''; this.focused = 0; this._raw = null; this._onFocus = onFocus || null; this.sel = '';
    const self = this, cl = new Set();
    this.classList = {
      add(...c) { c.forEach((x) => cl.add(x)); self._syncClass(cl); }, remove(...c) { c.forEach((x) => cl.delete(x)); self._syncClass(cl); },
      toggle(c, on) { const want = on === undefined ? !cl.has(c) : !!on; if (want) cl.add(c); else cl.delete(c); self._syncClass(cl); return want; },
      contains(c) { return cl.has(c); },
    };
    this._cl = cl;
  }
  _syncClass(cl) { this.attrs.class = [...cl].join(' '); }
  get className() { return this.attrs.class || ''; }
  set className(v) { this._cl.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => this._cl.add(c)); this.attrs.class = [...this._cl].join(' '); }
  get id() { return this.attrs.id || ''; }
  setAttribute(k, v) { if (k === 'class') this.className = v; else this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return this.attrs[k] !== undefined; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.children[p.children.indexOf(this) + 1] || null; }
  _detach(n) { if (n.parentNode) { const p = n.parentNode; p.children.splice(p.children.indexOf(n), 1); n.parentNode = null; } }
  appendChild(n) { this._raw = null; this._detach(n); this.children.push(n); n.parentNode = this; return n; }
  insertBefore(n, ref) {
    this._raw = null; if (!ref) return this.appendChild(n);
    this._detach(n); const i = this.children.indexOf(ref); if (i < 0) throw new Error('insertBefore: the reference node is not a child');
    this.children.splice(i, 0, n); n.parentNode = this; return n;
  }
  removeChild(n) { const i = this.children.indexOf(n); if (i < 0) throw new Error('removeChild: not a child'); this.children.splice(i, 1); n.parentNode = null; return n; }
  replaceChild(n, old) { const i = this.children.indexOf(old); if (i < 0) throw new Error('replaceChild: not a child'); this._detach(n); const j = this.children.indexOf(old); this.children[j] = n; n.parentNode = this; old.parentNode = null; return old; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._raw = null; if (String(v) !== '') this.appendChild(new MiniText(v)); }
  get innerHTML() { return this._raw !== null ? this._raw : this.children.map((c) => c.outerHTML).join(''); }
  set innerHTML(v) { writes.push({ el: this.sel || this.tagName.toLowerCase(), html: String(v) }); this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._raw = String(v); }
  get outerHTML() {
    const a = Object.keys(this.attrs).filter((k) => k !== 'class' || this.attrs.class).map((k) => ' ' + k + '="' + escAttr(this.attrs[k]) + '"').join('');
    const t = this.tagName.toLowerCase();
    return '<' + t + a + '>' + (VOID.has(t) ? '' : this.innerHTML + '</' + t + '>');
  }
  focus() { this.focused++; if (this._onFocus) this._onFocus(this); }
  matches(sel) { return matchesSimple(this, sel); }
  closest(sel) { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (matchesSimple(x, sel)) return x; return null; }
  querySelectorAll(sel) { const out = []; const alts = sel.split(',').map((s) => s.trim()).filter(Boolean); walk(this, (n) => { if (alts.some((a) => matchesChain(n, a, this))) out.push(n); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  scrollIntoView() {}
}

function walk(root, fn) { for (const c of root.children) if (c.nodeType === 1) { fn(c); walk(c, fn); } }
function matchesSimple(n, sel) {
  if (n.nodeType !== 1) return false;
  const re = /(^[a-z][a-z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]/gi;
  let m, any = false;
  while ((m = re.exec(sel))) {
    any = true;
    if (m[1] && n.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
    if (m[2] && n.attrs.id !== m[2]) return false;
    if (m[3] && !n._cl.has(m[3])) return false;
    if (m[4]) { const v = n.attrs[m[4]]; if (v === undefined) return false; const want = m[5] !== undefined ? m[5] : m[6]; if (want !== undefined && v !== want) return false; }
  }
  return any;
}
function matchesChain(n, chain, scope) {
  const parts = chain.split(/\s+/);
  if (!matchesSimple(n, parts[parts.length - 1])) return false;
  let x = n.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) { while (x && x !== scope && !matchesSimple(x, parts[i])) x = x.parentNode; if (!x || x === scope) return false; x = x.parentNode; }
  return true;
}
