import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/login', component: () => import('./views/Login.vue') },
  { path: '/reset', component: () => import('./views/Reset.vue') },
  {
    path: '/',
    component: () => import('./views/Layout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', component: () => import('./views/Dashboard.vue'), meta: { title: '仪表盘' } },
      { path: 'properties', component: () => import('./views/Properties.vue'), meta: { title: '房源管理' } },
      { path: 'tenants', component: () => import('./views/Tenants.vue'), meta: { title: '租客管理' } },
      { path: 'contracts', component: () => import('./views/Contracts.vue'), meta: { title: '合同管理' } },
      { path: 'bills', component: () => import('./views/Bills.vue'), meta: { title: '账单管理' } },
      { path: 'payments', component: () => import('./views/Payments.vue'), meta: { title: '收款记录' } },
      { path: 'refunds', component: () => import('./views/Refunds.vue'), meta: { title: '押金退款' } },
      { path: 'meterings', component: () => import('./views/Meterings.vue'), meta: { title: '抄表管理' } },
      { path: 'pay-configs', component: () => import('./views/PayConfigs.vue'), meta: { title: '支付配置' } },
      { path: 'settings', component: () => import('./views/Settings.vue'), meta: { title: '系统设置' } }
    ]
  }
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  const token = localStorage.getItem('lk_token');
  if (!token && to.path !== '/login' && to.path !== '/reset') return '/login';
  if (token && (to.path === '/login' || to.path === '/reset')) return '/';
  if (token && to.path === '/settings' && localStorage.getItem('lk_role') === 'operator') return '/dashboard';
});

export default router;
