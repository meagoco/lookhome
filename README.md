# 路客家 LookHome · 轻量公寓管理系统

面向中小房东 / 公寓运营方的**私有化部署**长租管理系统：房源、租客、合同、账单、抄表、押金全流程管理，支持**微信小程序**与**微信支付**（预留，后台一键开通），数据完全自主可控。

> 设计目标：**轻量、不臃肿**。Node.js + Express + SQLite 单文件数据库 + Vue3，无 MySQL / Redis / Docker 依赖，2 核 4G 云服务器即可流畅运行多年。

---

## ✨ 功能特性

### 核心业务
- **房源管理**：项目 / 楼栋 / 房间三级结构，房间状态（空置 / 在租 / 配置中）流转，一房同时仅允许一份生效合同；**房屋历史租赁查询**——任一房间可查看历届租约完整履历（租赁人姓名 / 身份证 / 手机号、租赁时长、月租金、水电垃圾费率、押金退还明细、合同签订时间、退房时间）；另有**全局租赁历史搜索**（按租客姓名 / 身份证号 / 手机号模糊检索全部历史记录，含在租 / 已退租 / 作废）
- **租客管理**：租客实名资料，身份证号加密存储；删除前置校验（存在正常合同不可删除）
- **合同管理**：创建 / 编辑（如租金调整）/ 退房 / 作废，合同与房间、租客强绑定；退房或作废需**输入"退房"/"作废"确认**，执行后房源自动转为空置
- **账单管理**：月度账单自动生成，费用类型含 **租金 / 水费 / 电费 / 垃圾费** 等可扩展，支持押金账单
- **收款管理**：收款登记 / 手工确认（为线上支付预留），收款明细与账单关联
- **押金管理**：押金收取与退还登记；支持**租客小程序申请退押金 → 后台手工同意/驳回**；押金退还后**合同自动解除、房源自动改为空置**（后台手动退押金同理，租客端随后无法再申请）
- **抄表管理**：水电表 Excel 模板**导出 → 填数 → 批量导入**，自动计算本期用量与费用，可一键生成账单
- **缴费提醒**：① 系统自动——每月账单**到期日前 3 天**自动下发提醒（租金 / 水电 / 垃圾费），服务内置定时任务（每 6 小时检查，幂等不重复）；② 后台手动——账单页勾选未缴 / 逾期账单**批量发起催缴提醒**（管理员 / 操作员均可，操作员限授权项目）；③ 账单列表**回显提醒状态**（已提醒 / 未提醒、提醒时间、来源为自动或手动），并支持**按提醒状态筛选**；提醒通过**租客小程序**送达，租客点开提醒自动跳转对应账单页即可在线支付

### 统计分析（ECharts）
- **仪表盘**：周期收入图表（本月 / 近6月 / 近12月 / 今年 / 自定义区间），应收 / 实收 / 逾期卡片，房源概况
- **账单统计**：费用分类汇总（租金 / 水费 / 电费 / 垃圾费 / 押金），按项目统计，按月 / 按年 / 自定义周期，应收与实收双系列趋势图

### 系统能力
- **多操作员**：主管理员创建操作员并按项目授权；操作员拥有被授权项目的全部业务权限（系统设置除外）
- **数据备份与恢复**：本地一键备份 / 恢复，支持远程周期自动备份（S3 / FTP / WebDAV / OneDrive）
- **密码找回**：双渠道——SMTP 邮箱重置链接 + 服务器端 `reset-password.js` 一键重置脚本
- **安全删除**：所有删除操作需弹出确认框并输入"删除"二字；关键数据受合同前置条件保护
- **审计友好**：全部操作留痕，账单作废、合同变更均可追溯

