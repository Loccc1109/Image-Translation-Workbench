# 译图 · React/Vite 静态前端版

这个目录是无需 Node/Fastify 后端的静态版本。任务、原图、生成结果、配置和 API Key 都保存在当前浏览器的 IndexedDB 中。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建结果在 `dist/`，可直接部署到 Cloudflare Pages、GitHub Pages 或其他静态托管服务。

## Cloudflare Pages

- Framework preset：Vite
- Root directory：`static-frontend`
- Build command：`npm run build`
- Build output directory：`dist`

如果在仓库根目录配置，则使用：

```text
Root directory: static-frontend
Build command: npm run build
Output directory: dist
```

## 注意事项

1. Gemini 和图片生成接口必须允许浏览器跨域请求（CORS），否则静态前端会被浏览器拦截。
2. API Key 会保存在浏览器 IndexedDB，并会直接发送到对应的第三方接口；不要在公共电脑上使用。
3. 清理浏览器站点数据会删除任务、图片和配置。不同浏览器、不同域名之间的数据不共享。
4. 浏览器无法保证永久保存超大图片，建议控制单张图片大小和任务数量。
5. 静态版本中的“一键校验”暂时保留界面流程，实际图片校验功能需要上游 Gemini 接口调用；如需启用，应在前端增加校验请求。
