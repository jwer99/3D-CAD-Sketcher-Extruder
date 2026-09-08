export function readTheme(): 'dark' | 'light' {
  try { return localStorage.getItem('voxel3d-theme') === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}
export function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try { localStorage.setItem('voxel3d-theme', theme); } catch { /* Storage may be unavailable. */ }
}