### 安全加固
- **登录防爆破**：网关层对后台登录与租客登录接口按 IP 限流（1 次/秒 + 突发 3），连续快速尝试自动 503 拒绝
- **微信支付回调验签**：APIv3 平台公钥 RSA-SHA256 验签 + 5 分钟防重放窗口 + 商户号匹配 + **金额核对**（回调金额必须等于账单应付），未配置平台公钥时一律拒绝回调，杜绝伪造入账
- **支付接口鉴权**：租客发起支付必须携带租客登录凭证，杜绝遍历探测账单与覆盖订单号；含商户私钥的「项目生效配置」接口仅主管理员可见（下单签名在服务端完成，操作员无需明文密钥）
- **敏感配置脱敏**：支付/短信/邮件/备份密钥在后台一律掩码展示（仅显示首尾 4 位）
- **全局错误处理**：统一 400/413/500 JSON 响应，不向客户端泄露内部堆栈与 SQL 细节
- **同源部署**：不开放跨域（CORS），浏览器端仅同源访问；微信小程序不受 CORS 限制
- **文件权限**：数据库、备份、上传目录默认仅 root 可读写（安装脚本自动 `chmod 600/700`）
- **安全响应头**：`X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` 默认开启
- **依赖基线**：Express 4.22+、jsonwebtoken 9.0+、serve-static 1.16+ 等关键依赖保持安全补丁版本

### 预留扩展（后台系统设置可开通）
- **微信小程序租客端**：实名注册、房东绑定房间、查看账单、**接收缴费提醒（点开跳转账单页）**、缴纳租金/押金、申请退押金（待申请小程序后配置 AppID）
- **微信支付（多配置模板）**：可创建多套支付配置（商户号 / APIv3 密钥 / 证书），按项目勾选绑定——一个或多个项目共用一套商户号，一个项目只绑定一套；操作员可配置自持商户号；租客端小程序统一使用全局 AppID；未绑定模板的项目回退「默认支付配置」
- **租客身份人工审核** / **收款人工确认**：默认开启，稳妥起步

---

## 🧱 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js 18+ · Express · better-sqlite3（单文件 WAL 数据库） |
| 前端 | Vue3 · Element Plus · ECharts |
| 部署 | Nginx（反向代理）· systemd · SQLite 单文件（备份即复制文件） |

## 📦 一键部署

### 方式一：复制一条命令（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/meagoco/lookhome/main/install.sh | sudo bash
```

> **国内 / 海外低延迟服务器加速**：若 GitHub 直连较慢，可先设置代理前缀再执行：
>
> ```bash
> export LUKEJIA_GH_PROXY=https://ghproxy.com/
> curl -fsSL https://cdn.jsdelivr.net/gh/meagoco/lookhome@main/install.sh | sudo bash
> ```
>
> `LUKEJIA_GH_PROXY` 会同时作用于脚本内部的项目包下载（jsdelivr 仅代理脚本本身，包下载走代理前缀）。

脚本将自动完成：

1. 下载项目代码并解压
2. 检测 / 自动安装 Node.js 18+（Debian/Ubuntu、CentOS/RHEL）
3. 安装依赖（`npm install`）
4. **交互询问访问方式**：
   - 输入 **1**：使用域名（需已把域名 A 记录解析到本服务器）→ 自动配置 Nginx 80 端口
   - 输入 **2**（默认）：使用 IP → 自动配置 `http://服务器IP:3000`
5. 注册 systemd 服务并启动
6. 输出 **登录地址 / 账号 / 密码**

安装完成提示示例：

```
==============================================
 🏠 路客家 部署完成！

 登录地址: http://你的IP:3000
 账号: admin
 密码: admin123（首次登录后请立即修改）

 常用命令:
   查看状态  systemctl status lukejia
   查看日志  journalctl -u lukejia -f
   重启服务  systemctl restart lukejia
==============================================
```

### 方式二：手动部署

```bash
# 下载代码
git clone https://github.com/meagoco/lookhome.git
cd lookhome

# 安装依赖
npm install --omit=dev

# 启动（开发模式）
npm start          # 默认 http://127.0.0.1:3001

# 生产模式建议使用 systemd，可参考 install.sh 中的服务配置
```

---

## 🌐 域名与 HTTPS（SSL）

### 备案生效前
使用 IP + 端口访问：`http://IP:3000`（无需备案，域名解析非必需）。

### 备案通过后

**1. 解析域名**：将域名 A 记录指向服务器 IP。

