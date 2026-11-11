import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '../src/app');
const USER_FACING_ATTRIBUTES = ['placeholder', 'title', 'alt', 'aria-label', 'label'];
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const LETTER = /\p{L}/u;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.html') ? [path] : [];
  });

/** Index just past the `)` matching the `(` at `open`. */
const closeParen = (text, open) => {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i + 1;
  }
  return text.length;
};

/** Blanks comments, interpolations and control-flow syntax, keeping every offset. */
const blank = (s) => s.replace(/[^\n]/g, ' ');
const stripSyntax = (html) => {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\{\{[\s\S]*?\}\}/g, blank)
    .replace(/@let\s[^;]*;/g, blank);
  const block = /@(?:else\s+if|if|for|switch|case|defer)\s*\(/g;
  let m;
  while ((m = block.exec(text))) {
    const end = closeParen(text, m.index + m[0].length - 1);
    text = text.slice(0, m.index) + blank(text.slice(m.index, end)) + text.slice(end);
    block.lastIndex = end;
  }
  return text.replace(/@(?:else|empty|default)\b/g, blank).replace(/[{}]/g, ' ');
};

const problems = [];
for (const file of walk(root)) {
  const source = readFileSync(file, 'utf8');
  const text = stripSyntax(source);
  const lineOf = (index) => source.slice(0, index).split('\n').length;
  const report = (index, what) =>
    problems.push(`${relative(root, file)}:${lineOf(index)}  ${what.trim().slice(0, 80)}`);

  const stack = [];
  const translated = () => stack.length > 0 && stack[stack.length - 1].i18n;
  let i = 0;
  let textStart = 0;
  const checkText = (end) => {
    const between = text.slice(textStart, end);
    if (LETTER.test(between) && !translated()) report(textStart + between.search(/\S/), between);
  };
  while (i < text.length) {
    if (text[i] !== '<') {
      i++;
      continue;
    }
    checkText(i);
    let j = i + 1;
    let quote = null;
    while (j < text.length && (quote || text[j] !== '>')) {
      if (quote) {
        if (text[j] === quote) quote = null;
      } else if (text[j] === '"' || text[j] === "'") quote = text[j];
      j++;
    }
    const tag = source.slice(i, j + 1);
    const closing = /^<\//.test(tag);
    const name = /^<\/?\s*([\w-]+)/.exec(tag)?.[1]?.toLowerCase() ?? '';
    if (closing) {
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
    } else {
      const attrs = new Map(
        [...tag.matchAll(/\s([\w.:@-]+)(?:\s*=\s*"([^"]*)")?/g)].map((a) => [a[1], a[2] ?? '']),
      );
      for (const attr of USER_FACING_ATTRIBUTES) {
        const value = attrs.get(attr);
        if (value && LETTER.test(value) && !attrs.has(`i18n-${attr}`)) {
          report(i, `${attr}="${value}" needs i18n-${attr}`);
        }
      }
      const selfClosing = /\/\s*>$/.test(tag) || VOID_ELEMENTS.has(name);
      if (!selfClosing) stack.push({ name, i18n: attrs.has('i18n') || translated() });
    }
    i = j + 1;
    textStart = i;
  }
  checkText(text.length);
}

const files = walk(root).length;
if (problems.length) {
  process.stderr.write(
    `Text not marked for translation (add i18n="@@id" / i18n-<attr>, or use $localize):\n  ${problems.join('\n  ')}\n`,
  );
  process.exit(1);
}
process.stdout.write(`Templates: all text is marked for translation (${files} files checked).\n`);
