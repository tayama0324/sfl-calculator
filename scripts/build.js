import { cp, mkdir, rm } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await rm(new URL('dist', root), { recursive: true, force: true });
await mkdir(new URL('dist', root), { recursive: true });
await cp(new URL('docs', root), new URL('dist', root), { recursive: true });
console.log('Static site built: dist/');
