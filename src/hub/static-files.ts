// The display's files. Only the files listed here are served, read once at start; nothing is looked up
// from a request path.
//
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';

export interface StaticFile {
  body: Buffer;
  type: string;
}

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** Hand-written files in ui/, by the path they are served at. */
const UI_FILES = [
  'app.css',
  'azentrius.css',
  'icon.svg',
  'DMSans.woff2',
  'DMSerifDisplay-Regular.woff2',
  // azentrius.css asks for Red Hat Mono where Cockpit keeps it; the same path works here.
  'static/fonts/RedHatMono/RedHatMonoVF.woff2',
];

const MODULE_NAME = /^[a-z0-9-]+\.js$/;

/**
 * @param uiRoot  ui/ with index.html, styles and fonts
 * @param webRoot dist/ui/ with the compiled display modules
 */
export function loadStaticFiles(uiRoot: string, webRoot: string): { files: Map<string, StaticFile>; missingBuild: boolean } {
  const files = new Map<string, StaticFile>();
  for (const name of UI_FILES) {
    files.set(`/${name}`, { body: fs.readFileSync(path.join(uiRoot, name)), type: TYPES[path.extname(name)]! });
  }
  const modules = fs.existsSync(webRoot) ? fs.readdirSync(webRoot).filter((name) => MODULE_NAME.test(name)) : [];
  for (const name of modules) {
    files.set(`/${name}`, { body: fs.readFileSync(path.join(webRoot, name)), type: TYPES['.js']! });
  }
  return { files, missingBuild: !modules.includes('app.js') };
}

export function loadIndexTemplate(uiRoot: string): string {
  return fs.readFileSync(path.join(uiRoot, 'index.html'), 'utf8');
}

/** Fills the placeholders `{{name}}` of index.html. Values are escaped for an HTML attribute. */
export function renderIndex(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : escapeAttribute(value);
  });
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
