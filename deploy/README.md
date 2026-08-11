# 部署

单机部署三进程 + **宿主机原生 nginx** 反代到**已装 PostgreSQL 的那台 Linux 服务器**;PG 作为宿主本机服务(`127.0.0.1:5432`)。**推荐 Docker**(三进程只装 Docker,不用拉源码/装 Go/Node/Python;nginx 用宿主已有的);末尾附不上 Docker 的原生 systemd 方案。

## 架构

```
Internet → :80/:443 Nginx(宿主机, 域名)
   ├── /api/v1/*  → 127.0.0.1:8080  Go 后端(SSE 关缓冲)
   └── /*         → 127.0.0.1:3000  Next.js 前端
后端 → 127.0.0.1:8001 Agent → DeepSeek
后端 → 127.0.0.1:5432 PostgreSQL(宿主本机)
```

- 同域反代 ⇒ 前端用**同源相对地址** `NEXT_PUBLIC_API_BASE=/api/v1`,无跨域、不硬编码域名。
- 8001/8080/3000/5432 **只监听本机**,公网只放 **80/443**(由宿主 nginx 占)。
- 反代用宿主机原生 nginx,配置见 `deploy/nginx/story-editor.conf`;**不再用 Caddy 容器**。
- 首启后端会建 `pgcrypto` 扩展 + AutoMigrate + seed(建 guest + 六部作品、**级联删「迷雾古堡」**)。这是你现在连的**同一台 PG**,注意别误删想留的数据。
- **上传的头像/封面存在后端本地磁盘**(`UPLOAD_DIR`),不是数据库也不是对象存储。Docker 下必须挂持久卷(compose 已挂 named volume `uploads` → `/data/uploads`,与 `backend.env` 的 `UPLOAD_DIR` 对齐),否则 `up --build` 一次图就全没了;原生部署下默认落 `backend/uploads/`(备份别漏)。

---

## 方式一:Docker（推荐）

三进程各一容器,用 **host 网络**共享宿主网络栈——容器内即以 `127.0.0.1` 直连宿主 PG 与彼此,拓扑与原生一致,**无需改 PG 监听/pg_hba**。反代用宿主机原生 nginx。构建可在本地/CI 完成,服务器只需 Docker。

### 前置(服务器)
- 装 Docker Engine + compose 插件;装 nginx;域名解析到本机;安全组放行 80、443。
- 宿主 PG 的 `pg_hba.conf` 对 `127.0.0.1/32`、`::1/128` 需用 `md5`/`scram-sha-256`(**不是 `ident`**),否则容器连库报 `Ident authentication failed`。改后 `SELECT pg_reload_conf();`,并确保 `postgres` 密码与 `backend.env` 的 `DB_PASSWORD` 一致。

### 一次性配置
```bash
cd deploy/docker
cp agent.env.example   agent.env     # 无必填项，全是可选的生成参数
cp backend.env.example backend.env   # 填 DB_PASSWORD/JWT_SECRET/ENCRYPTION_KEY 等（DB_HOST=127.0.0.1）
```
> `deploy/docker/*.env` 已被 .gitignore 忽略(含密钥),只提交 `*.example`。

### 配 nginx 反代（宿主机）
```bash
cp deploy/nginx/story-editor.conf /etc/nginx/conf.d/story-editor.conf
# 编辑该文件把 server_name 改成你的域名（后端端口非 8080 时同步改 proxy_pass）
nginx -t && systemctl reload nginx
# 对外前配 HTTPS：certbot --nginx -d <你的域名>
```

### 起
```bash
cd deploy/docker
docker compose up -d --build      # 构建镜像并后台启动 agent/backend/frontend
docker compose ps
docker compose logs -f backend    # 看迁移+seed
```
冒烟:先本机 `curl -sS http://127.0.0.1:8080/api/v1/stories/ | head`(三进程) → 再 `curl -sS http://<域名>/api/v1/stories/ | head`(经 nginx);浏览器开域名走一遍 详情页→开局→续写→回溯。

### 只在本地/CI 构建、服务器不构建(真正"只丢产物")
```bash
# 本地：构建并导出镜像 tar
docker compose -f deploy/docker/docker-compose.yml build
docker save -o story-editor.tar story-agent story-backend story-frontend
# 传到服务器后：
docker load -i story-editor.tar
docker compose -f deploy/docker/docker-compose.yml up -d   # 不带 --build
```
(或推到镜像仓库,服务器 `docker compose pull && up -d`。)

> **⚠️ Windows / PowerShell 用户**:导出务必用上面的 `docker save -o`,**别用** `... | gzip > x.tgz`——
> PowerShell 的 `>` 重定向和 `|` 管道**不是二进制安全的**(默认按文本写、可能加 UTF-16/BOM),会把 tar 字节流写坏,
> 服务器 `docker load` 会报「不是 tgz / 文件损坏」。想压缩就单独 `gzip story-editor.tar`(生成 `.tar.gz`),同样别用 `>`。
> **上传也要走二进制**:FTP 文本模式会损坏二进制,推荐 `scp story-editor.tar 用户@服务器:/opt/story-editor/`。
> 传前传后各 `Get-FileHash` / `sha256sum` 校验一致,可排除传输途中损坏。

### 更新
改代码后:本地/CI 重新 `build` → 重导/推镜像 → 服务器 `up -d`。改任何 `NEXT_PUBLIC_*` 需重建前端镜像才生效。

### 埋点分析
```bash
docker compose logs --no-color agent > agent.log
# 本地/服务器任一有 python 的环境：
python agent/tools/aggregate_log.py agent.log   # 见 handoff §8.4
```

---

## 方式二:原生 systemd + Nginx（备选,不上 Docker）

