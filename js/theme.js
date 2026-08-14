/**
 * 主题管理：切换亮色 / 暗色外观，记忆偏好到 localStorage，
 * 并提供给 game.js 用的 Canvas 调色板（读取 CSS 变量）。
 */

export const THEME_KEY = 'gomoku-theme';

/** 返回当前主题 'light' | 'dark'（localStorage > 系统偏好 > 默认 dark） */
export function getTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  const prefersLight =
    window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  return prefersLight ? 'light' : 'dark';
}

/** 设置主题并持久化 */
export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

/** 切换到另一主题，返回切换后的值 */
export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** 应用已解析的主题（兜底，配合 index.html head 内联脚本） */
export function initTheme() {
  setTheme(getTheme());
}

/** 从 CSS 变量读取 Canvas 渲染用的调色板并缓存为对象 */
export function readCanvasPalette() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name) => cs.getPropertyValue(name).trim();
  return {
    board: get('--canvas-board'),
    grid: get('--canvas-grid'),
    black: [get('--canvas-black-0'), get('--canvas-black-1')],
    white: [get('--canvas-white-0'), get('--canvas-white-1'), get('--canvas-white-2')],
    shadow: get('--canvas-shadow'),
    win: get('--canvas-win'),
    last: get('--canvas-last'),
    hoverB: get('--canvas-hover-b'),
    hoverW: get('--canvas-hover-w'),
    hintB: get('--canvas-hint-b'),
    hintW: get('--canvas-hint-w'),
  };
}
