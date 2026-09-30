#!/usr/bin/env node
/**
 * 版本同步：以 package.json 的 version 为唯一来源
 * - 生成 www/js/common/app-info.js（页面读取版本号）
 * - 把 www 下所有 HTML 中本地 CSS/JS 引用统一为 ?v=<version>，避免缓存参数不一致
 * 用法：node scripts/sync-version.mjs          写入
 *       node scripts/sync-version.mjs --check  仅校验，不一致时退出码为 1
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(ROOT, 'www');
const APP_INFO = join(WWW, 'js', 'common', 'app-info.js');
const checkOnly = process.argv.includes('--check');

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error(`package.json version 必须是 MAJOR.MINOR.PATCH，当前为：${version}`);
  process.exit(1);
}

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

/** 仅处理相对路径的本地资源，跳过外链、协议相对地址与 data URI */
const ASSET_REF = /\b(href|src)="((?!https?:|\/\/|data:)[^"?#]+\.(?:css|js))(?:\?v=[^"#]*)?"/g;

function appInfoSource() {
  return [
    '/* 由 scripts/sync-version.mjs 生成，请勿手动修改；版本号来源于 package.json */',
    '(function (global) {',
    "  'use strict';",
    `  global.MGAppInfo = Object.freeze({ version: '${version}' });`,
    "})(typeof window !== 'undefined' ? window : globalThis);",
    ''
  ].join('\n');
}

const stale = [];

const expectedInfo = appInfoSource();
if (!existsSync(APP_INFO) || readFileSync(APP_INFO, 'utf8') !== expectedInfo) {
  stale.push(relative(ROOT, APP_INFO));
  if (!checkOnly) writeFileSync(APP_INFO, expectedInfo);
}

for (const file of htmlFiles(WWW)) {
  const source = readFileSync(file, 'utf8');
  const next = source.replace(ASSET_REF, (_, attr, path) => `${attr}="${path}?v=${version}"`);
  if (next !== source) {
    stale.push(relative(ROOT, file));
    if (!checkOnly) writeFileSync(file, next);
  }
}

if (checkOnly) {
  if (stale.length) {
    console.error(`以下文件的版本号与 package.json（${version}）不一致，请运行 npm run version:sync：`);
    for (const f of stale) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`版本号一致：${version}`);
} else {
  console.log(stale.length ? `已同步到 ${version}：\n${stale.map(f => `  - ${f}`).join('\n')}` : `无需更新，已是 ${version}`);
}
