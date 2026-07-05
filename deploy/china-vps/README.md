# 国内稳定公网 OCR 后端部署方案

推荐平台：

- 腾讯云轻量应用服务器
- 阿里云轻量应用服务器
- 腾讯云 CVM / 阿里云 ECS

这个方案不依赖 Vercel，也不需要境外手机号。服务器只负责提供稳定公网 `/api/ocr`，百度密钥只放服务器环境变量里。

## 1. 购买服务器

建议配置：

- 系统：Ubuntu 22.04
- CPU / 内存：1 核 1G 起步即可
- 带宽：1-3 Mbps 起步
- 开放端口：`8787`

拿到公网 IP 后，假设是：

```text
http://你的服务器公网IP:8787
```

## 2. 上传项目

把当前项目目录上传到服务器，例如：

```bash
scp -r file-users-zzj-library-containers-com root@你的服务器IP:/opt/health-timeline
```

进入服务器：

```bash
ssh root@你的服务器IP
cd /opt/health-timeline
```

## 3. 配置百度 OCR 密钥

在服务器上创建 `.env`：

```bash
cat > .env <<'EOF'
BAIDU_OCR_API_KEY=你的百度 OCR API Key
BAIDU_OCR_SECRET_KEY=你的百度 OCR Secret Key
PORT=8787
EOF
```

不要把 `.env` 发给别人。

## 4. 直接用 Node 运行

安装 Node.js 22：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
```

启动：

```bash
npm start
```

长期运行建议用 pm2：

```bash
npm install -g pm2
pm2 start server.js --name health-timeline-ocr
pm2 save
pm2 startup
```

## 5. 或者用 Docker 运行

在项目根目录执行：

```bash
docker build -f deploy/china-vps/Dockerfile -t health-timeline-ocr .
docker run -d \
  --name health-timeline-ocr \
  --restart unless-stopped \
  -p 8787:8787 \
  --env-file .env \
  health-timeline-ocr
```

## 6. 测试接口

```bash
curl -I -X OPTIONS http://你的服务器公网IP:8787/api/ocr \
  -H "Origin: null" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

应该看到：

```text
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: *
```

## 7. 回填 HTML

部署好后，在本地运行：

```bash
node scripts/set-ocr-backend.js http://你的服务器公网IP:8787
```

然后重新把这个文件通过微信发给别人：

```text
outputs/health-timeline-mvp-wechat-ocr.html
```

别人下载后打开 HTML，就会调用你的稳定公网 OCR 后端。

## 8. 可选：绑定域名和 HTTPS

如果有域名，建议用 Nginx + HTTPS，把后端变成：

```text
https://ocr.yourdomain.com
```

然后运行：

```bash
node scripts/set-ocr-backend.js https://ocr.yourdomain.com
```
