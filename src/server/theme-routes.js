/* EasyVideo - 主题与自带组件接口。
 *
 *   GET    /api/themes                  内置主题 + 已安装主题包 + 当前生效
 *   GET    /api/themes/css              当前主题渲染出的 CSS
 *   POST   /api/themes/configure        { active, background, overrides }
 *   POST   /api/themes/install?name=x   .zst 主题包原始字节
 *   DELETE /api/themes/:id              卸载主题包
 *   GET    /api/themes/file/:name       主题包内的背景图
 *   GET    /api/components              自带组件巡检（ffmpeg/aria2/7z/node/zstd）
 *   POST   /api/components/refresh      重新扫描
 */
import fs from 'node:fs';
import * as themes from './themes.js';
import * as components from './components.js';
import { mimeFor } from './http.js';

export function mountThemes(R, H) {
  R.get('/api/themes', H(async (ctx, req, res) => {
    res.json({ ok: true, current: themes.current(), list: themes.list(), themes: themes.list() });
  }));

  R.get('/api/themes/css', H(async (ctx, req, res) => {
    // 必须是 text/css：浏览器不会把 text/plain 的 <link rel=stylesheet> 应用上去。
    res.buffer(Buffer.from(themes.css(), 'utf8'), 'text/css; charset=utf-8');
  }));

  R.post('/api/themes/configure', H(async (ctx, req, res) => {
    res.json({ ok: true, current: themes.configure(ctx.body || {}) });
  }));

  R.post('/api/themes/install', H(async (ctx, req, res) => {
    const name = String(ctx.query.get('name') || 'theme.zst');
    if (!ctx.rawBody || !ctx.rawBody.length) { const e = new Error('缺少主题包内容'); e.status = 400; throw e; }
    res.json({ ok: true, theme: themes.installPackage(ctx.rawBody, name), current: themes.current() });
  }));

  R.del('/api/themes/:id', H(async (ctx, req, res, params) => {
    if (!themes.removePackage(params.id)) { const e = new Error('主题不存在'); e.status = 404; throw e; }
    res.json({ ok: true, current: themes.current() });
  }));

  R.get('/api/themes/file/:name', H(async (ctx, req, res, params) => {
    const file = themes.packageFile(params.name);
    if (!file) { const e = new Error('文件不存在'); e.status = 404; throw e; }
    res.buffer(fs.readFileSync(file), mimeFor(file));
  }));

  R.get('/api/components', H(async (ctx, req, res) => {
    res.json(Object.assign({ ok: true }, await components.scan(false)));
  }));

  R.post('/api/components/refresh', H(async (ctx, req, res) => {
    res.json(Object.assign({ ok: true }, await components.scan(true)));
  }));

  return R;
}

export default { mountThemes };
