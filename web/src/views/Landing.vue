<template>
  <div class="landing">
    <!-- 顶部导航 -->
    <header class="nav" :class="{ scrolled: scrolled }">
      <div class="nav-inner">
        <div class="brand">
          <BrandLogo :size="40" dark sub="公寓智慧运营平台" />
        </div>
        <nav class="nav-links">
          <a href="#features">核心功能</a>
          <a href="#flow">业务流程</a>
          <a href="#security">数据安全</a>
          <a href="/demo-hub.html" class="nav-demo">测试体验</a>
        </nav>
        <el-button type="primary" round class="nav-login" @click="$router.push('/login')">登 录</el-button>
      </div>
    </header>

    <!-- Hero -->
    <section class="hero">
      <div class="hero-bg"></div>
      <div class="hero-inner">
        <div class="hero-badge">自研 · 私有化部署 · 微信生态</div>
        <h1 class="hero-title">让每一套公寓<br /><em>聪明地</em>运营起来</h1>
        <p class="hero-sub">
          LookHome是一套面向公寓房东的智慧管理系统 —— 房源、租客、合同、账单、
          抄表、退款全流程线上化，租客微信小程序自助查账单、缴租金，房东后台一键掌控全局。
        </p>
        <div class="hero-actions">
          <el-button type="primary" size="large" round @click="$router.push('/login')">立即登录使用</el-button>
          <el-button size="large" round plain class="hero-ghost" @click="scrollTo('#features')">了解核心功能</el-button>
          <el-button size="large" round plain class="hero-demo" @click="openDemo">体验测试环境</el-button>
        </div>
        <div class="hero-stats">
          <div class="stat"><div class="stat-num">100%</div><div class="stat-label">数据私有化掌控</div></div>
          <div class="stat"><div class="stat-num">7×24</div><div class="stat-label">系统自动运转</div></div>
          <div class="stat"><div class="stat-num">全场景</div><div class="stat-label">微信生态打通</div></div>
        </div>
      </div>
    </section>

    <!-- 核心功能 -->
    <section class="features" id="features">
      <div class="sec-head">
        <h2>一套系统，管好出租的每一件事</h2>
        <p>从签约到收租，从抄表到退房，全部数字化、自动化、可追溯</p>
      </div>
      <div class="feat-grid">
        <div class="feat-card" v-for="f in features" :key="f.t">
          <div class="feat-ico">{{ f.i }}</div>
          <h3>{{ f.t }}</h3>
          <p>{{ f.d }}</p>
        </div>
      </div>
    </section>

    <!-- 业务流程 -->
    <section class="flow" id="flow">
      <div class="sec-head">
        <h2>从空置到收租，全流程闭环</h2>
        <p>每一笔钱、每一个状态都有记录，系统自动联动</p>
      </div>
      <div class="flow-steps">
        <div class="step" v-for="(s, idx) in steps" :key="s">
          <div class="step-no">{{ idx + 1 }}</div>
          <div class="step-body">
            <div class="step-title">{{ s.t }}</div>
            <div class="step-desc">{{ s.d }}</div>
          </div>
          <div class="step-arrow" v-if="idx < steps.length - 1">→</div>
        </div>
      </div>
      <div class="flow-note">租客全部操作在小程序完成：实名注册 → 查账单 → 线上缴费 → 申请退押金</div>
    </section>

    <!-- 数据安全 -->
    <section class="security" id="security">
      <div class="sec-head light">
        <h2>你的数据，只属于你</h2>
        <p>区别于市面 SaaS 租用系统，LookHome直接部署在你的服务器上</p>
      </div>
      <div class="sec-grid">
        <div class="sec-card" v-for="s in security" :key="s.t">
          <div class="sec-ico">{{ s.i }}</div>
          <h3>{{ s.t }}</h3>
          <p>{{ s.d }}</p>
        </div>
      </div>
    </section>

    <!-- 底部 -->
    <footer class="footer">
      <div class="brand">LookHome · 公寓智慧运营平台</div>
      <div class="footer-links">
        <span>© 2026 LookHome</span>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import BrandLogo from '../components/BrandLogo.vue';

const scrolled = ref(false);
const onScroll = () => { scrolled.value = window.scrollY > 40; };

