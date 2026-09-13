<template>
  <div>
    <!-- 设置项下拉菜单导航 -->
    <el-card shadow="never" style="border-radius:10px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <b>系统设置</b>
        <el-select v-model="group" style="width:240px;" size="default">
          <el-option v-for="g in groups" :key="g.key" :label="g.name" :value="g.key" />
        </el-select>
        <span style="color:#909399;font-size:12px;">从下拉菜单中选择要管理的设置项</span>
      </div>
    </el-card>

    <!-- 站点信息 -->
    <el-card v-if="group==='site'" shadow="never" style="border-radius:10px;max-width:560px;">
      <template #header><b>站点信息</b></template>
      <el-form label-width="90px" size="small">
        <el-form-item label="站点名称"><el-input v-model="site.site_name" /></el-form-item>
        <el-form-item label="备案号"><el-input v-model="site.site_icp" /></el-form-item>
      </el-form>
      <el-button type="primary" size="small" @click="saveSite">保存站点</el-button>
    </el-card>

    <!-- 功能开关 -->
    <el-card v-if="group==='switches'" shadow="never" style="border-radius:10px;max-width:560px;">
      <template #header><b>功能开关</b></template>
      <el-form label-width="130px" size="small">
        <el-form-item label="身份验证方式">
          <el-radio-group v-model="switches.realname_verify_mode" @change="saveSwitches">
            <el-radio value="manual">手工审核</el-radio>
            <el-radio value="auto">自动核验（需配腾讯云密钥）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="收款确认方式">
          <el-radio-group v-model="switches.payment_confirm_mode" @change="saveSwitches">
            <el-radio value="manual">手工确认</el-radio>
            <el-radio value="auto">微信自动入账（需配支付）</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <el-divider style="margin:8px 0;">腾讯云身份核验（预留，自动核验需填写）</el-divider>
      <el-form label-width="130px" size="small">
        <el-form-item label="SecretId"><el-input v-model="tc.secret_id" placeholder="预留" /></el-form-item>
        <el-form-item label="SecretKey"><el-input v-model="tc.secret_key" type="password" show-password :placeholder="tc.secret_key_set ? '已配置（可留空不修改）' : '预留'" /></el-form-item>
        <el-form-item label="地域"><el-input v-model="tc.region" /></el-form-item>
      </el-form>
      <el-button type="primary" size="small" @click="saveTc">保存核验配置</el-button>
    </el-card>

    <!-- 微信小程序 -->
    <el-card v-if="group==='mini'" shadow="never" style="border-radius:10px;max-width:640px;">
      <template #header><b>微信小程序（租客端）— 预留开通</b></template>
      <el-alert type="info" :closable="false" style="margin-bottom:12px;" :title="miniEnabled ? '小程序配置完整，租客端可用' : '未配置：租客小程序暂不可用。申请好小程序后在此填写即可开通'" />
      <el-form label-width="120px" size="small">
        <el-form-item label="AppID"><el-input v-model="mini.appid" placeholder="wx..." /></el-form-item>
        <el-form-item label="AppSecret"><el-input v-model="mini.appsecret" type="password" show-password :placeholder="mini.appsecret_set ? '已配置（可留空不修改）' : '填写' " /></el-form-item>
        <el-form-item label="缴费模板ID"><el-input v-model="mini.template_pay" placeholder="订阅消息模板ID" /></el-form-item>
        <el-form-item label="收租提醒模板"><el-input v-model="mini.template_rent" placeholder="订阅消息模板ID" /></el-form-item>
      </el-form>
      <el-button type="primary" size="small" @click="saveMini">保存小程序配置</el-button>
    </el-card>

    <!-- 默认支付配置（全局兜底；多配置模板见「支付配置」菜单） -->
    <el-card v-if="group==='pay'" shadow="never" style="border-radius:10px;max-width:640px;">
      <template #header><b>默认支付配置（全局）— 预留开通</b></template>
      <el-alert type="info" :closable="false" style="margin-bottom:12px;"
        title="未在「支付配置」中绑定支付模板的项目，收款时使用本默认配置。多项目共用/分商户收款，请使用左侧菜单「支付配置」创建模板并勾选项目。" />
      <el-alert type="info" :closable="false" style="margin-bottom:12px;" :title="payEnabled ? '微信支付已配置：租客可在线支付，到账自动入账' : '未配置：当前为【手工确认收款】模式，租客缴费走线下转账后后台确认'" />
      <el-form label-width="120px" size="small">
        <el-form-item label="商户号"><el-input v-model="pay.mchid" placeholder="微信支付商户号" /></el-form-item>
        <el-form-item label="APIv3密钥"><el-input v-model="pay.apiv3_key" type="password" show-password :placeholder="pay.apiv3_key_set ? '已配置（可留空不修改）' : '填写'" /></el-form-item>
        <el-form-item label="证书序列号"><el-input v-model="pay.serial_no" /></el-form-item>
        <el-form-item label="商户私钥"><el-input v-model="pay.private_key" type="textarea" :rows="3" :placeholder="pay.private_key_set ? '已配置（可留空不修改）' : '粘贴商户API证书私钥'" /></el-form-item>
        <el-form-item label="支付回调地址"><el-input v-model="pay.notify_url" placeholder="https://你的域名/api/pay/notify" /></el-form-item>
      </el-form>
      <el-button type="primary" size="small" @click="savePay">保存支付配置</el-button>
    </el-card>

    <!-- 费用类型 -->
    <el-card v-if="group==='fees'" shadow="never" style="border-radius:10px;max-width:640px;">
      <template #header><b>费用类型</b></template>
      <el-table :data="fees" size="small">
        <el-table-column prop="name" label="费用项" />
        <el-table-column label="启用" width="80">
          <template #default="{row}"><el-switch v-model="row.enabled" :active-value="1" :inactive-value="0" size="small" @change="saveFee(row)" /></template>
        </el-table-column>
        <el-table-column label="默认单价" width="110"><template #default="{row}">{{ row.default_rate || '—' }}</template></el-table-column>
      </el-table>
    </el-card>

    <!-- 修改密码 -->
    <el-card v-if="group==='pwd'" shadow="never" style="border-radius:10px;max-width:420px;">
      <template #header><b>修改密码</b></template>
      <el-form label-width="80px" size="small">
        <el-form-item label="原密码"><el-input v-model="pwd.oldPwd" type="password" /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="pwd.newPwd" type="password" /></el-form-item>
        <el-button type="primary" size="small" @click="savePwd">修改</el-button>
      </el-form>
    </el-card>

    <!-- 数据备份 -->
    <el-card v-if="group==='backup'" shadow="never" style="border-radius:10px;">
      <template #header>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <b>数据备份与恢复</b>
          <el-button type="primary" size="small" @click="manualBackup(false)">立即备份</el-button>
          <el-button type="success" size="small" @click="manualBackup(true)" :disabled="!bk.remote_ready">备份并上传远程</el-button>
          <el-tag v-if="bk.last_at" size="small" type="info">上次备份：{{ bk.last_at }}</el-tag>
          <el-tag v-else size="small" type="warning">尚无备份</el-tag>
        </div>
      </template>

      <el-alert type="warning" :closable="false" style="margin-bottom:12px;"
        title="备份包含全部业务数据（项目/房间/租客/合同/账单/收款/退款）。恢复会覆盖当前全部数据，恢复前系统会自动生成一份当前数据快照。" />

      <el-divider content-position="left">自动备份</el-divider>
      <el-form label-width="130px" size="small" style="max-width:640px;">
        <el-form-item label="开启自动备份">
          <el-switch v-model="auto.enabled" :active-value="'1'" :inactive-value="'0'" @change="saveBackupCfg" />
        </el-form-item>
        <el-form-item label="备份周期">
          <el-select v-model="auto.interval_hours" style="width:180px;" @change="saveBackupCfg">
            <el-option label="每 6 小时" :value="'6'" />
            <el-option label="每天" :value="'24'" />
            <el-option label="每周" :value="'168'" />
          </el-select>
        </el-form-item>
        <el-form-item label="保留份数">
          <el-input-number v-model="auto.keep" :min="1" :max="60" size="small" @change="saveBackupCfg" />
        </el-form-item>
        <el-form-item label="自动同步远程">
          <el-switch v-model="auto.remote" :active-value="'1'" :inactive-value="'0'" @change="saveBackupCfg" :disabled="!bk.remote_ready" />
        </el-form-item>
      </el-form>

      <el-divider content-position="left">远程存储（备份目标）</el-divider>
      <el-form label-width="130px" size="small" style="max-width:660px;">
        <el-form-item label="存储类型">
          <el-select v-model="remote.type" style="width:220px;" @change="saveRemoteType">
            <el-option label="腾讯云 COS / 阿里云 OSS（S3 兼容）" value="s3" />
            <el-option label="FTP 服务器" value="ftp" />
            <el-option label="WebDAV（坚果云等）" value="webdav" />
            <el-option label="OneDrive（微软网盘）" value="onedrive" />
          </el-select>
          <el-tag v-if="bk.remote_ready" size="small" type="success" style="margin-left:8px;">已配置，可远程备份</el-tag>
          <el-tag v-else size="small" type="info" style="margin-left:8px;">未配置（可选）</el-tag>
        </el-form-item>
      </el-form>

      <!-- S3 / COS / OSS -->
      <el-form v-if="remote.type==='s3'" label-width="130px" size="small" style="max-width:660px;">
        <el-form-item label="存储桶 Bucket">
          <el-input v-model="remote.s3.bucket" placeholder="如 myapp-backup-1250000000" />
        </el-form-item>
        <el-form-item label="地域 Region">
          <el-input v-model="remote.s3.region" placeholder="ap-guangzhou / oss-cn-hangzhou" />
        </el-form-item>
        <el-form-item label="SecretId"><el-input v-model="remote.s3.secret_id" /></el-form-item>
        <el-form-item label="SecretKey">
          <el-input v-model="remote.s3.secret_key" type="password" show-password :placeholder="remote.s3.secret_key_set ? '已配置（可留空不修改）' : '填写'" />
        </el-form-item>
        <el-form-item label="目录前缀"><el-input v-model="remote.s3.prefix" placeholder="lukejia-backup/" /></el-form-item>
      </el-form>

      <!-- FTP -->
      <el-form v-if="remote.type==='ftp'" label-width="130px" size="small" style="max-width:660px;">
        <el-form-item label="FTP 地址"><el-input v-model="remote.ftp.host" placeholder="ftp.example.com 或 1.2.3.4" /></el-form-item>
        <el-form-item label="端口">
          <el-input-number v-model="remote.ftp.port" :min="1" :max="65535" size="small" style="width:180px;" />
        </el-form-item>
        <el-form-item label="用户名"><el-input v-model="remote.ftp.user" /></el-form-item>
        <el-form-item label="密码">
          <el-input v-model="remote.ftp.pass" type="password" show-password :placeholder="remote.ftp.pass_set ? '已配置（可留空不修改）' : '填写'" />
        </el-form-item>
        <el-form-item label="备份目录"><el-input v-model="remote.ftp.path" placeholder="/lukejia-backup/" /></el-form-item>
      </el-form>

      <!-- WebDAV -->
      <el-form v-if="remote.type==='webdav'" label-width="130px" size="small" style="max-width:660px;">
        <el-form-item label="WebDAV 地址">
          <el-input v-model="remote.webdav.url" placeholder="https://dav.jianguoyun.com/dav/" />
        </el-form-item>
        <el-form-item label="用户名"><el-input v-model="remote.webdav.user" placeholder="坚果云账号邮箱" /></el-form-item>
        <el-form-item label="密码">
          <el-input v-model="remote.webdav.pass" type="password" show-password :placeholder="remote.webdav.pass_set ? '已配置（可留空不修改）' : '填写应用密码'" />
        </el-form-item>
        <el-form-item label="目录前缀"><el-input v-model="remote.webdav.path" placeholder="lukejia-backup/" /></el-form-item>
      </el-form>

      <!-- OneDrive -->
      <el-form v-if="remote.type==='onedrive'" label-width="130px" size="small" style="max-width:660px;">
        <el-alert type="info" :closable="false" style="margin-bottom:12px;"
          title="OneDrive 需先在 Azure 注册应用（支持个人账户）。开通后填写下方 Client ID/Secret，点「授权 OneDrive」登录微软账号完成授权。" />
        <el-form-item label="Azure 应用 Client ID"><el-input v-model="remote.od.client_id" /></el-form-item>
        <el-form-item label="Client Secret">
          <el-input v-model="remote.od.client_secret" type="password" show-password :placeholder="remote.od.client_secret_set ? '已配置（可留空不修改）' : '填写'" />
        </el-form-item>
        <el-form-item label="数据中心">
          <el-select v-model="remote.od.endpoint" style="width:220px;">
            <el-option label="国际版（graph.microsoft.com）" value="global" />
            <el-option label="中国版（世纪互联）" value="china" />
          </el-select>
        </el-form-item>
        <el-form-item label="备份文件夹"><el-input v-model="remote.od.folder" placeholder="lukejia-backup" /></el-form-item>
        <el-form-item label="授权状态">
          <el-tag v-if="remote.od.authorized" type="success" size="small">已授权</el-tag>
          <el-tag v-else type="warning" size="small">未授权</el-tag>
          <el-button size="small" style="margin-left:8px;" type="primary" plain :loading="odLoading" @click="authOneDrive">授权 OneDrive</el-button>
        </el-form-item>
      </el-form>

      <div style="margin-top:12px;">
        <el-button type="primary" size="small" @click="saveRemoteCfg">保存远程存储配置</el-button>
      </div>

      <el-divider content-position="left">备份列表</el-divider>
      <el-table :data="bk.rows" size="small">
        <el-table-column prop="file" label="文件名" min-width="220" />
        <el-table-column prop="time" label="备份时间" width="150" />
        <el-table-column label="大小" width="90"><template #default="{row}">{{ (row.size/1024).toFixed(1) }} KB</template></el-table-column>
        <el-table-column prop="kind" label="类型" width="100"><template #default="{row}"><el-tag size="small" :type="row.kind==='恢复前快照'?'info':'success'">{{ row.kind }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{row}">
            <el-button link type="primary" @click="download(row)">下载</el-button>
            <el-button link type="warning" @click="restore(row)">恢复</el-button>
            <el-button link type="danger" @click="delBackup(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <!-- 邮件服务（密码找回） -->
    <el-card v-if="group==='mail'" shadow="never" style="border-radius:10px;">
      <template #header><b>邮件服务</b></template>
      <el-alert type="info" :closable="false" style="margin-bottom:12px;"
        title="配置 SMTP 后，登录页「忘记密码」可向绑定邮箱发送重置链接。可用任意邮箱的 SMTP 授权码（如 QQ邮箱/163/企业邮箱）。未配置时请使用服务器端一键重置脚本（部署包 README 有说明）。" />
      <el-form label-width="130px" size="small" style="max-width:640px;">
        <el-form-item label="SMTP 服务器"><el-input v-model="smtp.host" placeholder="如 smtp.qq.com" /></el-form-item>
        <el-form-item label="端口">
          <el-input-number v-model="smtp.port" :min="1" :max="65535" style="width:180px;" />
          <span style="margin-left:10px;color:#909399;font-size:12px;">465=SSL / 587=STARTTLS</span>
        </el-form-item>
        <el-form-item label="加密方式">
          <el-select v-model="smtp.secure" style="width:220px;">
            <el-option label="SSL（465）" value="1" />
            <el-option label="非加密/STARTTLS（25/587）" value="0" />
          </el-select>
        </el-form-item>
        <el-form-item label="账号"><el-input v-model="smtp.user" placeholder="发信账号（如 xxx@qq.com）" /></el-form-item>
        <el-form-item label="授权码/密码">
          <el-input v-model="smtp.pass" type="password" show-password :placeholder="smtp.pass_set ? '已配置（留空不修改）' : 'SMTP 授权码'" />
        </el-form-item>
        <el-form-item label="发件人"><el-input v-model="smtp.from" placeholder="留空则使用账号" /></el-form-item>
        <el-form-item label="系统访问地址"><el-input v-model="smtp.site_url" placeholder="如 https://你的域名:3000（重置链接用，留空自动取当前地址）" /></el-form-item>
      </el-form>
      <el-button type="primary" size="small" @click="saveSmtp">保存邮件配置</el-button>
      <el-button size="small" style="margin-left:8px;" :loading="smtpTestLoading" @click="testSmtp">发送测试邮件</el-button>
      <div v-if="smtp.testMsg" style="margin-top:10px;color:#67c23a;font-size:13px;">{{ smtp.testMsg }}</div>
      <div v-if="smtp.testErr" style="margin-top:10px;color:#f56c6c;font-size:13px;">{{ smtp.testErr }}</div>
    </el-card>
    <!-- 操作员管理 -->
    <el-card v-if="group==='users'" shadow="never" style="border-radius:10px;">
      <template #header>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <b>操作员管理</b>
          <el-button type="primary" size="small" @click="addUser">新增后台用户</el-button>
          <span style="color:#909399;font-size:12px;">操作员可新增项目；主管理员可授权其管理指定项目。操作员拥有除系统设置外的全部功能（仅限授权项目）。</span>
        </div>
      </template>
      <el-table :data="users" size="small">
        <el-table-column prop="username" label="用户名" width="120" />
        <el-table-column prop="display_name" label="显示名" width="110" />
        <el-table-column prop="email" label="邮箱" min-width="150"><template #default="{row}">{{ row.email || '—' }}</template></el-table-column>
        <el-table-column label="角色" width="95"><template #default="{row}"><el-tag size="small" :type="row.role==='admin'?'danger':'primary'">{{ row.role==='admin'?'主管理员':'操作员' }}</el-tag></template></el-table-column>
        <el-table-column label="状态" width="85"><template #default="{row}"><el-tag size="small" :type="row.status===1?'success':'info'">{{ row.status===1?'正常':'停用' }}</el-tag></template></el-table-column>
        <el-table-column prop="grant_count" label="授权项目" width="85" />
        <el-table-column prop="created_at" label="创建时间" width="150" />
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{row}">
            <template v-if="row.role!=='admin'">
              <el-button link type="primary" @click="editGrants(row)">授权项目</el-button>
              <el-button link type="warning" @click="editUser(row)">编辑</el-button>
              <el-button link :type="row.status===1?'info':'success'" @click="toggleUser(row)">{{ row.status===1?'停用':'启用' }}</el-button>
              <el-button link type="danger" @click="delUser(row)">删除</el-button>
            </template>
            <el-button v-else link type="warning" @click="editUser(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增用户弹窗 -->
    <el-dialog v-model="userDlg" title="新增后台用户" width="440px">
      <el-form label-width="90px" size="small">
        <el-form-item label="用户名"><el-input v-model="userForm.username" placeholder="3-20位字母数字下划线" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="userForm.password" type="password" placeholder="至少6位" /></el-form-item>
        <el-form-item label="显示名"><el-input v-model="userForm.display_name" placeholder="如：小李（负责A公寓）" /></el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="userForm.role">
            <el-radio value="operator">操作员</el-radio>
            <el-radio value="admin">主管理员</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="userDlg=false">取消</el-button><el-button type="primary" @click="saveUser">创建</el-button></template>
    </el-dialog>

    <!-- 编辑用户弹窗（用户名/显示名/新密码） -->
    <el-dialog v-model="editDlg" title="编辑后台用户" width="440px">
      <el-form label-width="90px" size="small">
        <el-form-item label="用户名"><el-input v-model="editForm.username" placeholder="3-20位字母数字下划线" /></el-form-item>
        <el-form-item label="显示名"><el-input v-model="editForm.display_name" placeholder="如：小李（负责A公寓）" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="editForm.email" placeholder="绑定后可用于密码找回" /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="editForm.password" type="password" placeholder="留空则不修改密码（至少6位）" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="editDlg=false">取消</el-button><el-button type="primary" @click="saveEdit">保存</el-button></template>
    </el-dialog>

    <!-- 授权项目弹窗 -->
    <el-dialog v-model="grantDlg" :title="`授权项目：${grantUser?.display_name || grantUser?.username}`" width="480px">
      <el-alert type="info" :closable="false" style="margin-bottom:10px;" title="勾选后该操作员可管理这些项目的全部业务（房源/租客/合同/账单/收款/退款/抄表）。操作员自建项目自动归其管理。" />
      <el-checkbox-group v-model="grantIds" style="display:flex;flex-direction:column;gap:8px;">
        <el-checkbox v-for="p in allProjects" :key="p.id" :value="p.id">{{ p.name }}（{{ p.room_count }}间）</el-checkbox>
      </el-checkbox-group>
      <template #footer><el-button @click="grantDlg=false">取消</el-button><el-button type="primary" @click="saveGrants">保存授权</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';
