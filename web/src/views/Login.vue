<template>
  <div class="lkj-login-page" style="height:100vh;display:flex;align-items:center;justify-content:center;background:#f0f4ff;">
    <div class="lkj-login-card" style="width:380px;background:#fff;border-radius:12px;padding:36px 32px;box-shadow:0 8px 30px rgba(47,84,235,.12);">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:26px;font-weight:800;color:#2f54eb;">路客家</div>
        <div style="font-size:13px;color:#9aa3b2;margin-top:6px;">公寓管理系统</div>
      </div>
      <el-form @submit.prevent>
        <el-form-item>
          <el-input v-model="username" placeholder="用户名" size="large" autofocus />
        </el-form-item>
        <el-form-item>
          <el-input v-model="password" type="password" placeholder="密码" size="large" :show-password="true" @keyup.enter="login" />
        </el-form-item>
        <el-button type="primary" size="large" style="width:100%;" :loading="loading" @click="login">登 录</el-button>
      </el-form>
      <div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center;">
        <el-link type="primary" :underline="false" style="font-size:13px;" @click="forgotDlg=true">忘记密码？</el-link>
        <span style="font-size:12px;color:#c0c6d0;">初始账号 admin / admin123</span>
      </div>
    </div>

    <!-- 忘记密码弹窗 -->
    <el-dialog v-model="forgotDlg" title="找回密码" width="400px">
      <el-form label-width="90px" size="small" @submit.prevent>
        <el-form-item label="用户名/邮箱"><el-input v-model="forgotAccount" placeholder="输入用户名或绑定邮箱" @keyup.enter="sendReset" /></el-form-item>
      </el-form>
      <div v-if="forgotMsg" style="font-size:13px;color:#67c23a;margin-bottom:8px;">{{ forgotMsg }}</div>
      <div v-if="forgotErr" style="font-size:13px;color:#f56c6c;margin-bottom:8px;">{{ forgotErr }}</div>
      <template #footer>
        <el-button @click="forgotDlg=false">关闭</el-button>
        <el-button type="primary" :loading="forgotLoading" @click="sendReset">发送重置链接</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '../api';

const router = useRouter();
const username = ref('admin');
const password = ref('');
const loading = ref(false);
const forgotDlg = ref(false);
const forgotAccount = ref('');
const forgotMsg = ref('');
const forgotErr = ref('');
const forgotLoading = ref(false);

async function login() {
  if (!username.value.trim() || !password.value) return ElMessage.warning('请输入用户名和密码');
  loading.value = true;
  try {
    const r = await api.post('/auth/login', { username: username.value.trim(), password: password.value });
    localStorage.setItem('lk_token', r.token);
    localStorage.setItem('lk_role', r.role);
    localStorage.setItem('lk_user', JSON.stringify(r.user || {}));
    router.push('/');
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || '登录失败');
  } finally { loading.value = false; }
}

async function sendReset() {
  forgotMsg.value = ''; forgotErr.value = '';
  if (!forgotAccount.value.trim()) return ElMessage.warning('请输入用户名或邮箱');
  forgotLoading.value = true;
  try {
    const r = await api.post('/auth/forgot', { account: forgotAccount.value.trim() });
    if (r.sent) {
      forgotMsg.value = '重置链接已发送至该账号绑定邮箱，请在 15 分钟内完成重置。';
    } else if (r.sent === false) {
      forgotErr.value = '账号不存在或已停用';
    } else {
      forgotMsg.value = '处理完成，请查看邮箱（如配置了邮件服务）。';
    }
  } catch (e) {
    forgotErr.value = e?.response?.data?.error || '发送失败';
  } finally { forgotLoading.value = false; }
}
</script>