const features = [
  { i: '🏢', t: '房源智能管理', d: '项目 / 楼栋 / 房间三级结构，空置与在租状态自动联动，一房一生效合同，杜绝重复出租' },
  { i: '📋', t: '合同与账务', d: '合同自动生成，租金押金由房东设定；到期、退房、作废全流程留痕，历史租赁一键追溯' },
  { i: '💰', t: '微信线上收租', d: '租客微信小程序查看账单、缴纳租金 / 水电 / 垃圾费，房东后台实时收款，支持多商户号配置' },
  { i: '📊', t: '智能抄表', d: 'Excel 模板导出、批量导入抄表，水电气数据自动生成账单，无需手工计算' },
  { i: '🔔', t: '自动缴费提醒', d: '到期前 3 天自动向租客小程序推送提醒，逾期可批量催缴，提醒状态全程可查' },
  { i: '👥', t: '多角色权限', d: '主管理员 + 操作员分级授权，按项目隔离数据，操作留痕，谁动了什么一目了然' }
];

const steps = [
  { t: '录入房源', d: '项目 / 楼栋 / 房间批量建档，状态实时更新' },
  { t: '租客注册', d: '小程序实名注册，房东后台审核绑定房间' },
  { t: '签订合同', d: '房东设定租金押金，合同生效即锁定房间' },
  { t: '账单缴费', d: '房租 + 水电 + 垃圾费自动生成，小程序在线支付' },
  { t: '提醒催缴', d: '到期自动提醒、逾期批量催缴，不再跑断腿' },
  { t: '退房结算', d: '退押金自动解约，房间自动置空，随时可再租' }
];

const security = [
  { i: '🔒', t: '私有化部署', d: '系统跑在你自己的服务器上，数据不出你的掌控，不依赖任何第三方 SaaS' },
  { i: '🗄️', t: '自动备份恢复', d: '支持周期自动备份，可对接 FTP / WebDAV / OneDrive 等远程存储，一键导入恢复' },
  { i: '🛡️', t: '多重安全防护', d: '登录限流、密钥加密存储、支付回调验签、国内 IP 访问控制，全方位防篡改' }
];

const scrollTo = (sel) => {
  const el = document.querySelector(sel);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
};
const openDemo = () => { window.location.href = '/demo-hub.html'; };

onMounted(() => {
  window.addEventListener('scroll', onScroll);
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in'); });
  }, { threshold: 0.12 });
  document.querySelectorAll('.feat-card, .step, .sec-card').forEach((el) => io.observe(el));
});
onUnmounted(() => window.removeEventListener('scroll', onScroll));
</script>

