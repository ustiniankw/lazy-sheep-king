// lib/layout.js — v0.5.0: Responsive layout helpers
// Breakpoints: phone < 640, tablet 640-1023, desktop >= 1024

/**
 * Compute breakpoint name from viewport width.
 * @param {number} width - viewport width in px
 * @returns {'phone'|'tablet'|'desktop'}
 */
export function computeBreakpoint(width) {
  if (typeof width !== 'number' || isNaN(width) || width < 0) return 'phone';
  if (width < 640) return 'phone';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

/**
 * Determine which layout chrome elements should be visible.
 * @param {'phone'|'tablet'|'desktop'} breakpoint
 * @param {'3pane'|'centered'} desktopMode
 * @returns {{ sidebar: boolean, rightPanel: boolean, iconRail: boolean, tabbar: boolean, topbarQuickActions: boolean }}
 */
export function layoutVisibility(breakpoint, desktopMode = '3pane') {
  if (breakpoint === 'phone') {
    return { sidebar: false, rightPanel: false, iconRail: false, tabbar: true, topbarQuickActions: true };
  }
  if (breakpoint === 'tablet') {
    return { sidebar: true, rightPanel: false, iconRail: false, tabbar: false, topbarQuickActions: false };
  }
  // desktop
  if (desktopMode === 'centered') {
    return { sidebar: false, rightPanel: false, iconRail: true, tabbar: false, topbarQuickActions: false };
  }
  // 3pane default
  return { sidebar: true, rightPanel: true, iconRail: false, tabbar: false, topbarQuickActions: false };
}

/**
 * v0.7.0 — 主内容区底部内边距。
 * 手机端需要为底部 tab bar + iOS home indicator 安全区留白，避免底端按钮被遮挡；
 * 平板 / 桌面没有 tab bar，用普通留白即可。
 * @param {'phone'|'tablet'|'desktop'} breakpoint
 * @returns {string} 合法 CSS padding-bottom 值
 */
export function contentBottomPadding(breakpoint) {
  if (breakpoint === 'phone') {
    return 'calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 16px)';
  }
  return '24px';
}

/**
 * v0.7.0 — 固定/绝对定位底部悬浮 CTA 的 bottom 值（手机端需避开 tab bar + 安全区）。
 * @param {'phone'|'tablet'|'desktop'} breakpoint
 * @returns {string} 合法 CSS bottom 值
 */
export function floatingCtaBottom(breakpoint) {
  if (breakpoint === 'phone') {
    return 'calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 12px)';
  }
  return '16px';
}
