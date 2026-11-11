import { useState } from 'react';
import { Bookmark, Check, Copy, PanelLeftOpen, X, BookOpen, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import type { SavedWord } from './indexedDB';

export interface InspectorWord {
  word: string;
  meanings: string[];
  direction: 'ar-en' | 'en-ar';
  loading: boolean;
  root?: string;
  details?: string;
  examples?: { arabic: string; english: string }[];
  aiLoading?: boolean;
  aiExactMatch?: string;
  aiContextualMeaning?: string;
  aiExplanation?: string;
  aiError?: boolean;
  isPhrasalVerb?: boolean;
}

interface Props {
  word: InspectorWord;
  anchor: HTMLElement | null;
  savedWords: SavedWord[];
  isSaved: (word: string) => boolean;
  onSave: (word: { word: string; meanings: string[]; direction: 'ar-en' | 'en-ar' }) => void;
  onCopy: (text: string) => void;
  copied: boolean;
  onClose: () => void;
}

export function WordInspector({ word, anchor, savedWords, isSaved, onSave, onCopy, copied, onClose }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'dictionary' | 'vocabulary'>('dictionary');
  const meanings = [...new Set([word.aiExactMatch, ...word.meanings].filter((m): m is string => Boolean(m)))];
  const saved = isSaved(word.word);
  const actions = (
    <div className="word-inspector-actions">
      <Button variant="ghost" size="icon" aria-label={copied ? 'تم نسخ الترجمة' : 'نسخ الترجمة'} title="نسخ الترجمة" disabled={!meanings.length} onClick={() => onCopy(meanings.join(', '))}>{copied ? <Check /> : <Copy />}</Button>
      <Button variant="ghost" size="icon" aria-label={saved ? 'إزالة الكلمة من المفردات' : 'حفظ الكلمة'} title={saved ? 'إزالة من المفردات' : 'حفظ الكلمة'} aria-pressed={saved} disabled={!meanings.length} onClick={() => onSave({ word: word.word, meanings, direction: word.direction })}>{saved ? <Check /> : <Bookmark />}</Button>
      {!expanded && <Button variant="ghost" size="icon" aria-label="فتح تفاصيل الكلمة" title="فتح التفاصيل" onClick={() => setExpanded(true)}><PanelLeftOpen /></Button>}
      <Button variant="ghost" size="icon" aria-label="إغلاق المعجم" title="إغلاق المعجم" onClick={onClose}><X /></Button>
    </div>
  );
  const dictionary = (
    <div className="word-inspector-content" aria-live="polite">
      <section>
        <h4>المعجم <span>{word.direction === 'ar-en' ? 'AR → EN' : 'EN → AR'}</span></h4>
        {word.loading ? <p className="word-inspector-muted"><LoaderCircle className="animate-spin" size={16} /> جارٍ البحث…</p> : word.meanings.length ? <ul className="word-inspector-meanings">{(expanded ? word.meanings : word.meanings.slice(0, 3)).map((meaning, i) => <li key={`${meaning}-${i}`} dir="auto">{meaning}</li>)}</ul> : <p className="word-inspector-muted">لم يُعثر على معنى في المعجم.</p>}
        {word.root && expanded && <p className="word-inspector-muted">الأصل: <b dir="auto">{word.root}</b></p>}
        {word.isPhrasalVerb && <p className="word-inspector-muted">فعل مركب</p>}
      </section>
      {(word.aiLoading || word.aiExactMatch || word.aiError || expanded) && <section>
        <h4>المطابقة في النص المقابل</h4>
        {word.aiLoading ? <p className="word-inspector-muted"><LoaderCircle className="animate-spin" size={16} /> جارٍ المطابقة…</p> : word.aiExactMatch ? <p className="word-inspector-match" dir="auto">{word.aiExactMatch}</p> : <p className="word-inspector-muted">{word.aiError ? 'تعذر تحميل المطابقة.' : 'لا توجد مطابقة مؤكدة.'}</p>}
        {expanded && word.aiContextualMeaning && <p dir="auto">{word.aiContextualMeaning}</p>}
        {expanded && word.aiExplanation && <p className="word-inspector-muted">{word.aiExplanation}</p>}
      </section>}
      {expanded && word.details && <section><h4>تفاصيل لغوية</h4><p dir="auto">{word.details}</p></section>}
      {expanded && Boolean(word.examples?.length) && <section><h4>من سياق القراءة</h4>{word.examples?.map((example, i) => <div className="word-inspector-example" key={i}><p dir="rtl">{example.arabic}</p><p dir="ltr">{example.english}</p></div>)}</section>}
    </div>
  );

  if (expanded) return (
    <aside className="word-inspector-panel" aria-label="تفاصيل الكلمة" dir="rtl" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <header><div><span className="word-inspector-muted">المعجم والمفردات</span><h3 dir="auto">{word.word}</h3></div>{actions}</header>
      <div className="word-inspector-tabs" role="tablist" aria-label="عرض اللوحة">
        <Button variant="ghost" role="tab" aria-selected={tab === 'dictionary'} aria-controls="inspector-dictionary" id="dictionary-tab" onClick={() => setTab('dictionary')}><BookOpen />المعجم</Button>
        <Button variant="ghost" role="tab" aria-selected={tab === 'vocabulary'} aria-controls="inspector-vocabulary" id="vocabulary-tab" onClick={() => setTab('vocabulary')}><Bookmark />المفردات <span>{savedWords.length}</span></Button>
      </div>
      <div role="tabpanel" id={`inspector-${tab}`} aria-labelledby={`${tab}-tab`} className="word-inspector-scroll">
        {tab === 'dictionary' ? dictionary : <div className="word-inspector-vocabulary">{savedWords.length ? [...savedWords].sort((a, b) => b.savedAt - a.savedAt).map(entry => <div className="word-inspector-entry" key={entry.id}><div><strong dir="auto">{entry.word}</strong><p dir="auto">{entry.meanings.join('، ')}</p></div><Button variant="ghost" size="icon" aria-label={`إزالة ${entry.word} من المفردات`} title="إزالة من المفردات" onClick={() => onSave(entry)}><X /></Button></div>) : <p className="word-inspector-muted">لا توجد مفردات محفوظة.</p>}</div>}
      </div>
    </aside>
  );

  return (
    <Popover open modal={false} onOpenChange={(open) => { if (!open) onClose(); }}>
      <PopoverAnchor virtualRef={{ current: { getBoundingClientRect: () => anchor?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0) } }} />
      <PopoverContent dir="rtl" side="bottom" sideOffset={8} collisionPadding={12} className="word-inspector-quick" aria-label="معنى الكلمة" onOpenAutoFocus={e => e.preventDefault()} onInteractOutside={e => { if (e.target instanceof Element && e.target.closest('.word-link')) e.preventDefault(); }}>
        <header><h3 dir="auto">{word.word}</h3>{actions}</header>
        {dictionary}
      </PopoverContent>
    </Popover>
  );
}