import { confirmDelete } from '../utils/confirmDelete';

const groups = [
  { key: 'site', name: '站点信息' },
  { key: 'switches', name: '功能开关' },
  { key: 'mini', name: '微信小程序' },
  { key: 'pay', name: '默认支付配置' },
  { key: 'fees', name: '费用类型' },
  { key: 'mail', name: '邮件服务' },
  { key: 'users', name: '操作员管理' },
  { key: 'pwd', name: '修改密码' },
  { key: 'backup', name: '数据备份与恢复' }
];
const group = ref('site');

const data = reactive({ site: {}, switches: {}, mini: {}, pay: {}, tc: {}, backup: {} });
const site = computed(() => data.site);
const switches = computed(() => data.switches);
const mini = computed(() => data.mini);
const pay = computed(() => data.pay);
const tc = computed(() => data.tc);
const fees = ref([]);
const pwd = reactive({ oldPwd: '', newPwd: '' });
const miniEnabled = computed(() => !!mini.value.appid);
const payEnabled = computed(() => !!pay.value.mchid && pay.value.apiv3_key_set && pay.value.private_key_set);

const auto = reactive({ enabled: '0', interval_hours: '24', keep: 10, remote: '0' });
const remote = reactive({
  type: 's3',
  s3: { bucket: '', region: '', secret_id: '', secret_key: '', secret_key_set: false, prefix: 'lukejia-backup/' },
  ftp: { host: '', port: 21, user: '', pass: '', pass_set: false, path: '/lukejia-backup/' },
  webdav: { url: '', user: '', pass: '', pass_set: false, path: 'lukejia-backup/' },
  od: { client_id: '', client_secret: '', client_secret_set: false, folder: 'lukejia-backup', endpoint: 'global', authorized: false }
});
const bk = reactive({ rows: [], last_at: '', remote_ready: false });
const odLoading = ref(false);

