<template>
  <el-container style="height: 100vh;">
    <el-aside width="210px" style="background:#fff;border-right:1px solid #e8ecf1;">
      <div style="height:56px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid #f0f2f5;">
        <span style="font-size:18px;font-weight:700;color:#2f54eb;">路客家</span>
        <span style="font-size:12px;color:#9aa3b2;margin-left:8px;">公寓管理</span>
      </div>
      <el-menu :default-active="$route.path" router style="border-right:none;">
        <el-menu-item index="/dashboard"><el-icon><Odometer /></el-icon><span>仪表盘</span></el-menu-item>
        <el-menu-item index="/properties"><el-icon><HomeFilled /></el-icon><span>房源管理</span></el-menu-item>
        <el-menu-item index="/tenants"><el-icon><UserFilled /></el-icon><span>租客管理</span></el-menu-item>
        <el-menu-item index="/contracts"><el-icon><Document /></el-icon><span>合同管理</span></el-menu-item>
        <el-menu-item index="/bills"><el-icon><Money /></el-icon><span>账单管理</span></el-menu-item>
        <el-menu-item index="/payments"><el-icon><Tickets /></el-icon><span>收款记录</span></el-menu-item>
        <el-menu-item index="/refunds"><el-icon><RefreshLeft /></el-icon><span>押金退款</span></el-menu-item>
        <el-menu-item index="/meterings"><el-icon><DataLine /></el-icon><span>抄表管理</span></el-menu-item>
        <el-menu-item v-if="role==='admin'" index="/settings"><el-icon><Setting /></el-icon><span>系统设置</span></el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header style="height:56px;background:#fff;border-bottom:1px solid #f0f2f5;display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:15px;font-weight:600;color:#1f2937;">{{ $route.meta.title }}</span>
        <div style="display:flex;align-items:center;gap:12px;">
          <el-tag size="small" type="warning" v-if="settings.switches && settings.switches.payment_confirm_mode==='manual'">收款：手工确认</el-tag>
          <el-tag size="small" type="info" v-if="settings.switches && settings.switches.realname_verify_mode==='manual'">实名：手工审核</el-tag>
          <span style="font-size:13px;color:#4b5563;">Hi，{{ user.display_name || user.username }}</span>
          <el-button size="small" @click="logout">退出</el-button>
        </div>
      </el-header>
      <el-main style="background:#f5f7fa;padding:16px;">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api';
import { Odometer, HomeFilled, UserFilled, Document, Money, Tickets, RefreshLeft, Setting, DataLine } from '@element-plus/icons-vue';

const router = useRouter();
const user = reactive({});
const settings = reactive({});
const role = ref(localStorage.getItem('lk_role') || 'admin');

onMounted(async () => {
  try {
    const me = await api.get('/auth/me');
    Object.assign(user, me);
    role.value = me.role || 'admin';
    localStorage.setItem('lk_role', me.role || 'admin');
    Object.assign(settings, await api.get('/settings'));
  } catch { /* 401 由拦截器处理 */ }
});

function logout() {
  localStorage.removeItem('lk_token');
  localStorage.removeItem('lk_role');
  localStorage.removeItem('lk_name');
  router.push('/login');
}
</script>
