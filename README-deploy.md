# 路客家 · 公寓管理系统 — 部署与使用说明

轻量自研长租公寓管理系统：管理后台 Web + 租客端微信小程序（预留）+ 租金/水电/押金线上支付（预留）。Node.js + SQLite，单机部署，内存占用约 25MB，适合 2C4G 轻量云服务器。

---

## 一、一键部署（Linux 服务器）

### 1. 打包发布包（在 Windows 开发机执行）
```powershell
# 在项目根目录执行
powershell -ExecutionPolicy Bypass -File .\build-release.ps1
# 生成 lukejia-release.tar.gz 和 lukejia-release/ 目录
```

### 2. 上传到服务器
```bash
# 在本地执行（将 tar.gz 上传到服务器）
scp lukejia-release.tar.gz root@你的服务器IP:/opt/
```

### 3. 服务器上解压并一键安装
```bash
ssh root@你的服务器IP
cd /opt
tar -xzf lukejia-release.tar.gz
cd lukejia-release
bash install.sh            # 默认端口 3000；也可 bash install.sh 8080
```

安装完成会输出管理后台地址和初始账号（admin / admin123），服务已注册 systemd 并开机自启。

### 环境要求
- Debian/Ubuntu/CentOS 等主流 Linux
- Node.js 18+（Node 20 推荐）
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
  ```
- 无需 MySQL/Redis/Docker，零外部依赖

---

## 二、配置 HTTPS（推荐，微信小程序要求 HTTPS 域名）

腾讯云服务器 + 已备案域名示例（acme.sh + DNS 验证，可自动续期）：

```bash
# 1 安装 acme.sh
curl https://get.acme.sh | sh -s email=你的邮箱
# 2 签发证书（DNS 方式，DNSPod 为例；需先在腾讯云申请 DNSPod Token）
export DP_Id="你的DNSPod账号ID"
export DP_Key="你的DNSPod API Token"
~/.acme.sh/acme.sh --issue --dns dns_dp -d 你的域名 -d www.你的域名 --keylength ec-256
# 3 安装证书
mkdir -p /etc/nginx/ssl
~/.acme.sh/acme.sh --install-cert -d 你的域名 --ecc \
  --key-file /etc/nginx/ssl/app.key --fullchain-file /etc/nginx/ssl/app.pem \
  --reloadcmd "systemctl reload nginx"
# 4 nginx 反向代理（80→HTTPS，443→127.0.0.1:3000）
#    参考 lukejia-deploy/nginx-lookhome.conf 与 nginx-lookhome-3000.conf
```

> 若备案尚未生效（腾讯云对 443 有 TLS 干扰）：把管理入口放在 3000 端口直接上 SSL（`https://域名:3000`），3000 端口不受备案干扰。

---

## 三、数据备份与恢复（后台内完成）

入口：管理后台 → 系统设置 → 下拉选择「数据备份与恢复」

| 功能 | 说明 |
|---|---|
| 立即备份 | 本地备份一份完整数据库（data/backups/） |
| 备份并上传远程 | 同时上传到已配置的远程存储 |
| 自动备份 | 开启后按周期（6小时/每天/每周）自动备份，自动清理超出保留份数的旧备份 |
| 恢复 | 选择备份 → 输入「恢复」确认 → 系统自动先做当前数据快照再覆盖，随后服务自动重启 |
| 下载/删除 | 备份文件可下载带走；删除需输入「删除」确认 |

### 远程存储支持 4 种（后台「数据备份与恢复 → 远程存储」选择）：

| 类型 | 适用 | 说明 |
|---|---|---|
| **S3 兼容** | 腾讯云 COS / 阿里云 OSS | 填 Bucket、Region、SecretId/SecretKey |
| **FTP** | 自建 FTP / 虚拟主机 | 填地址、端口、用户名、密码、目录 |
| **WebDAV** | 坚果云、群晖、Nextcloud 等 | 填 WebDAV 地址、账号、应用密码 |
| **OneDrive** | 微软个人/企业网盘 | Azure 注册应用 → 填 Client ID/Secret → 点「授权 OneDrive」登录微软账号 |

> **关于天翼云盘**：天翼云盘没有官方开放 API（仅网页版/客户端），第三方接入均属逆向接口，不稳定且有账号封禁风险，本系统未支持。可用 **WebDAV（坚果云等）** 获得同等"网盘自动备份"体验。

### 配置腾讯云 COS（S3 示例）
1. 腾讯云控制台 → 对象存储 COS → 创建存储桶（如 `lukejia-backup-1250000000`）
2. 访问管理 → API 密钥管理 → 获取 SecretId / SecretKey
3. 后台「数据备份与恢复 → 远程存储」选择 S3，填写并保存，点「备份并上传远程」验证

