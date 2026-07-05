# HealthTimeline 服务器部署说明

这版包含静态网页、Supabase 数据库连接、百度 OCR 接口模板和 AI 问答接口模板。

## 1. 准备服务器

远程桌面登录 Windows 服务器后，安装：

- Node.js LTS 22 或更新版本
- Git 或压缩包解压工具

## 2. 放置项目

把整个项目文件夹放到：

```powershell
C:\health-timeline
```

进入项目：

```powershell
cd C:\health-timeline
```

## 3. 配置密钥

复制环境变量模板：

```powershell
copy .env.example .env
notepad .env
```

填写：

- `BAIDU_OCR_API_KEY`
- `BAIDU_OCR_SECRET_KEY`
- `AI_API_BASE`
- `AI_API_KEY`
- `AI_MODEL`

## 4. 启动网站

```powershell
npm install
npm start
```

看到类似下面内容就说明启动成功：

```text
HealthTimeline running at http://127.0.0.1:8792/
```

服务器本机浏览器打开：

```text
http://127.0.0.1:8792/
```

外部访问需要在腾讯云安全组和 Windows 防火墙放通 `8792` 端口，然后访问：

```text
http://服务器公网IP:8792/
```

## 5. 检查接口

浏览器打开：

```text
http://127.0.0.1:8792/api/health
```

如果看到：

```json
{"ok":true,"baiduOcrConfigured":true,"aiConfigured":true}
```

说明 OCR 和 AI 密钥都已经配置。

## 6. 后台数据说明

当前版本不是后台管理系统，但网页会通过 Supabase 读取允许访问的 `documents` 数据，并上传文件到 Storage、写入 `reports`。如果 Supabase 表权限或字段不匹配，页面会显示读取失败或只显示本机数据。