**2. 安装并签发证书（acme.sh + DNS 校验，支持 DNSPod）**：

```bash
curl https://get.acme.sh | sh -s email=你的邮箱
alias acme.sh=~/.acme.sh/acme.sh

# 以 DNSPod 为例（Token 在 DNSPod 控制台申请）
export DP_Id="你的DNSPod_ID"
export DP_Key="你的DNSPod_Token"

# 签发证书（泛域名或单域名均可）
acme.sh --issue --dns dns_dp -d 'example.com' -d '*.example.com'
acme.sh --install-cert -d 'example.com' \
  --key-file /etc/nginx/ssl/example.key \
  --fullchain-file /etc/nginx/ssl/example.pem
```

**3. Nginx 配置 443**（示例 `/etc/nginx/conf.d/lukejia.conf`）：

```nginx
server {
    listen 443 ssl;
    server_name example.com;
    ssl_certificate     /etc/nginx/ssl/example.pem;
    ssl_certificate_key /etc/nginx/ssl/example.key;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}
```

```bash
nginx -t && systemctl reload nginx
```

---

## 📱 微信小程序与微信支付（预留）

系统已在后台 **系统设置** 预留如下开关与配置项：

| 配置项 | 说明 |
|---|---|
| 小程序 AppID / AppSecret | 租客端小程序绑定（需先在微信公众平台申请小程序） |
| 微信支付商户号 / API 密钥 | 线上收款开通（需先申请微信支付商户号） |
| 租客实名注册 | 默认**人工审核**模式，绑定小程序后可按需切换自动核验 |
| 收款确认 | 默认**手工确认**，绑定商户号后可按需切换自动入账 |

> 开通方式：申请好小程序与商户号 → 在后台「系统设置」填入对应参数 → 保存即生效，无需改代码。

---

## 💾 数据备份与恢复

- **本地备份**：系统设置 → 数据备份与恢复 → 一键备份（SQLite 单文件 + 配置打包）
- **本地恢复**：导入备份文件，一键还原（全量数据）
- **远程自动备份**：支持周期自动备份到 **S3 / FTP / WebDAV / OneDrive**，可选择备份周期（每日 / 每周 / 每月）

> 手工备份 = 直接复制 `data/lukejia.db` 文件，即完整数据。

## 🔑 忘记管理员密码怎么办

**渠道一（推荐，需可收信邮箱）**：登录页 → 忘记密码 → 输入管理员邮箱 → 收到重置链接 → 设置新密码。后台「系统设置」可配置 SMTP 发信。

**渠道二（服务器端一键重置）**：

```bash
cd /opt/lukejia   # 你的项目目录
node reset-password.js admin 你的新密码
```

---

## 💻 本地开发

```bash
# 后端
cd server && npm install && npm run dev

# 前端
cd web && npm install && npm run dev
```

| 命令 | 说明 |
|---|---|
| `npm run build`（web） | 前端生产构建，产物输出到 `web/dist` |
| `bash install.sh` | 一键部署（见上文） |

## 📁 目录结构

```
lookhome/
├── server/               # 后端（Express + better-sqlite3）
│   ├── index.js          # 入口
│   ├── db.js             # 数据库初始化（自动建表）
│   ├── schema.sql        # 表结构定义
│   ├── routes/           # 路由：auth / properties / tenants / contracts /
│   │                     #       bills / payments / refunds / meterings /
│   │                     #       dashboard / settings / backup / operators
│   └── middleware/       # 鉴权 / 操作员权限
├── web/                  # 前端（Vue3 + Element Plus + ECharts）
│   └── src/views/        # 仪表盘 / 房源 / 租客 / 合同 / 账单 / 收款 /
│                         # 押金 / 抄表 / 设置 / 登录 / 找回密码
├── install.sh            # 一键部署脚本
├── reset-password.js     # 服务器端密码重置脚本
└── data/                 # 运行时生成（SQLite 数据库，首次启动自动创建）
```

## 📄 开源协议

本项目以 **MIT License** 开源，可免费商用、自由修改、私有化部署。