> 阿里云 OSS 同样兼容：Region 填 oss-cn-hangzhou 等，使用 OSS 的 AccessKey。

### 配置 OneDrive
1. Azure 门户（portal.azure.com）→ 应用注册 → 新建注册（账户类型选「个人 Microsoft 账户」）
2. 记下 Client ID；新建客户端密码得到 Client Secret
3. 后台选 OneDrive，填 Client ID/Secret（数据中心：国际版选国际；世纪互联版选中国），保存
4. 点「授权 OneDrive」→ 浏览器打开微软登录页完成授权 → 回到后台显示"已授权"
5. 备份会传到 OneDrive「我的文件 → Apps → 备份文件夹」下

---

## 四、核心业务流程（管理员视角）

```
添加项目 → 添加房间（设租金/垃圾费/水电单价）
  → 租客管理：新增租客/审核小程序注册租客
  → 合同管理：绑定房间，手动设定【月租金 + 押金 + 起止日期】
  → 账单管理：生成月度账单（租金+水电+垃圾费，可手工抄表）
  → 收款记录：手工确认收款 / 微信支付自动入账（配置商户号后）
  → 押金退款：退房后退押金
```

## 五、微信小程序与线上支付（预留开通）

后台「系统设置」已预留全部开关，申请完成后填入即可开通（无需改代码）：

| 能力 | 申请位置 | 后台填写处 |
|---|---|---|
| 租客微信小程序 | 微信公众平台注册小程序 | 微信小程序：AppID / AppSecret |
| 微信支付（JSAPI） | 微信商户平台开通，绑定小程序 | 微信支付：商户号/APIv3密钥/证书序列号/商户私钥 |
| 身份自动核验 | 腾讯云人脸核身（预留） | 功能开关 → 腾讯云核验配置 |
| 收款自动入账 | 配置完支付后切换 | 功能开关 → 收款确认方式选「自动」 |

> 未配置支付时：租客端缴费走「线下转账 + 后台手工确认」，全流程仍可跑通。

## 六、日常运维

```bash
systemctl status lukejia        # 状态
journalctl -u lukejia -f        # 实时日志
systemctl restart lukejia       # 重启
# 升级：备份 data/lukejia.db → 用新版 build-release.ps1 重新打包 → 覆盖 server/ 与 web/dist → 重启
# 迁移：直接把 /opt/lukejia/data 目录拷到新服务器，重跑 install.sh 即可
```

## 七、管理员密码找回（双渠道）

### 渠道 1：邮箱找回（后台配置 SMTP 后生效）
1. 管理后台 → 系统设置 → 下拉选择「邮件服务」→ 填写 SMTP 服务器 / 端口 / 加密方式 / 账号 / 授权码 / 发件人 / 系统访问地址（如 `www.lookhome.com.cn:3000`）→ 保存
2. 同一页面点「发送测试邮件」验证（需先为主管理员绑定邮箱：系统设置 → 操作员管理 → 主管理员行 → 编辑 → 填邮箱）
3. 登录页点「忘记密码？」→ 输入用户名或绑定邮箱 → 系统发送含重置链接的邮件，15 分钟内一次性有效
4. 打开链接设置新密码，随后用新密码登录

### 渠道 2：服务器端一键重置脚本（兜底，无需任何配置）
忘记密码且未配置邮件时，SSH 登录服务器执行：

```bash
cd /opt/lukejia
node reset-password.js              # 交互模式：按提示输入用户名和新密码
node reset-password.js admin 新密码  # 参数模式：直接重置
```

脚本会列出当前后台用户清单、作废该用户未使用的重置链接。执行后立即生效。

> 说明：账号不存在时前端统一提示"已发送"，避免泄露账号是否存在；未绑定邮箱或未配置 SMTP 时按提示改用渠道 2。操作员忘记密码由主管理员在后台「操作员管理 → 编辑」直接重置。

## 七、技术栈与目录

```
server/            Node.js + Express + better-sqlite3（单文件库）
  routes/          auth/settings/dashboard/properties/rooms/tenants/contracts/bills/payments/refunds/fees/pay/tenant/backup
  lib/s3.js        轻量 S3 兼容客户端（零依赖，COS/OSS 通用）
web/dist/          Vue3 + Vite + Element Plus 构建产物（gzip 约 390KB）
data/lukejia.db    SQLite 数据库（全部业务数据）
data/backups/      在线备份文件
```
