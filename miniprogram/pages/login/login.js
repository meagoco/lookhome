const api = require('../../utils/request');

Page({
  data: {
    tab: 'login',
    phone: '', name: '', idCard: '',
    loading: false, wxLoading: false,
    boundOpenid: ''  // 微信登录未绑定时暂存 openid，提交登录/注册时绑定
  },
  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },
  onPhone(e) { this.setData({ phone: e.detail.value }); },
  onName(e) { this.setData({ name: e.detail.value }); },
  onIdCard(e) { this.setData({ idCard: e.detail.value }); },

  // 微信一键登录：code → openid → 已绑定直接登录；未绑定提示用手机号+身份证绑定
  async wxLogin() {
    if (this.data.wxLoading) return;
    this.setData({ wxLoading: true });
    try {
      const code = await new Promise((resolve, reject) => {
        wx.login({
          success: (r) => (r.code ? resolve(r.code) : reject(new Error('获取微信登录凭证失败'))),
          fail: () => reject(new Error('微信登录失败，请检查网络'))
        });
      });
      const res = await api.post('/tenant/wx-login', { code });
      if (res.token) {
        wx.setStorageSync('lk_tk', res.token);
        wx.switchTab({ url: '/pages/home/home' });
        return;
      }
      if (res.need_bind) {
        this.setData({ boundOpenid: res.openid, tab: 'login' });
        wx.showModal({
          title: '微信已识别',
          content: res.notice || '请用注册时的手机号和身份证完成绑定',
          showCancel: false
        });
      }
    } catch (e) {
      wx.showToast({ title: e.message || '微信登录失败', icon: 'none' });
    } finally {
      this.setData({ wxLoading: false });
    }
  },

  async submit() {
    const { tab, phone, name, idCard, boundOpenid } = this.data;
    if (!phone) return wx.showToast({ title: '请输入手机号', icon: 'none' });
    if (!idCard) return wx.showToast({ title: '请输入身份证号', icon: 'none' });
    if (tab === 'register' && !name) return wx.showToast({ title: '请输入姓名', icon: 'none' });
    this.setData({ loading: true });
    try {
      const base = { phone, id_card: idCard };
      if (boundOpenid) base.openid = boundOpenid;
      if (tab === 'login') {
        const res = await api.post('/tenant/login', base);
        wx.setStorageSync('lk_tk', res.token);
        wx.switchTab({ url: '/pages/home/home' });
      } else {
        const res = await api.post('/tenant/register', { name, phone, id_card: idCard, openid: boundOpenid || '' });
        wx.showModal({
          title: '注册成功',
          content: res.notice || '请等待房东审核',
          showCancel: false,
          success: () => this.setData({ tab: 'login', name: '', idCard: '', boundOpenid: '' })
        });
      }
    } catch { /* request 已提示 */ } finally {
      this.setData({ loading: false });
    }
  }
});