<style scoped>
.landing { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #1f2733; background: #f7f9fc; }
* { box-sizing: border-box; }
a { text-decoration: none; }

/* 导航 */
.nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; transition: all .3s; background: transparent; }
.nav.scrolled { background: rgba(10, 18, 32, .92); backdrop-filter: blur(12px); box-shadow: 0 4px 24px rgba(0,0,0,.25); }
.nav-inner { max-width: 1180px; margin: 0 auto; padding: 18px 28px; display: flex; align-items: center; justify-content: space-between; }
.brand { display: flex; align-items: center; gap: 12px; }
.nav-links { display: flex; gap: 34px; }
.nav-links a { color: rgba(255,255,255,.82); font-size: 15px; transition: color .2s; }
.nav-links a:hover { color: #12d8fa; }
.nav-login { font-weight: 600; }

/* Hero */
.hero { position: relative; min-height: 100vh; display: flex; align-items: center; background: radial-gradient(1200px 600px at 75% -10%, rgba(18,216,250,.22), transparent 60%), radial-gradient(900px 500px at 10% 110%, rgba(31,162,255,.18), transparent 55%), linear-gradient(160deg, #0a1220 0%, #0d1b30 55%, #0a1628 100%); overflow: hidden; }
.hero-bg { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px); background-size: 56px 56px; mask-image: radial-gradient(ellipse at center, #000 30%, transparent 75%); }
.hero-inner { position: relative; max-width: 1180px; margin: 0 auto; padding: 120px 28px 80px; text-align: center; }
.hero-badge { display: inline-block; padding: 7px 18px; border-radius: 999px; border: 1px solid rgba(18,216,250,.45); color: #7ee2ff; font-size: 13px; letter-spacing: 2px; background: rgba(18,216,250,.08); margin-bottom: 28px; }
.hero-title { color: #fff; font-size: 56px; line-height: 1.25; font-weight: 800; margin: 0 0 24px; letter-spacing: 2px; }
.hero-title em { font-style: normal; background: linear-gradient(90deg, #1fa2ff, #12d8fa, #34f5c5); -webkit-background-clip: text; background-clip: text; color: transparent; }
.hero-sub { max-width: 720px; margin: 0 auto 40px; color: rgba(255,255,255,.75); font-size: 17px; line-height: 1.9; }
.hero-actions { display: flex; gap: 16px; justify-content: center; margin-bottom: 64px; }
.hero-ghost { color: #fff !important; border-color: rgba(255,255,255,.4) !important; background: transparent !important; }
.hero-ghost:hover { border-color: #12d8fa !important; color: #12d8fa !important; }
.hero-demo { color: #7ee2ff !important; border-color: rgba(18,216,250,.55) !important; background: rgba(18,216,250,.08) !important; }
.hero-demo:hover { border-color: #12d8fa !important; color: #fff !important; }
.nav-demo { color: #7ee2ff; font-weight: 600; }
.hero-stats { display: flex; justify-content: center; gap: 72px; }
.stat { text-align: center; }
.stat-num { font-size: 30px; font-weight: 800; color: #12d8fa; }
.stat-label { margin-top: 6px; font-size: 13px; color: rgba(255,255,255,.6); letter-spacing: 1px; }

/* 通用节 */
.sec-head { text-align: center; max-width: 720px; margin: 0 auto 56px; }
.sec-head h2 { font-size: 34px; font-weight: 800; margin: 0 0 14px; color: #12203a; letter-spacing: 1px; }
.sec-head p { color: #6b7688; font-size: 16px; }
.sec-head.light h2 { color: #fff; }
.sec-head.light p { color: rgba(255,255,255,.6); }

/* 功能 */
.features { padding: 100px 28px; max-width: 1180px; margin: 0 auto; }
.feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.feat-card { background: #fff; border: 1px solid #e8eef7; border-radius: 18px; padding: 32px 28px; box-shadow: 0 8px 28px rgba(18, 60, 120, .06); transition: transform .25s, box-shadow .25s; opacity: 0; transform: translateY(24px); }
.feat-card.in { opacity: 1; transform: translateY(0); }
.feat-card:hover { transform: translateY(-6px); box-shadow: 0 18px 44px rgba(18, 60, 120, .14); }
.feat-ico { font-size: 34px; margin-bottom: 16px; }
.feat-card h3 { font-size: 18px; font-weight: 700; margin: 0 0 10px; color: #14223c; }
.feat-card p { color: #667085; font-size: 14px; line-height: 1.8; margin: 0; }

/* 流程 */
.flow { padding: 100px 28px; background: #fff; }
.flow-steps { max-width: 1060px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
.step { position: relative; display: flex; gap: 14px; background: #f6f9fe; border: 1px solid #e6edf8; border-radius: 14px; padding: 22px; opacity: 0; transform: translateY(18px); transition: opacity .5s, transform .5s; }
.step.in { opacity: 1; transform: translateY(0); }
.step-no { flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #1fa2ff, #12d8fa); color: #fff; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 14px; }
.step-title { font-weight: 700; color: #14223c; margin-bottom: 6px; }
.step-desc { font-size: 13px; color: #667085; line-height: 1.7; }
.step-arrow { position: absolute; right: -18px; top: 50%; transform: translateY(-50%); color: #b6c4dc; font-size: 18px; z-index: 2; }
.flow-note { text-align: center; margin-top: 36px; color: #5a6b85; font-size: 14px; background: #eef6ff; border: 1px dashed #b8d8ff; border-radius: 10px; padding: 14px; max-width: 640px; margin-left: auto; margin-right: auto; }

/* 安全 */
.security { padding: 100px 28px; background: linear-gradient(160deg, #0d1b30 0%, #122a4a 100%); }
.sec-grid { max-width: 1060px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
.sec-card { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); border-radius: 16px; padding: 30px; text-align: center; opacity: 0; transform: translateY(18px); transition: opacity .5s, transform .5s; }
.sec-card.in { opacity: 1; transform: translateY(0); }
.sec-ico { font-size: 32px; margin-bottom: 14px; }
.sec-card h3 { color: #fff; font-size: 17px; margin: 0 0 10px; }
.sec-card p { color: rgba(255,255,255,.62); font-size: 13.5px; line-height: 1.8; margin: 0; }

/* 底部 */
.footer { padding: 36px 28px; text-align: center; background: #081120; color: rgba(255,255,255,.5); font-size: 13px; }
.footer .brand { justify-content: center; color: rgba(255,255,255,.8); font-size: 15px; font-weight: 600; margin-bottom: 10px; }
.footer-links { display: flex; gap: 20px; justify-content: center; }
.footer-links a { color: rgba(255,255,255,.45); }
.footer-links a:hover { color: #12d8fa; }

@media (max-width: 900px) {
  .nav-links { display: none; }
  .hero-title { font-size: 36px; }
  .hero-stats { gap: 32px; flex-wrap: wrap; }
  .feat-grid, .flow-steps, .sec-grid { grid-template-columns: 1fr; }
  .step-arrow { display: none; }
  .hero-actions { flex-direction: column; align-items: center; }
  .hero { min-height: auto; padding: 90px 0 60px; }
}
</style>
