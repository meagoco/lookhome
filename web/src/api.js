import axios from 'axios';
import { ElMessage } from 'element-plus';
import router from './router';

const api = axios.create({ baseURL: '/api', timeout: 20000 });

const isDemo = () => localStorage.getItem('lk_demo_mode') === '1';

api.interceptors.request.use(cfg => {
  if (isDemo()) {
    // 演示模式：全部请求路由到测试沙箱（/api/demo/*），不触碰正式业务
    const t = localStorage.getItem('lk_demo_token');
    if (t) cfg.headers.Authorization = 'Bearer ' + t;
    if (cfg.url && !cfg.url.startsWith('/demo')) cfg.url = '/demo' + cfg.url;
  } else {
    const token = localStorage.getItem('lk_token');
    if (token) cfg.headers.Authorization = 'Bearer ' + token;
  }
  return cfg;
});

api.interceptors.response.use(
  res => res.data,
  err => {
    const msg = err.response?.data?.error || err.message || '请求失败';
    if (err.response?.status === 401) {
      if (isDemo()) {
        localStorage.removeItem('lk_demo_mode');
        localStorage.removeItem('lk_demo_token');
        window.location.href = '/demo-hub.html';
      } else {
        localStorage.removeItem('lk_token');
        router.push('/login');
      }
    } else {
      ElMessage.error(msg);
    }
    return Promise.reject(err);
  }
);

export default api;