// —— 操作员管理 ——
const users = ref([]);
const allProjects = ref([]);
const userDlg = ref(false);
const grantDlg = ref(false);
const grantUser = ref(null);
const grantIds = ref([]);
const userForm = reactive({ username: '', password: '', display_name: '', role: 'operator' });
const editDlg = ref(false);
const editForm = reactive({ id: null, username: '', display_name: '', email: '', password: '' });

// —— 邮件服务 ——
const smtp = reactive({ host: '', port: 465, user: '', pass: '', pass_set: false, from: '', secure: '1', site_url: '', testMsg: '', testErr: '' });
const smtpTestLoading = ref(false);
async function saveSmtp() {
  const body = { smtp_host: smtp.host, smtp_port: String(smtp.port), smtp_user: smtp.user, smtp_from: smtp.from, smtp_secure: smtp.secure, site_url: smtp.site_url };
  if (smtp.pass) body.smtp_pass = smtp.pass;
  await api.put('/settings', body);
  ElMessage.success('邮件配置已保存');
}
async function testSmtp() {
  smtp.testMsg = ''; smtp.testErr = '';
  const to = (await api.get('/auth/me')).email;
  if (!to) return ElMessage.warning('请先在操作员管理里给当前账号绑定邮箱');
  smtpTestLoading.value = true;
  try {
    await api.post('/auth/test-mail', { to });
    smtp.testMsg = `测试邮件已发送至 ${to}`;
  } catch (e) {
    smtp.testErr = e?.response?.data?.error || '发送失败';
  } finally { smtpTestLoading.value = false; }
}

