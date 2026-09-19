// Light/dark theme runtime. The class lives on <html>; index.html applies it
// pre-paint so the initial render never flashes the wrong theme.
import { ref } from 'vue'

const STORAGE_KEY = 'mmcb.theme'
export type ThemeMode = 'light' | 'dark'

function systemPrefersLight(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false
}

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* storage unavailable */
  }
  return systemPrefersLight() ? 'light' : 'dark'
}

function apply(mode: ThemeMode): void {
  document.documentElement.classList.toggle('light', mode === 'light')
}

const theme = ref<ThemeMode>(document.documentElement.classList.contains('light') ? 'light' : readStored())
apply(theme.value)

export function useTheme() {
  function setTheme(mode: ThemeMode): void {
    const updateTheme = () => {
      theme.value = mode
      try {
        localStorage.setItem(STORAGE_KEY, mode)
      } catch {
        /* ignore */
      }
      apply(mode)
    }

    // استفاده از View Transitions API برای انیمیشن نرم تغییر تم
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      // @ts-ignore
      document.startViewTransition(() => {
        updateTheme()
      })
    } else {
      updateTheme()
    }
  }

  function toggleTheme(): void {
    setTheme(theme.value === 'light' ? 'dark' : 'light')
  }

  return { theme, setTheme, toggleTheme }
}