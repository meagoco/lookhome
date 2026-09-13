#!/usr/bin/env bash
# ============================================================
#  路客家 · 公寓管理系统 —— 一键部署脚本
#
#  两种执行方式（任选其一）：
#    1) 直接远程执行（GitHub 复制一条命令）：
#       curl -fsSL https://raw.githubusercontent.com/<owner>/lukejia/main/install.sh | sudo bash
#    2) 下载仓库后在项目目录执行：
#       bash install.sh
#
#  脚本会自动完成：检测/安装 Node.js → 安装依赖 → 交互选择
#  （已解析域名 或 IP）→ 配置 Nginx → 注册 systemd 服务 →
#  输出登录地址 / 账号 / 密码。
#
#  域名与 SSL：部署时输入已解析的域名即自动配置 80 端口；
#  备案通过后按 README 中 acme.sh 一节配置 443 证书。
# ============================================================
set -euo pipefail

# ---------------- 0. 确定执行环境（支持远程管道执行） ----------------
REPO_OWNER="${LUKEJIA_REPO_OWNER:-meagoco}"
REPO_NAME="${LUKEJIA_REPO_NAME:-lookhome}"
REPO_BRANCH="${LUKEJIA_REPO_BRANCH:-main}"
GH_PROXY="${LUKEJIA_GH_PROXY:-}"   # 可选：GitHub 加速前缀，如 https://ghproxy.com/

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "$PWD")"
NEED_DOWNLOAD=0
if [ ! -f "$SELF_DIR/package.json" ] || [ ! -d "$SELF_DIR/server" ]; then
  NEED_DOWNLOAD=1
fi

if [ "$NEED_DOWNLOAD" = "1" ]; then
  echo ""
  echo "==> 检测到远程执行模式，正在下载项目代码..."
  TMP_DL="$(mktemp -d)"
  TARBALL_URL="${GH_PROXY}https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${REPO_BRANCH}.tar.gz"
  if ! curl -fsSL "$TARBALL_URL" -o "$TMP_DL/lk.tar.gz"; then
    echo "[错误] 项目包下载失败：$TARBALL_URL"
    echo "        请检查网络，或手动下载仓库后本地执行 bash install.sh"
    exit 1
  fi
  tar -xzf "$TMP_DL/lk.tar.gz" -C "$TMP_DL"
  SELF_DIR="$(find "$TMP_DL" -maxdepth 1 -type d -name "${REPO_NAME}-*" | head -1)"
  if [ -z "$SELF_DIR" ]; then echo "[错误] 解压失败"; exit 1; fi
fi
cd "$SELF_DIR"

# ---------------- 1. 前置检查 ----------------
echo "=============================================="
echo " 路客家 · 一键部署"
echo " 项目目录: $SELF_DIR"
echo "=============================================="

if [ "$(id -u)" != "0" ]; then
  echo "[提示] 建议使用 root 或 sudo 执行（Nginx / systemd 需要管理员权限）"
fi

echo ""
echo "==> [1/6] 检查 Node.js 环境"
install_node() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "      使用 NodeSource 安装 Node.js 20 (Debian/Ubuntu)"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y nodejs >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then
    echo "      使用 NodeSource 安装 Node.js 20 (CentOS/RHEL)"
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    dnf install -y nodejs >/dev/null 2>&1
  else
    echo "[错误] 未能自动安装 Node.js，请手动安装 Node.js 18+ 后重试"
    exit 1
  fi
}
if ! command -v node >/dev/null 2>&1; then
  install_node
else
  NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
  if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "      当前 Node.js $(node -v) 版本过低，自动升级到 20"
    install_node
  fi
fi
echo "      Node.js $(node -v) ✓"

# ---------------- 2. 安装依赖 ----------------
echo ""
echo "==> [2/6] 安装依赖（首次约 1-3 分钟）"
if command -v npm >/dev/null 2>&1; then
  npm install --omit=dev --no-audit --no-fund
else
  echo "[错误] 未找到 npm"
  exit 1
fi

# ---------------- 3. 初始化数据目录 ----------------
echo ""
echo "==> [3/6] 初始化数据目录"
mkdir -p "$SELF_DIR/data"
chmod 700 "$SELF_DIR/data"
# 数据库/备份/上传目录收紧权限（含敏感数据，仅 root 可读写）
chmod 700 "$SELF_DIR/data/backups" "$SELF_DIR/data/uploads" 2>/dev/null || true
echo "      数据文件: $SELF_DIR/data/lukejia.db（首次启动自动创建，权限已收紧）"

