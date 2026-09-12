import axios from 'axios';
import { ElMessage } from 'element-plus';
import router from './router';

const api = axios.create({ baseURL: '/api', timeout: 20000 });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('lk_token');
  if (token) cfg.headers.Authorization = 'Bearer ' + token;
  return cfg;
});

api.interceptors.response.use(
  res => res.data,
  err => {
    const msg = err.response?.data?.error || err.message || '请求失败';
    if (err.response?.status === 401) {
      localStorage.removeItem('lk_token');
      router.push('/login');
    } else {
      ElMessage.error(msg);
    }
    return Promise.reject(err);
  }
);

export default api;
