<template>
  <div style="height:100vh;display:flex;align-items:center;justify-content:center;background:#f0f4ff;">
    <div style="width:380px;background:#fff;border-radius:12px;padding:36px 32px;box-shadow:0 8px 30px rgba(47,84,235,.12);">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:26px;font-weight:800;color:#2f54eb;">路客家</div>
        <div style="font-size:13px;color:#9aa3b2;margin-top:6px;">设置新密码</div>
      </div>
      <el-form @submit.prevent>
        <el-form-item>
          <el-input v-model="pwd" type="password" placeholder="新密码（至少6位）" size="large" show-password />
        </el-form-item>
        <el-form-item>
          <el-input v-model="pwd2" type="password" placeholder="确认新密码" size="large" show-password @keyup.enter="doReset" />
        </el-form-item>
        <el-button type="primary" size="large" style="width:100%;" :loading="loading" @click="doReset">确认重置</el-button>
      </el-form>
      <div v-if="msg" style="margin-top:14px;font-size:13px;color:#67c23a;text-align:center;">{{ msg }}</div>
      <div v-if="err" style="margin-top:14px;font-size:13px;color:#f56c6c;text-align:center;">{{ err }}</div>
      <div style="margin-top:16px;text-align:center;">
        <el-link v-if="done" type="primary" :underline="false" @click="$router.push('/login')">返回登录</el-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '../api';

const route = useRoute();
const token = route.query.token || '';
const pwd = ref('');
const pwd2 = ref('');
const loading = ref(false);
const msg = ref('');
const err = ref('');
const done = ref(false);

async function doReset() {
  msg.value = ''; err.value = '';
  if (!token) return ElMessage.warning('缺少重置令牌');
  if (!pwd.value || pwd.value.length < 6) return ElMessage.warning('新密码至少 6 位');
  if (pwd.value !== pwd2.value) return ElMessage.warning('两次输入的密码不一致');
  loading.value = true;
  try {
    await api.post('/auth/reset', { token, newPwd: pwd.value });
    msg.value = '密码已重置，请使用新密码登录。';
    done.value = true;
    pwd.value = ''; pwd2.value = '';
  } catch (e) {
    err.value = e?.response?.data?.error || '重置失败';
  } finally { loading.value = false; }
}
</script>
