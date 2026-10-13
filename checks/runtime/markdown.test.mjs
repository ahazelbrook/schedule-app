// Unit test for app/markdown.js (the rules wiki's renderer and the importer's split), in a vm. Every text here is
// made-up placeholder prose; the real rulebooks are never in this repository.
//   node checks/runtime/markdown.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'markdown.js'), 'utf8'), ctx, { filename: 'markdown.js' });
const M = ctx.B68Markdown;

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || 'not equal') + ': got ' + A + ' want ' + B); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
const has = (html, s) => ok(html.includes(s), 'missing ' + JSON.stringify(s) + ' in ' + html);
const lacks = (html, s) => ok(!html.includes(s), 'unexpected ' + JSON.stringify(s) + ' in ' + html);

/* the only tags and attributes the renderer may ever produce: anything else in the output is a leak of the source */
const TAGS = new Set(['p', 'br', 'strong', 'em', 'del', 'mark', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'blockquote', 'div', 'details', 'summary', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
const ATTRS = new Set(['href', 'target', 'rel', 'class', 'data-callout', 'start', 'open', 'aria-hidden']);
function inert(html) {
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*\/?>/g;
  let rest = html.replace(re, (m, tag, attrs) => {
    ok(TAGS.has(tag.toLowerCase()), 'tag <' + tag + '> in ' + html);
    for (const a of attrs.matchAll(/\s([a-zA-Z-]+)(?:="([^"]*)")?/g)) {
      ok(ATTRS.has(a[1]), 'attribute ' + a[1] + ' in ' + html);
      if (a[1] === 'href') ok(/^(https?:\/\/|#|[^:]*$)/i.test(a[2].replace(/&amp;/g, '&')), 'href ' + a[2]);
    }
    return '';
  });
  ok(!/[<>]/.test(rest), 'a raw angle bracket outside a tag: ' + rest.match(/.{0,30}[<>].{0,30}/));
}

await test('raw HTML is escaped, never passed through: <script>, onerror=, iframes, styles, comments', async () => {
  const src = [
    '<script>window.__xss = 1</script>',
    '<img src=x onerror=alert(1)>',
    '<IMG SRC="x" OnError="alert(2)">',
    '<iframe src="javascript:alert(3)"></iframe>',
    '<a href="javascript:alert(4)" onclick="alert(5)">click</a>',
    '<style>body{display:none}</style><!-- hidden --><svg onload=alert(6)>',
    'text <b onmouseover=alert(7)>bold</b> text',
    '`<script>x</script>` and ```<script>y</script>```',
    '```html', '<script>z()</script>', '```',
    '| <img src=x onerror=1> | b |', '|---|---|', '| <script>c</script> | d |',
    '> [!note] <script>t</script>', '> body <img src=x onerror=2>',
    '- <script>li</script>',
    '# <script>h</script>',
    '[<script>l</script>](https://ok.test)',
    '[[<script>w</script>]] ![[<img src=x onerror=3>]]',
  ].join('\n');
  const html = M.render(src, { resolve: () => null });
  inert(html);
  for (const bad of ['<script', '<img', '<iframe', '<style', '<svg', '<b ', '<!--']) lacks(html, bad);
  has(html, '&lt;script&gt;window.__xss = 1&lt;/script&gt;');
  has(html, '&lt;img src=x onerror=alert(1)&gt;');      // visible as text, not an element
  ok(!/<[^>]*\sonerror\s*=/i.test(html) && !/<[^>]*\sonclick\s*=/i.test(html), 'an event attribute inside a tag');
});

await test('links: only http, https and relative addresses; javascript:, data:, vbscript: and the rest become text', async () => {
  for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', '\u0001javascript:x', 'data:text/html,<b>x</b>', 'vbscript:x', 'file:///etc/passwd', 'blob:x', 'ftp://x.test', 'mailto:a@b.test', '//evil.test/x', '\\\\evil.test', '/\\evil.test', 'x:y']) {
    const html = M.render('[click me](' + u.replace(/ /g, '') + ')');
    lacks(html, '<a'); lacks(html, 'href'); has(html, 'click me'); inert(html);
  }
  has(M.render('[a](https://ok.test/x?y=1&z=2)'), '<a href="https://ok.test/x?y=1&amp;z=2" target="_blank" rel="noopener noreferrer">a</a>');
  has(M.render('[a](HTTP://ok.test)'), 'href="HTTP://ok.test"');
  has(M.render('[a](some/page)'), '<a href="some/page">a</a>');
  has(M.render('[a](#section)'), '<a href="#section">a</a>');
  has(M.render('[a](../up/page?x=1)'), 'href="../up/page?x=1"');
  const quoted = M.render('[a](http://x" onmouseover="alert(1))');
  lacks(quoted, '<a'); inert(quoted);
  has(M.render('see https://ok.test/page.'), '<a href="https://ok.test/page" target="_blank" rel="noopener noreferrer">https://ok.test/page</a>.');
  lacks(M.render('plain javascript:alert(1) text'), '<a');
  const nested = M.render('[https://ok.test/a](https://ok.test/a)');
  eq((nested.match(/<a /g) || []).length, 1, 'no link inside a link: ' + nested);
  lacks(M.render('![x](javascript:alert(1))'), '<img');
  has(M.render('![a picture](https://ok.test/p.png)'), 'a picture'); lacks(M.render('![a picture](https://ok.test/p.png)'), '<img');
});

await test('blocks: headings (one level down), paragraphs with line breaks, rules, quotes', async () => {
  const html = M.render('# One\n\nfirst line\nsecond line\n\n## Two\n\n---\n\n###### Six\n\n####### not a heading\n\n> quoted\n> more');
  has(html, '<h2>One</h2>'); has(html, '<h3>Two</h3>'); has(html, '<h6>Six</h6>');
  has(html, '<p>first line<br>second line</p>'); has(html, '<hr>'); has(html, '<p>####### not a heading</p>');
  has(html, '<blockquote><p>quoted<br>more</p></blockquote>');
  has(M.render('# One', { headingOffset: 0 }), '<h1>One</h1>');
  inert(html);
});

await test('inline: bold, italic, both, strike, highlight, inline code, escapes, block ids', async () => {
  const html = M.render('**bold** and *it* and _it2_ and __b2__ and ***both*** and ~~gone~~ and ==marked== and `a <b> *c*` and \\*literal\\* and 2 * 3 * 4 and snake_case_name ^abc123');
  has(html, '<strong>bold</strong>'); has(html, '<em>it</em>'); has(html, '<em>it2</em>'); has(html, '<strong>b2</strong>');
  has(html, '<strong><em>both</em></strong>'); has(html, '<del>gone</del>'); has(html, '<mark class="rl-hl">marked</mark>');
  has(html, '<code>a &lt;b&gt; *c*</code>'); has(html, '*literal*'); has(html, '2 * 3 * 4'); has(html, 'snake_case_name');
  lacks(html, '^abc123'); inert(html);
});

await test('lists: bullets, numbers, nesting, tasks, a list after a paragraph', async () => {
  const html = M.render('intro\n- one\n- two\n  - two a\n  - two b\n    - deep\n- three\n\n3. third\n4. fourth\n\n- [ ] todo\n- [x] done');
  has(html, '<p>intro</p>');
  has(html, '<ul><li>one</li><li>two<ul><li>two a</li><li>two b<ul><li>deep</li></ul></li></ul></li><li>three</li></ul>');
  has(html, '<ol start="3"><li>third</li><li>fourth</li></ol>');
  has(html, '<span class="rl-task" aria-hidden="true">\u2610</span> todo'); has(html, 'rl-task done');
  const tab = M.render('- a\n\t- b');
  has(tab, '<ul><li>a<ul><li>b</li></ul></li></ul>');
  inert(html);
});

await test('tables: header, alignment, escaped pipes, short rows, wrapped for a phone', async () => {
  const html = M.render('| Name | Cost | Note |\n|:--|--:|:-:|\n| a | 1 | x \\| y |\n| b | 2 |\n\nafter');
  has(html, '<div class="rl-tablewrap"><table>');
  has(html, '<th>Name</th>'.replace('<th>', '<th class="al-l">')); has(html, '<th class="al-r">Cost</th>'); has(html, '<th class="al-c">Note</th>');
  has(html, '<td class="al-c">x | y</td>'); has(html, '<td class="al-c"></td>');
  has(html, '<p>after</p>'); inert(html);
  lacks(M.render('a | b\nno separator'), '<table');
});

await test('callouts: > [!note] with and without a title, folded, nested content', async () => {
  const html = M.render('> [!warning] Mind the *gap*\n> first\n>\n> - item\n\n> [!tip]\n> plain\n\n> [!faq]- Folded\n> hidden\n\n> [!info]+ Open\n> shown');
  has(html, '<div class="rl-callout" data-callout="warning"><div class="rl-callout-title">Mind the <em>gap</em></div><div class="rl-callout-body"><p>first</p><ul><li>item</li></ul></div></div>');
  has(html, 'data-callout="tip"><div class="rl-callout-title">Tip</div>');
  has(html, '<details class="rl-callout" data-callout="faq"><summary class="rl-callout-title">Folded</summary>');
  has(html, '<details class="rl-callout" data-callout="info" open>');
  const evil = M.render('> [!x" onmouseover="alert(1)] t');
  lacks(evil, 'data-callout="x'); inert(evil);
  inert(html);
});

await test('wikilinks: resolved through the resolver, aliases, headings, unresolved as plain text; embeds', async () => {
  const seen = [];
  const resolve = (page, frag) => { seen.push([page, frag]); return /^(Downtime|Folder\/Page|Page)$/i.test(page) ? { href: '#rules/b68/' + page.toLowerCase().replace(/\W+/g, '-') + (frag ? '/' + frag : '') } : null; };
  const html = M.render('See [[Downtime]], [[Downtime|the rest]], [[Page#Some Heading]], [[Nowhere]], [[#Here]], [[Missing|shown text]], ![[Downtime]], ![[picture.png]], ![[Page#Heading]], [[a<b>c]] and [x](Downtime.md) and [y](Gone.md)', { resolve });
  has(html, '<a class="rl-wl" href="#rules/b68/downtime">Downtime</a>');
  has(html, '<a class="rl-wl" href="#rules/b68/downtime">the rest</a>');
  has(html, '<a class="rl-wl" href="#rules/b68/page/Some Heading">Page &gt; Some Heading</a>');
  has(html, ', Nowhere,'); has(html, ', Here,'); has(html, ', shown text,');
  has(html, '<a class="rl-wl rl-embed" href="#rules/b68/downtime">Downtime</a>');
  lacks(html, 'picture.png');
  has(html, '<a href="#rules/b68/downtime">x</a>'); has(html, ' and y');
  has(html, 'a&lt;b&gt;c');
  lacks(html, '<a class="rl-wl" href="#rules/b68/nowhere"');
  ok(seen.some((s) => s[0] === 'Page' && s[1] === 'Some Heading'), 'the heading part reaches the resolver');
  inert(html);
  lacks(M.render('[[Downtime]]'), '<a');           // no resolver: plain text
});

await test('frontmatter: stripped from the render, title and aliases read (inline list, block list, quotes, CRLF)', async () => {
  const src = '---\ntitle: "Down time"\naliases:\n  - Rest\n  - \'Time off\'\ntags: [a, b]\n---\n# Body\n\ntext';
  const fm = M.parseFrontmatter(src);
  eq([fm.meta.title, fm.meta.aliases], ['Down time', ['Rest', 'Time off']]);
  eq(M.parseFrontmatter('---\r\naliases: [One, "Two, still two"]\r\n---\r\nx').meta.aliases, ['One', 'Two, still two']);
  const html = M.render(src);
  lacks(html, 'aliases'); lacks(html, 'Time off'); has(html, '<h2>Body</h2>');
  eq(M.parseFrontmatter('no frontmatter\n---\nnot this').body, 'no frontmatter\n---\nnot this');
  eq(M.parseFrontmatter('---\n---\nbody').body, 'body');
  has(M.render('---\ntitle: x\n---\n\n---\n\nafter'), '<hr>');
  has(M.render('before %% a hidden\nmulti-line comment %% after'), 'before  after');
});

await test('plain(): the search text drops markup, keeps words', async () => {
  const t = M.plain('---\ntitle: T\n---\n# Head\n\n> [!note] Tip\n> **bold** [[Page#h|alias]] and [lnk](http://x.test) `code`\n\n- item one\n1. item two\n| a | b |\n|---|---|\n| c | d |\n![[img.png]]');
  eq(t, 'Head Tip bold alias and lnk code item one item two a b c d');
  eq(M.plain('[[Page#Sub]] [[Solo]]'), 'Page Sub Solo');
});

await test('deep nesting and odd input do not hang or throw', async () => {
  const deep = Array.from({ length: 40 }, (_, i) => '  '.repeat(i) + '- level ' + i).join('\n');
  inert(M.render(deep));
  inert(M.render('>'.repeat(60) + ' deep quote'));
  inert(M.render('\u0000\u0001 \u0000 5 \u0001 [x](\u0000)'));
  inert(M.render('`unclosed\n\n```\nunclosed fence <script>'));
  eq(M.render(''), ''); eq(M.render(null), '');
  const long = 'word '.repeat(40000);
  const t0 = Date.now(); M.render(long + '\n\n' + '[a](b) '.repeat(5000)); ok(Date.now() - t0 < 3000, 'slow on large input: ' + (Date.now() - t0) + ' ms');
});

/* ---------- splitFile ---------- */
await test('splitFile: a file with no headings is one entry named by the file; frontmatter title and aliases become keys', async () => {
  const a = M.splitFile('Rulebook/Crew/Heat.md', 'Plain placeholder prose about lanterns.');
  eq(a, [{ title: 'Heat', trail: 'Rulebook > Crew', keys: '', body: 'Plain placeholder prose about lanterns.' }]);
  const b = M.splitFile('Heat.md', '---\ntitle: Warm\naliases: [Hot, Toasty]\n---\nBody only.');
  eq(b, [{ title: 'Warm', trail: '', keys: 'Warm\nHot\nToasty', body: 'Body only.' }].map((x) => ({ ...x, title: 'Warm' })));
  eq(M.splitFile('Empty.md', '---\ntitle: x\n---\n\n   \n'), [], 'an empty note makes no entry');
});

await test('splitFile: splits at H1 and H2, keeps the heading path, drops empty parents, ignores # inside fences', async () => {
  const src = 'Intro line before any heading.\n\n# Downtime\n\nlead text\n\n## Indulge Vice\n\nvice text\n```\n# not a heading\n```\n\n### small sub\n\nstays in vice\n\n## Recover\n\nrecover text\n\n# Empty Parent\n\n## Child\n\nchild text\n';
  const out = M.splitFile('Rulebook/Downtime.md', src);
  eq(out.map((e) => e.title), ['Downtime', 'Downtime', 'Indulge Vice', 'Recover', 'Child']);
  eq(out.map((e) => e.trail), ['Rulebook', 'Rulebook', 'Rulebook > Downtime', 'Rulebook > Downtime', 'Rulebook > Downtime > Empty Parent']);
  ok(out[0].body.startsWith('Intro line') && out[1].body === 'lead text', 'preamble then H1');
  ok(out[2].body.includes('# not a heading') && out[2].body.includes('### small sub') && out[2].body.includes('stays in vice'), 'fence and short H3 stay in the body');
  ok(!out.some((e) => e.title === 'Empty Parent'), 'an empty H1 is not an entry');
});

await test('splitFile: H3 starts an entry only when its section is long; oversize text is cut into parts', async () => {
  const filler = ('Placeholder sentence about a wobbling lantern. ').repeat(40);
  const src = '## Big\n\n' + filler + '\n\n### Alpha\n\n' + filler + '\n\n### Beta\n\n' + filler + '\n\n## Small\n\n### Tiny\n\nshort\n';
  const out = M.splitFile('Big.md', src, { longSection: 1500 });
  eq(out.map((e) => e.title), ['Big', 'Alpha', 'Beta', 'Small'], 'H3 split inside the long section only');
  eq(out[1].trail, 'Big', 'trail: file name (the H2 is its parent)'.length ? out[1].trail : '');
  ok(out[3].body.includes('### Tiny'), 'the short section keeps its H3');
  const huge = Array.from({ length: 400 }, (_, i) => 'Paragraph ' + i + ' ' + 'x'.repeat(300)).join('\n\n');
  const parts = M.splitFile('Huge.md', '# Huge\n\n' + huge, { maxChars: 20000 });
  ok(parts.length > 3 && parts[0].title === 'Huge' && parts[1].title === 'Huge (part 2)', parts.map((p) => p.title).slice(0, 3));
  ok(parts.every((p) => p.body.length <= 20000), 'every part fits');
  eq(parts.map((p) => p.body).join('\n\n').replace(/\s+/g, ' '), huge.replace(/\s+/g, ' '), 'nothing lost');
  const oneLine = M.splitFile('Line.md', 'y'.repeat(50000), { maxChars: 20000 });
  ok(oneLine.length === 3 && oneLine.every((p) => p.body.length <= 20000), 'a single unbroken line is cut too');
});

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