async function loadUsers() { users.value = await api.get('/admin-users'); }
async function loadAllProjects() { allProjects.value = await api.get('/properties'); }
function addUser() { Object.assign(userForm, { username: '', password: '', display_name: '', role: 'operator' }); userDlg.value = true; }
async function saveUser() {
  if (!userForm.username || !userForm.password) return ElMessage.warning('用户名与密码必填');
  await api.post('/admin-users', userForm);
  userDlg.value = false; loadUsers(); ElMessage.success('用户已创建');
}
async function editGrants(row) {
  grantUser.value = row;
  const d = await api.get(`/admin-users/${row.id}`);
  grantIds.value = d.granted || [];
  if (!allProjects.value.length) await loadAllProjects();
  grantDlg.value = true;
}
async function saveGrants() {
  await api.put(`/admin-users/${grantUser.value.id}/grants`, { property_ids: grantIds.value });
  grantDlg.value = false; loadUsers(); ElMessage.success('授权已保存');
}
function editUser(row) {
  Object.assign(editForm, { id: row.id, username: row.username, display_name: row.display_name || '', email: row.email || '', password: '' });
  editDlg.value = true;
}
async function saveEdit() {
  if (!editForm.username || !/^[a-zA-Z0-9_]{3,20}$/.test(editForm.username)) return ElMessage.warning('用户名需为 3-20 位字母数字下划线');
  if (editForm.password && editForm.password.length < 6) return ElMessage.warning('密码至少 6 位');
  if (editForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email)) return ElMessage.warning('邮箱格式不正确');
  const payload = { username: editForm.username, display_name: editForm.display_name || editForm.username, email: editForm.email || '' };
  if (editForm.password) payload.password = editForm.password;
  await api.put(`/admin-users/${editForm.id}`, payload);
  editDlg.value = false; loadUsers(); ElMessage.success('已保存');
}
async function toggleUser(row) {
  await api.put(`/admin-users/${row.id}`, { status: row.status === 1 ? 0 : 1 });
  loadUsers(); ElMessage.success(row.status === 1 ? '已停用' : '已启用');
}
async function delUser(row) {
  await confirmDelete(`后台用户「${row.display_name || row.username}」及其项目授权`);
  await api.delete(`/admin-users/${row.id}`);
  loadUsers(); ElMessage.success('用户已删除');
}

