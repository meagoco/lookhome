import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import './assets/mobile.css';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import App from './App.vue';
import router from './router';

const app = createApp(App);
app.use(ElementPlus, { locale: zhCn });
app.use(router);
app.mount('#app');
