// background/background.js — 服务 worker，暂时只做安装欢迎
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    try {
      chrome.notifications?.create('lsk-welcome', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: '懒羊羊大王已上线 🐑👑',
        message: '点击工具栏图标，把大事拆成傻瓜小步！你就是执行力大王！',
        priority: 1,
      });
    } catch (_) { /* ignore */ }
  }
});
