import { useEffect, useState } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

type Tab = 'workspace' | 'library' | 'notebook';

const TAB_LABEL: Record<Tab, string> = {
  workspace: 'إعداد النصوص',
  library: 'المكتبة',
  notebook: 'المفردات',
};

export function TechStatusBar({ tab, books, words, theme }: { tab: Tab; books: number; words: number; theme: string }) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return (
    <footer className="tech-statusbar" aria-label="شريط الحالة">
      <span className="tech-status-item"><span className={`tech-dot ${online ? 'ok' : 'off'}`} />{online ? 'متصل' : 'دون اتصال'}</span>
      <span className="tech-status-item"><i className="fa-solid fa-database" /> محفوظ محلياً</span>
      <span className="tech-status-item">{TAB_LABEL[tab]}</span>
      <span className="tech-status-spacer" />
      <span className="tech-status-item mono">BOOKS {books}</span>
      <span className="tech-status-item mono">WORDS {words}</span>
      <span className="tech-status-item mono">THEME {theme.toUpperCase()}</span>
    </footer>
  );
}

export function TechCommandPalette({
  books,
  onTab,
  onTheme,
}: {
  books: { id: string; title: string }[];
  onTab: (t: Tab) => void;
  onTheme: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const evt = () => setOpen(true);
    window.addEventListener('keydown', key);
    window.addEventListener('open-cmdk', evt);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('open-cmdk', evt);
    };
  }, []);
  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <div dir="rtl" className="tech-cmdk">
        <CommandInput placeholder="اكتب أمراً أو اسم كتاب…" />
        <CommandList>
          <CommandEmpty>لا نتائج.</CommandEmpty>
          <CommandGroup heading="التنقل">
            {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
              <CommandItem key={t} onSelect={() => run(() => onTab(t))}>{TAB_LABEL[t]}</CommandItem>
            ))}
          </CommandGroup>
          {books.length > 0 && (
            <CommandGroup heading="الكتب">
              {books.slice(0, 30).map((b) => (
                <CommandItem key={b.id} onSelect={() => run(() => onTab('library'))}>{b.title}</CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="المظهر">
            <CommandItem onSelect={() => run(() => onTheme('obsidian'))}>الوضع الداكن</CommandItem>
            <CommandItem onSelect={() => run(() => onTheme('parchment'))}>الوضع الفاتح</CommandItem>
          </CommandGroup>
        </CommandList>
      </div>
    </CommandDialog>
  );
}
