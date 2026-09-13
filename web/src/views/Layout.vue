<template>
  <el-container style="height: 100vh;">
    <!-- 桌面侧边栏（≥769px） -->
    <el-aside v-if="!isMobile" width="210px" style="background:#fff;border-right:1px solid #e8ecf1;">
      <div style="height:56px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid #f0f2f5;">
        <span style="font-size:18px;font-weight:700;color:#2f54eb;">路客家</span>
        <span style="font-size:12px;color:#9aa3b2;margin-left:8px;">公寓管理</span>
      </div>
      <el-menu :default-active="$route.path" router style="border-right:none;">
        <el-menu-item v-for="m in menuItems" :key="m.path" :index="m.path">
          <el-icon><component :is="m.icon" /></el-icon><span>{{ m.label }}</span>
        </el-menu-item>
        <el-menu-item v-if="role==='admin'" index="/settings"><el-icon><Setting /></el-icon><span>系统设置</span></el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header style="height:56px;background:#fff;border-bottom:1px solid #f0f2f5;display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:10px;">
          <el-button v-if="isMobile" size="small" text style="font-size:20px;" @click="drawer=true">
            <el-icon><Menu /></el-icon>
          </el-button>
          <span style="font-size:15px;font-weight:600;color:#1f2937;">{{ $route.meta.title }}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <el-tag size="small" type="warning" v-if="settings.switches && settings.switches.payment_confirm_mode==='manual'">收款：手工确认</el-tag>
          <el-tag size="small" type="info" v-if="settings.switches && settings.switches.realname_verify_mode==='manual'">实名：手工审核</el-tag>
          <span style="font-size:13px;color:#4b5563;white-space:nowrap;">Hi，{{ user.display_name || user.username }}</span>
          <el-button size="small" @click="logout">退出</el-button>
        </div>
      </el-header>
      <el-main style="background:#f5f7fa;padding:16px;">
        <router-view />
      </el-main>
    </el-container>

    <!-- 移动端抽屉菜单（≤768px 自动启用） -->
    <el-drawer v-model="drawer" direction="ltr" size="220px" :with-header="false" style="background:#fff;">
      <div class="lkj-drawer-brand">路客家<small>公寓管理</small></div>
      <el-menu :default-active="$route.path" router style="border-right:none;">
        <el-menu-item v-for="m in menuItems" :key="m.path" :index="m.path" @click="drawer=false">
          <el-icon><component :is="m.icon" /></el-icon><span>{{ m.label }}</span>
        </el-menu-item>
        <el-menu-item v-if="role==='admin'" index="/settings" @click="drawer=false"><el-icon><Setting /></el-icon><span>系统设置</span></el-menu-item>
      </el-menu>
    </el-drawer>
  </el-container>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api';
import { Odometer, HomeFilled, UserFilled, Document, Money, Tickets, RefreshLeft, Setting, DataLine, CreditCard, Menu } from '@element-plus/icons-vue';

const router = useRouter();
const user = reactive({});
const settings = reactive({});
const role = ref(localStorage.getItem('lk_role') || 'admin');
const drawer = ref(false);

// 设备识别：≤768px 视为移动端（手机/平板竖屏）
const isMobile = ref(window.innerWidth < 768);
function onResize() {
  const m = window.innerWidth < 768;
  if (!m) drawer.value = false;
  isMobile.value = m;
}

const menuItems = [
  { path: '/dashboard', icon: Odometer, label: '仪表盘' },
  { path: '/properties', icon: HomeFilled, label: '房源管理' },
  { path: '/tenants', icon: UserFilled, label: '租客管理' },
  { path: '/contracts', icon: Document, label: '合同管理' },
  { path: '/bills', icon: Money, label: '账单管理' },
  { path: '/payments', icon: Tickets, label: '收款记录' },
  { path: '/refunds', icon: RefreshLeft, label: '押金退款' },
  { path: '/meterings', icon: DataLine, label: '抄表管理' },
  { path: '/pay-configs', icon: CreditCard, label: '支付配置' }
];

onMounted(async () => {
  window.addEventListener('resize', onResize);
  try {
    const me = await api.get('/auth/me');
    Object.assign(user, me);
    role.value = me.role || 'admin';
    localStorage.setItem('lk_role', me.role || 'admin');
    Object.assign(settings, await api.get('/settings'));
  } catch { /* 401 由拦截器处理 */ }
});
onBeforeUnmount(() => window.removeEventListener('resize', onResize));

function logout() {
  localStorage.removeItem('lk_token');
  localStorage.removeItem('lk_role');
  localStorage.removeItem('lk_name');
  router.push('/login');
}
</script>