# ---------------- 4. 访问方式交互配置 ----------------
echo ""
echo "==> [4/6] 访问方式配置"
echo "  请选择访问方式："
echo "    1) 使用域名（需已将域名 A 记录解析到本服务器，例如 app.example.com）"
echo "    2) 使用 IP 地址（无需域名，后续再配置域名和 SSL 亦可）"
read -r -p "  请输入 1 或 2 [默认 2]: " ACCESS_CHOICE
ACCESS_CHOICE="${ACCESS_CHOICE:-2}"
DOMAIN=""
if [ "$ACCESS_CHOICE" = "1" ]; then
  while [ -z "$DOMAIN" ]; do
    read -r -p "  请输入已解析到本服务器的域名（例如 app.example.com）: " DOMAIN
  done
  DOMAIN="${DOMAIN#http://}"
  DOMAIN="${DOMAIN#https://}"
  DOMAIN="${DOMAIN%/}"
  echo "      使用域名: $DOMAIN"
else
  echo "      使用 IP 访问（http://服务器IP:3000）"
fi

# ---------------- 5. 配置 Nginx 与 systemd ----------------
echo ""
echo "==> [5/6] 注册服务并配置访问入口"
JWT_SECRET="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

# systemd 服务（后端监听 127.0.0.1:3001，由 Nginx 对外）
cat > /etc/systemd/system/lukejia.service <<EOF
[Unit]
Description=LukeJia 路客家公寓管理系统
After=network.target

[Service]
Type=simple
WorkingDirectory=$SELF_DIR
Environment=PORT=3001
Environment=HOST=127.0.0.1
Environment=JWT_SECRET=$JWT_SECRET
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable lukejia >/dev/null 2>&1 || true
systemctl restart lukejia
sleep 2
if ! systemctl is-active lukejia >/dev/null 2>&1; then
  echo "[错误] 服务启动失败，查看日志：journalctl -u lukejia -n 50"
  exit 1
fi
echo "      服务 lukejia 已启动 ✓"

# Nginx：安装并配置
if ! command -v nginx >/dev/null 2>&1; then
  echo "      安装 Nginx..."
  if command -v apt-get >/dev/null 2>&1; then apt-get install -y nginx >/dev/null 2>&1;
  elif command -v dnf >/dev/null 2>&1; then dnf install -y nginx >/dev/null 2>&1; fi
fi
if command -v nginx >/dev/null 2>&1; then
  NGINX_SITES="/etc/nginx/conf.d"
  mkdir -p "$NGINX_SITES"
  if [ -n "$DOMAIN" ]; then
    cat > "$NGINX_SITES/lukejia.conf" <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
    echo "      Nginx 已配置: http://$DOMAIN （80 端口，备案生效后按 README 配置 443 SSL）"
  else
    cat > "$NGINX_SITES/lukejia.conf" <<EOF
server {
    listen 3000;
    server_name _;
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
    echo "      Nginx 已配置: http://服务器IP:3000"
  fi
  nginx -t >/dev/null 2>&1 && { systemctl enable nginx >/dev/null 2>&1 || true; systemctl restart nginx; } || echo "      [警告] nginx 配置测试未通过，请检查 /etc/nginx/conf.d/lukejia.conf"
else
  echo "      [警告] 未安装 Nginx，可直接访问 http://127.0.0.1:3001"
fi

# 获取服务器 IP
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}' | head -1)"

# ---------------- 6. 完成输出 ----------------
echo ""
echo "==> [6/6] 完成"
echo "=============================================="
echo " 🏠 路客家 部署完成！"
echo ""
if [ -n "$DOMAIN" ]; then
  echo " 登录地址: http://$DOMAIN"
else
  echo " 登录地址: http://${SERVER_IP:-服务器IP}:3000"
fi
echo " 账号: admin"
echo " 密码: admin123（首次登录后请立即修改）"
echo ""
echo " 常用命令:"
echo "   查看状态  systemctl status lukejia"
echo "   查看日志  journalctl -u lukejia -f"
echo "   重启服务  systemctl restart lukejia"
echo ""
echo " 数据文件: $SELF_DIR/data/lukejia.db"
echo "   （后台「系统设置 → 数据备份与恢复」可在线备份/恢复）"
echo " 密码找回: $SELF_DIR/reset-password.js"
echo "   （忘记密码时：node reset-password.js admin 新密码；或在后台配置 SMTP 邮箱找回）"
echo ""
echo " 后续配置（见 README.md）："
echo "   - 域名 HTTPS/SSL：acme.sh DNS 校验签发证书，Nginx 配置 443"
echo "   - 微信小程序 / 微信支付：后台「系统设置」填入 AppID / 商户号即可开通"
echo "=============================================="