const blank = { appid: '', appsecret: '', template_pay: '', template_rent: '' };
const blankPay = { mchid: '', apiv3_key: '', serial_no: '', private_key: '', notify_url: '' };
const blankTc = { secret_id: '', secret_key: '', region: 'ap-guangzhou' };

onMounted(async () => {
  const s = await api.get('/settings');
  Object.assign(data.site, s.site);
  Object.assign(data.switches, s.switches);
  Object.assign(data.mini, { ...blank, ...s.wechat_mini });
  Object.assign(data.pay, { ...blankPay, ...s.wechat_pay });
  Object.assign(data.tc, { ...blankTc, ...s.tencent_verify });
  Object.assign(smtp, { host: s.smtp?.host || '', port: Number(s.smtp?.port || 465), user: s.smtp?.user || '', pass: '', pass_set: !!s.smtp?.pass_set, from: s.smtp?.from || '', secure: s.smtp?.secure || '1', site_url: s.site?.site_url || '', testMsg: '', testErr: '' });
  Object.assign(auto, { enabled: s.backup?.auto_enabled || '0', interval_hours: s.backup?.auto_interval_hours || '24', keep: parseInt(s.backup?.keep || '10', 10), remote: s.backup?.auto_remote || '0' });
  const b = s.backup || {};
  remote.type = b.remote_type || 's3';
  Object.assign(remote.s3, { bucket: b.s3?.bucket || '', region: b.s3?.region || '', secret_id: b.s3?.secret_id || '', secret_key: '', secret_key_set: !!b.s3?.secret_key_set, prefix: b.s3?.prefix || 'lukejia-backup/' });
  Object.assign(remote.ftp, { host: b.ftp?.host || '', port: parseInt(b.ftp?.port || '21', 10), user: b.ftp?.user || '', pass: '', pass_set: !!b.ftp?.pass_set, path: b.ftp?.path || '/lukejia-backup/' });
  Object.assign(remote.webdav, { url: b.webdav?.url || '', user: b.webdav?.user || '', pass: '', pass_set: !!b.webdav?.pass_set, path: b.webdav?.path || 'lukejia-backup/' });
  Object.assign(remote.od, { client_id: b.od?.client_id || '', client_secret: '', client_secret_set: !!b.od?.client_secret_set, folder: b.od?.folder || 'lukejia-backup', endpoint: b.od?.endpoint || 'global', authorized: !!b.od?.authorized });
  fees.value = await api.get('/fees');
  loadBackup();
  loadUsers();
});

