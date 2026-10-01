// Turns dist-single/index.html into a page fragment for hosts that supply their own
// <!doctype>, <html>, <head> and <body> (for example a claude.ai artifact).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-single/index.html', 'utf8');
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]);

const title = pick(/<title>[\s\S]*?<\/title>/g);
const links = pick(/<link\b[^>]*>/g);
const styles = pick(/<style\b[^>]*>[\s\S]*?<\/style>/g);
const scripts = pick(/<script\b[^>]*>[\s\S]*?<\/script>/g);
const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? '';
const bodyWithoutScripts = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').trim();

const out = [...title, ...links, ...styles, bodyWithoutScripts, ...scripts].join('\n');
mkdirSync('dist-artifact', { recursive: true });
writeFileSync('dist-artifact/index.html', out);
console.log(`dist-artifact/index.html  ${(out.length / 1024).toFixed(1)} kB`);
