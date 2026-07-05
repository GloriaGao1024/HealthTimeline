# Health Timeline OCR Backend - Vercel 部署

这是给微信转发版 HTML 使用的稳定公网 OCR 后端。部署后接口地址是：

```text
https://你的-vercel-域名.vercel.app/api/ocr
```

## 1. 部署到 Vercel

方式 A：网页导入项目

1. 登录 Vercel。
2. 新建 Project。
3. 上传或导入本目录 `deploy/vercel`。
4. 配置环境变量。
5. Deploy。

方式 B：Vercel CLI

```bash
cd deploy/vercel
npx vercel
npx vercel --prod
```

## 2. 环境变量

在 Vercel Project Settings -> Environment Variables 中设置：

```text
BAIDU_OCR_API_KEY=你的百度 OCR API Key
BAIDU_OCR_SECRET_KEY=你的百度 OCR Secret Key
```

不要把这两个值写进 HTML。

## 3. 更新微信 HTML

部署成功后，把 `outputs/health-timeline-mvp-wechat-ocr.html` 中这一行：

```js
const OCR_API_BASE = "https://two-friends-cry.loca.lt";
```

改成：

```js
const OCR_API_BASE = "https://你的-vercel-域名.vercel.app";
```

然后重新通过微信发送这个 HTML 文件。

## 4. 测试

```bash
curl -I -X OPTIONS https://你的-vercel-域名.vercel.app/api/ocr \
  -H "Origin: null" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

应该看到：

```text
HTTP/2 204
access-control-allow-origin: *
```
