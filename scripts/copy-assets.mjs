/**
 * Postbuild: 复制 tsc 不会处理的资源到 dist
 *  - src/db/migrations/*.sql → dist/db/migrations/
 *  - src/public/** → dist/public/  (静态资源: css, js, 字体, 图片...)
 */
import { readdirSync, mkdirSync, copyFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcMigrations = join(root, 'src/db/migrations');
const distMigrations = join(root, 'dist/db/migrations');
const srcPublic = join(root, 'src/public');
const distPublic = join(root, 'dist/public');

// React 前端构建产物 → src/public/admin/
// src/public/admin/ 是 Dockerfile 不会读取的本地缓存, 必须始终与最新前端构建保持一致,
// 否则 copyRecursive(srcPublic → distPublic) 会用陈旧前端覆盖 dist。
const clientDist = join(root, 'freellm-hub-client/dist');
const srcPublicAdmin = join(srcPublic, 'admin');
if (existsSync(clientDist)) {
  if (existsSync(srcPublicAdmin)) rmSync(srcPublicAdmin, { recursive: true, force: true });
  copyRecursive(clientDist, srcPublicAdmin);
  console.log(`[copy-assets] freellm-hub-client/dist/ → src/public/admin/ (前端同步)`);
}

function copyRecursive(src, dst) {
  if (!existsSync(src)) return;
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const sp = join(src, entry);
    const dp = join(dst, entry);
    if (statSync(sp).isDirectory()) {
      copyRecursive(sp, dp);
    } else {
      copyFileSync(sp, dp);
      console.log(`[copy-assets] ${relative(root, sp)} → ${relative(root, dp)}`);
    }
  }
}

// Migrations
if (!existsSync(distMigrations)) mkdirSync(distMigrations, { recursive: true });
const sqlFiles = readdirSync(srcMigrations).filter((f) => f.endsWith('.sql'));
for (const f of sqlFiles) {
  copyFileSync(join(srcMigrations, f), join(distMigrations, f));
}
console.log(`[copy-assets] ${sqlFiles.length} migration files copied`);

// Public (css, js, etc)
if (existsSync(srcPublic)) {
  copyRecursive(srcPublic, distPublic);
  console.log(`[copy-assets] public/ copied`);
}
