#!/usr/bin/env node
// Hwi's 14-day practice lessons: markdown -> store-core/lessons-content.js (subject, preview, html, text per day).
//   node scripts/lessons-build.mjs          build from content/hwi-lessons/day-01..14.md
//   node scripts/lessons-build.mjs --sync   first copy the reviewed source from LESSONS_SRC
//                                           (default: portfolio-desk/education/practice-lessons), then build
// No dependencies: a small markdown subset (headings, paragraphs, lists, task lists, quotes, tables, code, **b**, *i*, `c`).
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'content/hwi-lessons');
const SRC = process.env.LESSONS_SRC ?? '/home/box/agent-data/shared/portfolio-desk/education/practice-lessons';
export const DAYS = 14;
const pad = (n) => String(n).padStart(2, '0');

export function parseFront(md) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md.replace(/\r\n/g, '\n'));
  if (!m) throw new Error('missing front matter');
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return { meta, body: md.replace(/\r\n/g, '\n').slice(m[0].length) };
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inlineHtml(s) {
  const parts = s.split(/(`[^`]+`)/);
  return parts.map((p) => p.startsWith('`') && p.endsWith('`') && p.length > 1
    ? `<code style="background:#f3ece0;padding:1px 4px;border-radius:3px;font-size:90%">${esc(p.slice(1, -1))}</code>`
    : esc(p).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>')).join('');
}
const inlineText = (s) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');

/** Markdown subset -> { html, text } */
export function render(body) {
  const lines = body.split('\n');
  const html = [], text = [];
  let i = 0;
  const P = 'margin:0 0 14px;line-height:1.55';
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if (l.startsWith('```')) {
      const buf = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      html.push(`<pre style="background:#f3ece0;padding:10px 12px;border-radius:6px;font-size:13px;line-height:1.45;white-space:pre-wrap">${esc(buf.join('\n'))}</pre>`);
      text.push(buf.map((b) => '    ' + b).join('\n'), '');
    } else if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) {
      const lv = m[1].length, t = m[2];
      const size = lv === 1 ? 24 : lv === 2 ? 18 : 16;
      html.push(`<h${lv} style="font-family:Georgia,serif;font-size:${size}px;color:#5a3a12;margin:${lv === 1 ? 0 : 22}px 0 10px">${inlineHtml(t)}</h${lv}>`);
      text.push(lv === 1 ? inlineText(t).toUpperCase() : inlineText(t), lv === 1 ? '='.repeat(Math.min(60, t.length)) : '-'.repeat(Math.min(60, t.length)), '');
      i++;
    } else if (l.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const [head, , ...rest] = rows;
      html.push('<table style="border-collapse:collapse;width:100%;margin:0 0 14px;font-size:14px">'
        + `<tr>${cells(head).map((c) => `<th style="text-align:left;border-bottom:2px solid #d9c7a7;padding:6px">${inlineHtml(c)}</th>`).join('')}</tr>`
        + rest.map((r) => `<tr>${cells(r).map((c) => `<td style="vertical-align:top;border-bottom:1px solid #eadfcb;padding:6px">${inlineHtml(c)}</td>`).join('')}</tr>`).join('')
        + '</table>');
      for (const r of rest) { const [a, ...b] = cells(r); text.push(`- ${inlineText(a)}: ${inlineText(b.join(' '))}`); }
      text.push('');
    } else if (l.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote style="margin:0 0 14px;padding:10px 14px;border-left:4px solid #c8862a;background:#fbf6ee">${buf.map((b) => `<p style="margin:0;line-height:1.55">${inlineHtml(b)}</p>`).join('')}</blockquote>`);
      text.push(...buf.map((b) => '  > ' + inlineText(b)), '');
    } else if (/^(- |\d+\. )/.test(l)) {
      const ordered = /^\d+\. /.test(l), items = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) {
        let it = lines[i++].replace(/^(- |\d+\. )/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) it += ' ' + lines[i++].trim();
        items.push(it);
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag} style="margin:0 0 14px;padding-left:22px">${items.map((it) => {
        const box = /^\[ \]\s+/.exec(it);
        return `<li style="margin:0 0 6px;line-height:1.5">${box ? '&#9744; ' + inlineHtml(it.slice(box[0].length)) : inlineHtml(it)}</li>`;
      }).join('')}</${tag}>`);
      items.forEach((it, k) => text.push(`${ordered ? `${k + 1}.` : '-'} ${inlineText(it.replace(/^\[ \]\s+/, '[ ] '))}`));
      text.push('');
    } else {
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#|>|\||- |\d+\. |```)/.test(lines[i])) buf.push(lines[i++]);
      const isFoot = buf.length === 1 && /^\*[^*].*\*$/.test(buf[0]);
      html.push(`<p style="${P}${isFoot ? ';font-size:13px;color:#7a6a55' : ''}">${buf.map(inlineHtml).join('<br>')}</p>`);
      text.push(buf.map(inlineText).join('\n'), '');
    }
  }
  return { html: html.join('\n'), text: text.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

export function buildAll() {
  const out = [];
  for (let d = 1; d <= DAYS; d++) {
    const f = path.join(dir, `day-${pad(d)}.md`);
    const { meta, body } = parseFront(readFileSync(f, 'utf8'));
    if (Number(meta.day) !== d) throw new Error(`${f}: day ${meta.day} != ${d}`);
    for (const k of ['title', 'subject', 'preview']) if (!meta[k]) throw new Error(`${f}: missing ${k}`);
    if (!/^## Today's practice task for your bot$/m.test(body)) throw new Error(`${f}: missing practice task`);
    if (!/not financial advice/i.test(body)) throw new Error(`${f}: missing education-only line`);
    const words = body.split(/\s+/).filter(Boolean).length;
    const { html, text } = render(body);
    out.push({ day: d, title: meta.title, subject: meta.subject, preview: meta.preview, words, html, text });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--sync')) {
    for (let d = 1; d <= DAYS; d++) {
      const s = path.join(SRC, `day-${pad(d)}.md`);
      if (!existsSync(s)) throw new Error(`missing ${s}`);
      copyFileSync(s, path.join(dir, `day-${pad(d)}.md`));
    }
    console.log(`synced ${DAYS} lessons from ${SRC}`);
  }
  const all = buildAll();
  const js = `// GENERATED by scripts/lessons-build.mjs from content/hwi-lessons/*.md. Do not edit by hand.\nexport const LESSONS = ${JSON.stringify(all, null, 1)};\n`;
  writeFileSync(path.join(root, 'store-core/lessons-content.js'), js);
  console.log(`store-core/lessons-content.js: ${all.length} lessons, ${all.map((l) => l.words).join('/')} words`);
}
