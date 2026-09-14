const config = require('./config');

App({
  globalData: {
    apiBase: config.apiBase
  },
  onLaunch() {
    const token = wx.getStorageSync('lk_tk');
    if (!token) {
      wx.reLaunch({ url: '/pages/login/login' });
    }
  }
});