async function loadBackup() {
  const b = await api.get('/backups');
  bk.rows = b.rows; bk.last_at = b.last_at; bk.remote_ready = b.remote_ready;
  auto.enabled = b.auto.enabled ? '1' : '0';
  auto.interval_hours = String(b.auto.interval_hours);
  auto.keep = b.auto.keep;
  auto.remote = b.auto.remote ? '1' : '0';
  remote.type = b.remote_type || 's3';
  remote.od.authorized = !!b.remote_config?.od?.authorized;
}

async function saveSite() { await api.put('/settings', data.site); ElMessage.success('已保存'); }
async function saveMini() { await api.put('/settings', { wechat_mini_appid: mini.value.appid, wechat_mini_secret: mini.value.appsecret || undefined, wechat_template_pay: mini.value.template_pay, wechat_template_rent: mini.value.template_rent }); ElMessage.success('小程序配置已保存'); }
async function savePay() { await api.put('/settings', { wechat_pay_mchid: pay.value.mchid, wechat_pay_apiv3_key: pay.value.apiv3_key || undefined, wechat_pay_serial_no: pay.value.serial_no, wechat_pay_private_key: pay.value.private_key || undefined, wechat_pay_notify_url: pay.value.notify_url }); ElMessage.success('支付配置已保存'); }
async function saveSwitches() { await api.put('/settings', { realname_verify_mode: switches.value.realname_verify_mode, payment_confirm_mode: switches.value.payment_confirm_mode }); ElMessage.success('开关已更新'); }
async function saveTc() { await api.put('/settings', { tencent_secret_id: tc.value.secret_id, tencent_secret_key: tc.value.secret_key || undefined, tencent_verify_region: tc.value.region }); ElMessage.success('已保存'); }
async function saveFee(row) { await api.put(`/fees/${row.id}`, { enabled: row.enabled }); }
async function savePwd() {
  if (!pwd.oldPwd || !pwd.newPwd) return ElMessage.warning('请填写完整');
  await api.post('/auth/password', pwd);
  ElMessage.success('密码已修改');
  pwd.oldPwd = ''; pwd.newPwd = '';
}