服务器上拉源码 + 装 Go 1.25 / Node 18-20 / Python 3.12,直接构建运行。产物在 `deploy/systemd/*.service`、`deploy/nginx/story-editor.conf`、`deploy/deploy.sh`。

1. 建用户/目录:`useradd -r story`;代码放 `/opt/story-editor`(**保留仓库结构**,后端依赖 `../templates`)。
2. `agent/.env`(可选,无凭据)、`backend/.env`(DB_*/JWT/AGENT_URL/`SERVER_PORT=127.0.0.1:8080`,纯 KEY=value)。
3. `cp deploy/systemd/story-*.service /etc/systemd/system/ && systemctl daemon-reload`。
4. `cp deploy/nginx/story-editor.conf /etc/nginx/conf.d/` → 改域名 → `nginx -t && systemctl reload nginx`(对外前 `certbot --nginx -d <域名>`)。
5. `APP_DIR=/opt/story-editor ./deploy/deploy.sh`(构建三端 + 重启);`systemctl enable story-agent story-backend story-frontend`。
- 埋点:`journalctl -u story-agent -o cat > agent.log` → `aggregate_log.py`。

---

## 排错

- **前端能开、API 连不上**:构建时没设 `NEXT_PUBLIC_API_BASE=/api/v1`(构建时固化)。Docker 见 compose 的 `args`;原生见 deploy.sh。
- **部署后页面白屏、`/_next/static/*.css` 与 `app/page-*.js` 404**:两种成因,先按 `curl -s http://<域名>/ | grep -o '/_next/static/css/[a-z0-9]*\.css'` 与直连 `http://127.0.0.1:3000/` 的结果对比判定。
  - 两侧哈希**不一致** → 宿主 nginx 缓存了旧 HTML。Next 给预渲染页发 `s-maxage=31536000`,任何开了 `proxy_cache` 的 nginx(**宝塔面板默认在 http 段全局开启**)都会缓一年。仓库配置已在 `location /` 加 `proxy_cache off`;若你的站点是面板生成的另一份配置,需自行补上,并清缓存:`nginx -T | grep proxy_cache_path` 找到目录 → `rm -rf <目录>/*` → `nginx -s reload`。
  - 两侧哈希**一致但仍 404** → 镜像里 HTML 与 `.next/static` 不同源,多为构建上下文带进了开发机的 `frontend/.next`(仓库根的 `.dockerignore` 已排除)。用 `docker compose build --no-cache frontend` 重建。
- **用 IP 能打开但接口全错**:确认 IP 命中的是哪个 server block(`nginx -T | grep -n server_name`)。面板常自带一个 `server_name <你的IP>` 的站点,它的 `location /api/` 会把 `/api/v1/*` 抢走转给别的项目。要么用域名访问,要么把 IP 并入本项目的 `server_name`,并挪开面板那个 block。
- **上传图片报 413**:nginx 的 `client_max_body_size` 默认 1m。仓库配置已在 `/api/v1/` location 设 8m,自己改过配置的记得补回。
- **图片传上去了、刷新就 404**:容器没挂持久卷,或 `backend.env` 的 `UPLOAD_DIR` 与 compose 的挂载点不一致。
- **开局/续写不逐字(卡住)**:反代缓冲了 SSE。nginx 的 `/api/v1/` location 需 `proxy_buffering off` + `proxy_http_version 1.1` + `proxy_set_header Connection ''` + 大 `proxy_read_timeout`(仓库配置已含)。
- **DB 报 `Ident authentication failed`(SQLSTATE 28000)**:`pg_hba.conf` 对 `127.0.0.1/32`、`::1/128` 用了 `ident`,改成 `md5`/`scram-sha-256` → `SELECT pg_reload_conf();`(改文件后光存不重载不生效)。
- **DB 报 `password authentication failed`(SQLSTATE 28P01)**:`backend.env` 的 `DB_PASSWORD` 与 PG 里 `postgres` 密码不符。对齐后 **`docker compose up -d --force-recreate backend`**——改 `.env` 用 `restart` 不重读环境变量,必须 `--force-recreate`。
- **后端起不来 `bind: address already in use`**:8080 被别的进程占。`sudo ss -lptn 'sport = :8080'` 查占用者,清掉或改 `SERVER_PORT`(nginx `proxy_pass` 同步)。
- **域名打不开/连接被关**:多为反代没起或 80 被占。`sudo ss -lptn 'sport = :80'` 确认是 nginx 在听;dev 阶段用 **http://** 访问(未配 443 前 https 打不开)。
- **后端模板报错**:确认工作目录使 `../templates` 可达(Docker 镜像已置 `WORKDIR /app/backend` + 拷 templates;原生要 `WorkingDirectory=backend/`)。
- **DB 连接失败**:宿主 PG 在跑、`story_editor` 库存在、`backend.env` 的 `DB_*` 正确。Docker host 网络下 `DB_HOST=127.0.0.1` 即可。
- **日志**:Docker `docker compose logs -f <svc>`;原生 `journalctl -u story-<svc> -f`。

## ⚠️ 公网上线前必读(当前 dev 级)

- **共享 guest 身份**:未登录访客互相看到彼此存档(handoff §7.1)。公网多人前至少默认要求登录,或改每浏览器独立匿名身份。
- **DeepSeek 额度**:公网任何人都能触发生成、烧你的 key——加登录门槛/速率限制。
- 无速率限制/审计;`community` 未实现。**建议先小范围/加访问控制,别长期公网裸放。**
- **`JWT_SECRET` 与 `ENCRYPTION_KEY` 必须改成各自独立的随机长串**:前者签发登录 token,后者加密用户自带的 LLM key(`users.llm_key_cipher`)。用默认值 = 密文可被任何人用默认密钥解开。
