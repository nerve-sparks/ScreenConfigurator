import { useTheme } from '../../lib/ThemeContext.jsx'
import { Moon, Sun } from './Icons.jsx'

/** Light/dark switch. Reflects the resolved theme, writes an explicit choice. */
export default function ThemeToggle({ className = '' }) {
  const { resolvedTheme, toggleTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  return (
    <button
      type="button"
      className={`ui-theme-toggle ${className}`.trim()}
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light theme' : 'Dark theme'}
    >
      {isDark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  )
}
