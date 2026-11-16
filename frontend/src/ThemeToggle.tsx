import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';

// 初期値は index.html のインラインスクリプトが <html data-theme> に設定済み
function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

// className を渡すと既定の見た目（ヘッダー用の角丸ボタン）を置き換える
export default function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const next: Theme = theme === 'light' ? 'dark' : 'light';

  const toggle = () => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // プライベートモード等で保存できなくても切替自体は有効
    }
    setTheme(next);
  };

  const label = next === 'light' ? 'ライトモードに切り替え' : 'ダークモードに切り替え';
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={
        className ??
        'h-11 w-11 shrink-0 rounded-xl flex items-center justify-center text-slate-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] ring-1 ring-white/10 transition cursor-pointer'
      }
    >
      {theme === 'light' ? <Moon className="w-4.5 h-4.5" /> : <Sun className="w-4.5 h-4.5" />}
    </button>
  );
}