async function saveBackupCfg() {
  await api.put('/settings', {
    backup_auto_enabled: auto.enabled,
    backup_auto_interval_hours: String(auto.interval_hours),
    backup_auto_remote: auto.remote,
    backup_keep: String(auto.keep)
  });
  ElMessage.success('自动备份设置已保存');
}
async function saveCos() {
  await api.put('/settings', {
    backup_cos_bucket: cos.bucket,
    backup_cos_region: cos.region,
    backup_cos_secret_id: cos.secret_id,
    backup_cos_secret_key: cos.secret_key || undefined,
    backup_cos_prefix: cos.prefix
  });
  ElMessage.success('远程存储配置已保存');
  loadBackup();
}
async function saveRemoteType() {
  await api.put('/settings', { backup_remote_type: remote.type });
  ElMessage.success('远程存储类型已切换');
  loadBackup();
}
async function saveRemoteCfg() {
  await api.put('/settings', {
    backup_remote_type: remote.type,
    backup_cos_bucket: remote.s3.bucket,
    backup_cos_region: remote.s3.region,
    backup_cos_secret_id: remote.s3.secret_id,
    backup_cos_secret_key: remote.s3.secret_key || undefined,
    backup_cos_prefix: remote.s3.prefix,
    backup_ftp_host: remote.ftp.host,
    backup_ftp_port: String(remote.ftp.port),
    backup_ftp_user: remote.ftp.user,
    backup_ftp_pass: remote.ftp.pass || undefined,
    backup_ftp_path: remote.ftp.path,
    backup_webdav_url: remote.webdav.url,
    backup_webdav_user: remote.webdav.user,
    backup_webdav_pass: remote.webdav.pass || undefined,
    backup_webdav_path: remote.webdav.path,
    backup_od_client_id: remote.od.client_id,
    backup_od_client_secret: remote.od.client_secret || undefined,
    backup_od_folder: remote.od.folder,
    backup_od_endpoint: remote.od.endpoint
  });
  ElMessage.success('远程存储配置已保存');
  loadBackup();
}
async function authOneDrive() {
  odLoading.value = true;
  try {
    const r = await api.get('/backups/onedrive/auth');
    // 先保存当前表单配置，再打开授权窗口
    await saveRemoteCfg();
    const w = window.open(r.url, '_blank', 'width=600,height=700');
    if (!w) { ElMessage.warning('浏览器拦截了弹窗，请允许后重试'); return; }
    // 轮询授权状态（10 秒后刷新）
    setTimeout(loadBackup, 12000);
  } finally {
    odLoading.value = false;
  }
}
async function manualBackup(remote) {
  const res = await api.post('/backups', { remote });
  if (res.remote_ok) ElMessage.success(`备份成功，已同步远程：${res.file}`);
  else if (remote && res.remote_err) ElMessage.warning(`本地备份成功，但远程上传失败：${res.remote_err}`);
  else ElMessage.success(`备份成功：${res.file}`);
  loadBackup();
}
function download(row) {
  window.open(`/api/backups/${encodeURIComponent(row.file)}/download`, '_blank');
}
async function restore(row) {
  const { value } = await ElMessageBox.prompt(
    `恢复将用「${row.file}」覆盖当前全部数据。请输入「恢复」两字确认：`,
    '数据恢复（高危）',
    { confirmButtonText: '执行恢复', cancelButtonText: '取消', inputPlaceholder: '请输入：恢复', inputPattern: /^恢复$/, inputErrorMessage: '必须输入「恢复」两字', closeOnClickModal: false }
  );
  if (value !== '恢复') return;
  await api.post('/backups/restore', { file: row.file });
  ElMessage.success('恢复成功，服务正在重启，请稍后刷新页面');
  setTimeout(() => location.reload(), 3000);
}
async function delBackup(row) {
  await confirmDelete(`备份「${row.file}」`);
  await api.delete(`/backups/${encodeURIComponent(row.file)}`);
  ElMessage.success('备份已删除');
  loadBackup();
}
</script>
