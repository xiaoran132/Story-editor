#!/usr/bin/env bash
# Story Editor 构建 + 重启脚本（原生 systemd + nginx 部署）。
# 幂等：拉代码 → 装依赖/构建三端 → 重启服务。首次部署见 deploy/README.md 的一次性步骤。
#
# 用法（在服务器上，以能 sudo 的用户）：
#   APP_DIR=/opt/story-editor ./deploy/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/story-editor}"
# 同域反代下，前端用同源相对地址（无需域名/跨域）
API_BASE="${NEXT_PUBLIC_API_BASE:-/api/v1}"

echo "==> App dir: $APP_DIR"
cd "$APP_DIR"

# 可选：更新代码（首次用 git clone，之后可解开下一行）
# git pull --ff-only

echo "==> Agent：venv + 依赖"
cd "$APP_DIR/agent"
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/pip install -q -r requirements.txt
# 确认 agent/.env 已含 DEEPSEEK_API_KEY
test -f .env || { echo "缺 agent/.env（DEEPSEEK_API_KEY）"; exit 1; }

echo "==> Backend：go build"
cd "$APP_DIR/backend"
go build -o backend .
# 确认 backend/.env（DB_*/JWT_SECRET/AGENT_URL/SERVER_PORT）
test -f .env || { echo "缺 backend/.env（DB_*/JWT_SECRET/AGENT_URL/SERVER_PORT）"; exit 1; }

echo "==> Frontend：build（NEXT_PUBLIC_API_BASE=$API_BASE 在 build 前固化）"
cd "$APP_DIR/frontend"
npm ci
NEXT_PUBLIC_API_BASE="$API_BASE" npm run build

echo "==> 重启服务"
sudo systemctl restart story-agent story-backend story-frontend
sudo systemctl --no-pager --lines=0 status story-agent story-backend story-frontend || true

echo "==> 完成。冒烟：curl -sS https://<域名>/api/v1/stories/ | head"
