// @ts-nocheck
import React, { useState, useEffect, useRef, useMemo } from 'react';
import logoAsset from '@/assets/app-logo.jpg.asset.json';
import { TechStatusBar, TechCommandPalette } from './TechChrome';
const customAppLogo = logoAsset.url;
import { 
  Book, 
  TextBatch,
  AlignedUnit, 
  SavedWord,
  getAllBooks, 
  saveBook, 
  deleteBook, 
  getAllSavedWords,
  saveWordEntry,
  deleteWordEntry,
  getBookBatchesSorted,
  getBookAllRowsSorted,
  initDB,
  exportCompleteBackup,
  importCompleteBackup,
  getWorkspaceDraft,
  saveWorkspaceDraft,
  clearWorkspaceDraft
} from './indexedDB';

const DEFAULT_BOOKS: Book[] = [];

interface SelectedWordData {
  word: string;
  normalized?: string;
  meanings: string[];
  examples?: { arabic: string; english: string }[];
  root?: string;
  details?: string;
  direction: 'ar-en' | 'en-ar';
  loading: boolean;
  aiLoading?: boolean;
  aiExactMatch?: string;
  aiContextualMeaning?: string;
  aiExplanation?: string;
  confidenceScore?: number;
  confidenceLabel?: string;
  aiError?: boolean;
  isPhrasalVerb?: boolean;
  aiSource?: 'gemini' | 'local_engine' | 'lexicon';
  aiConnected?: boolean;
  aiStatusMessage?: string;
  apiKeyNotice?: string;
}

type TabType = 'workspace' | 'library' | 'notebook';
type ReaderLayoutMode = 'dual' | 'interleaved' | 'focus';
type ReadingTheme = 'obsidian' | 'parchment' | 'emerald' | 'matrix';

// Count exact occurrences of a delimiter in text
function countDelimiterOccurrences(text: string, delimiter: string): number {
  if (!text || !delimiter || !delimiter.trim()) return 0;
  const escaped = delimiter.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = text.match(new RegExp(escaped, 'g'));
  return matches ? matches.length : 0;
}

// Delimiter Splitter that strictly respects the custom delimiter and never splits on periods or standard punctuation
function splitByDelimiter(text: string, delimiter: string): string[] {
  if (!text || !text.trim() || !delimiter || !delimiter.trim()) return [];
  const escaped = delimiter.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(escaped, 'g'));
  
  // Clean each chunk
  const chunks = parts.map(p => p.trim());
  
  // Handle edge delimiters gracefully without producing phantom empty items
  while (chunks.length > 1 && chunks[chunks.length - 1] === '') {
    chunks.pop();
  }
  while (chunks.length > 1 && chunks[0] === '') {
    chunks.shift();
  }
  
  return chunks.filter(c => c.length > 0);
}

// Smart Sentence Segmenter that protects abbreviations, decimals, and ellipses
function smartSplitSentences(text: string, _lang: 'ar' | 'en'): string[] {
  if (!text || !text.trim()) return [];

  // Protect common patterns by replacing periods temporarily with a placeholder
  let normalized = text;

  // 1. Protect ellipses (...)
  normalized = normalized.replace(/\.{2,}/g, (match) => `__ELLIPSIS_${match.length}__`);

  // 2. Protect numbers with decimals (e.g. 3.14, 10.5, 0.5)
  normalized = normalized.replace(/(\d+)\.(\d+)/g, '$1__DECIMAL_DOT__$2');

  // 3. Protect common English abbreviations
  const enAbbrs = [
    'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'St', 'No', 'Vol', 'vs', 
    'etc', 'eg', 'ie', 'al', 'Inc', 'Ltd', 'Co', 'Dept', 'Univ'
  ];
  enAbbrs.forEach(abbr => {
    const regex = new RegExp(`\\b${abbr}\\.`, 'gi');
    normalized = normalized.replace(regex, `${abbr}__ABBR_DOT__`);
  });

  // 4. Protect common Arabic abbreviations
  const arAbbrs = ['ص', 'د', 'أ', 'م', 'إلخ', 'هـ', 'مـ'];
  arAbbrs.forEach(abbr => {
    const regex = new RegExp(`(^|\\s)${abbr}\\.`, 'g');
    normalized = normalized.replace(regex, `$1${abbr}__ABBR_DOT__`);
  });

  // Split on genuine sentence boundaries:
  // - Periods, exclamation marks, Arabic and English question marks, or paragraph newlines
  const rawSegments = normalized
    .split(/(?:[\n\r]+|(?<=[.!?؟])\s+(?=[«"'"(A-Z\u0621-\u064A0-9]))/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // Restore protected placeholders
  return rawSegments.map(seg => {
    return seg
      .replace(/__ELLIPSIS_(\d+)__/g, (_, count) => '.'.repeat(parseInt(count, 10)))
      .replace(/__DECIMAL_DOT__/g, '.')
      .replace(/__ABBR_DOT__/g, '.');
  }).filter(s => s.trim().length > 0);
}

// Unified Parallel Text Segmentation Router
function segmentParallelText(text: string, lang: 'ar' | 'en', delimiter: string): string[] {
  if (!text || !text.trim()) return [];
  if (delimiter && delimiter.trim()) {
    // Delimiter Mode: NEVER split on periods or commas, ONLY split on custom delimiter
    return splitByDelimiter(text, delimiter.trim());
  }
  // Smart Sentence Mode
  return smartSplitSentences(text, lang);
}


export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const saved = localStorage.getItem('pr_activeTab') as TabType;
    return (saved && ['workspace', 'library', 'notebook'].includes(saved)) ? saved : 'workspace';
  });
  const [isReading, setIsReading] = useState<boolean>(() => {
    return localStorage.getItem('pr_isReading') === 'true';
  });
  const [books, setBooks] = useState<Book[]>([]);
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<ReaderLayoutMode>(() => {
    return (localStorage.getItem('pr_layoutMode') as ReaderLayoutMode) || 'interleaved';
  });
  const [theme, setTheme] = useState<ReadingTheme>(() => {
    return (localStorage.getItem('pr_theme') as ReadingTheme) || 'obsidian';
  });
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('pr_fontSize');
    return saved ? parseInt(saved, 10) : 21;
  });
  const [activeReaderDrawer, setActiveReaderDrawer] = useState<'none' | 'typography' | 'toc' | 'layout'>('none');
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  // Library filters
  const [searchFilter, setSearchFilter] = useState('');

  // Reader in-book search
  const [bookSearchQuery, setBookSearchQuery] = useState('');

  // Selected word & floating lexicon card
  const [selectedWord, setSelectedWord] = useState<SelectedWordData | null>(null);
  const [savedWords, setSavedWords] = useState<SavedWord[]>([]);

  // Standalone Lexicon Search Tab
  const [lexiconQuery, setLexiconQuery] = useState('');
  const [lexiconDirection, setLexiconDirection] = useState<'ar-en' | 'en-ar'>('ar-en');
  const [lexiconResult, setLexiconResult] = useState<{ word: string; meanings: string[] } | null>(null);
  const [lexiconLoading, setLexiconLoading] = useState(false);

  // Text Workspace & Aligner Form with Draft Persistence
  const [initialDraft] = useState(() => getWorkspaceDraft());
  const [workspaceMode, setWorkspaceMode] = useState<'new_book' | 'append_batch'>(initialDraft?.mode || 'new_book');
  const [selectedTargetBookId, setSelectedTargetBookId] = useState<string>(initialDraft?.targetBookId || '');
  const [newBatchTitle, setNewBatchTitle] = useState<string>(initialDraft?.batchTitle || '');
  const [newTitle, setNewTitle] = useState<string>(initialDraft?.title || '');
  const [newAuthor, setNewAuthor] = useState<string>(initialDraft?.author || '');
  const [newArabicText, setNewArabicText] = useState<string>(initialDraft?.arabicText || '');
  const [newEnglishText, setNewEnglishText] = useState<string>(initialDraft?.englishText || '');
  const [customDelimiter, setCustomDelimiter] = useState<string>(initialDraft?.customDelimiter || '');
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(initialDraft?.lastSavedAt || null);
  const [focusLanguage, setFocusLanguage] = useState<'ar' | 'en'>(() => {
    return (localStorage.getItem('pr_focusLanguage') as 'ar' | 'en') || 'ar';
  });
  const [showWordUnderline, setShowWordUnderline] = useState<boolean>(() => {
    const saved = localStorage.getItem('pr_showWordUnderline');
    return saved !== null ? saved === 'true' : true;
  });
  const [isAligning, setIsAligning] = useState(false);

  // Book Editing Modal State
  const [showEditBookModal, setShowEditBookModal] = useState<boolean>(false);
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editAuthor, setEditAuthor] = useState<string>('');
  const [editCategory, setEditCategory] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editCoverColor, setEditCoverColor] = useState<string>('');
  const [editCoverImage, setEditCoverImage] = useState<string>('');

  // Book Batches Modal State
  const [showBatchesModal, setShowBatchesModal] = useState<boolean>(false);
  const [selectedBookForBatches, setSelectedBookForBatches] = useState<Book | null>(null);
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [editBatchTitleInput, setEditBatchTitleInput] = useState<string>('');

  // Reader Active Batch Filter
  const [activeBatchId, setActiveBatchId] = useState<string>(() => {
    return localStorage.getItem('pr_active_batch_id') || 'all';
  });

  // Flashcards & Spaced Repetition Review State
  const [vocabSearch, setVocabSearch] = useState('');
  const [vocabFilter, setVocabFilter] = useState<'all' | 'due' | 'learning' | 'mastered'>('all');
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewMode, setReviewMode] = useState<'flashcard' | 'quiz' | 'recall' | 'matching'>('flashcard');
  const [reviewQueue, setReviewQueue] = useState<SavedWord[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewStats, setReviewStats] = useState({
    again: 0,
    hard: 0,
    good: 0,
    total: 0,
    completed: false
  });

  // Matching Game State
  const [matchingCards, setMatchingCards] = useState<{ id: string; wordId: string; text: string; type: 'term' | 'meaning' }[]>([]);
  const [selectedMatching, setSelectedMatching] = useState<string[]>([]);
  const [matchedCardIds, setMatchedCardIds] = useState<string[]>([]);
  const [matchingErrorIds, setMatchingErrorIds] = useState<string[]>([]);

  // Quiz & Audio Mode State
  const [quizOptions, setQuizOptions] = useState<string[]>([]);
  const [quizSelected, setQuizSelected] = useState<string | null>(null);
  const [quizRevealed, setQuizRevealed] = useState(false);

  // Recall / Spelling Mode State
  const [recallInput, setRecallInput] = useState('');
  const [recallChecked, setRecallChecked] = useState(false);
  const [recallIsCorrect, setRecallIsCorrect] = useState(false);
  const [recallShowHint, setRecallShowHint] = useState(false);

  // Manual Add Word Modal State
  const [showAddWordModal, setShowAddWordModal] = useState(false);
  const [addWordTerm, setAddWordTerm] = useState('');
  const [addWordMeanings, setAddWordMeanings] = useState('');
  const [addWordNotes, setAddWordNotes] = useState('');
  const [addWordDirection, setAddWordDirection] = useState<'ar-en' | 'en-ar'>('ar-en');

  // Edit Word & Notes Modal State
  const [showEditWordModal, setShowEditWordModal] = useState(false);
  const [editingWord, setEditingWord] = useState<SavedWord | null>(null);
  const [editWordMeanings, setEditWordMeanings] = useState('');
  const [editWordNotes, setEditWordNotes] = useState('');

  // Sync scroll states
  const [syncScroll, setSyncScroll] = useState<boolean>(() => {
    return localStorage.getItem('pr_syncScroll') !== 'false';
  });
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Fullscreen, Paper Settings & Typography
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenControlsVisible, setFullscreenControlsVisible] = useState(true);
  const fullscreenControlsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [arabicFont, setArabicFont] = useState<'Amiri' | 'IBM Plex Sans Arabic' | 'Scheherazade New'>(() => {
    return (localStorage.getItem('pr_arabicFont') as any) || 'Amiri';
  });
  const [englishFont, setEnglishFont] = useState<'Lora' | 'Plus Jakarta Sans'>(() => {
    return (localStorage.getItem('pr_englishFont') as any) || 'Lora';
  });
  const [lineHeight, setLineHeight] = useState<number>(() => {
    const saved = localStorage.getItem('pr_lineHeight');
    return saved ? parseFloat(saved) : 2.2;
  });

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
      setFullscreenControlsVisible(false);
      showToast('وضع ملء الشاشة الفائق: انقر على الشاشة لإظهار الأشرطة ✦');
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
      setFullscreenControlsVisible(true);
      if (fullscreenControlsTimerRef.current) clearTimeout(fullscreenControlsTimerRef.current);
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreen(isFs);
      if (isFs) {
        setFullscreenControlsVisible(false);
      } else {
        setFullscreenControlsVisible(true);
        if (fullscreenControlsTimerRef.current) clearTimeout(fullscreenControlsTimerRef.current);
      }
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      if (fullscreenControlsTimerRef.current) clearTimeout(fullscreenControlsTimerRef.current);
    };
  }, []);

  // Intentional click on reader canvas to toggle toolbars in fullscreen mode
  const handleReaderCanvasClick = (e: React.MouseEvent) => {
    if (!isFullscreen) return;

    const target = e.target as HTMLElement;
    if (
      target.closest('.word-link') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('.modal-overlay') ||
      target.closest('.smart-lexicon-floating') ||
      target.closest('.smart-lexicon-backdrop') ||
      target.closest('.paper-controls')
    ) {
      return;
    }

    setFullscreenControlsVisible(prev => {
      const next = !prev;
      if (fullscreenControlsTimerRef.current) clearTimeout(fullscreenControlsTimerRef.current);
      if (next) {
        fullscreenControlsTimerRef.current = setTimeout(() => {
          setFullscreenControlsVisible(false);
        }, 6000);
      }
      return next;
    });
  };

  const arPaneRef = useRef<HTMLDivElement>(null);
  const enPaneRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef<boolean>(false);

  // Synchronized scroll handlers (bidirectional & smooth)
  const handleArScroll = () => {
    if (!syncScroll || !arPaneRef.current || !enPaneRef.current) return;
    if (isScrollingRef.current) return;
    isScrollingRef.current = true;

    const ar = arPaneRef.current;
    const en = enPaneRef.current;
    const maxAr = ar.scrollHeight - ar.clientHeight;
    if (maxAr > 0) {
      const ratio = ar.scrollTop / maxAr;
      en.scrollTop = ratio * (en.scrollHeight - en.clientHeight);
    }

    requestAnimationFrame(() => {
      isScrollingRef.current = false;
    });
  };

  const handleEnScroll = () => {
    if (!syncScroll || !arPaneRef.current || !enPaneRef.current) return;
    if (isScrollingRef.current) return;
    isScrollingRef.current = true;

    const ar = arPaneRef.current;
    const en = enPaneRef.current;
    const maxEn = en.scrollHeight - en.clientHeight;
    if (maxEn > 0) {
      const ratio = en.scrollTop / maxEn;
      ar.scrollTop = ratio * (ar.scrollHeight - ar.clientHeight);
    }

    requestAnimationFrame(() => {
      isScrollingRef.current = false;
    });
  };

  const lastSavedRowIdRef = useRef<string | null>(null);
  const scrollSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Dynamic Scroll Observer: Tracking reading position silently & saving progress during natural continuous scrolling
  const handleContainerScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!currentBook) return;

    const target = e.currentTarget;
    const sentenceEls = target.querySelectorAll<HTMLElement>('[id^="sentence-"]');
    if (!sentenceEls || sentenceEls.length === 0) return;

    const containerRect = target.getBoundingClientRect();
    // Focal area: ~25%-30% down from container top (where user's eyes read naturally)
    const focalY = containerRect.top + Math.min(180, containerRect.height * 0.3);

    let closestRowId: string | null = null;
    let minDistance = Infinity;

    sentenceEls.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > containerRect.top + 20 && rect.top < containerRect.bottom - 20) {
        const distance = Math.abs(rect.top - focalY);
        if (distance < minDistance) {
          minDistance = distance;
          const id = el.id.replace('sentence-', '');
          closestRowId = id;
        }
      }
    });

    // Save reading position silently to storage without changing activeRowId visually while scrolling
    if (closestRowId && closestRowId !== lastSavedRowIdRef.current) {
      const rowToSave = closestRowId;
      if (scrollSaveTimeoutRef.current) clearTimeout(scrollSaveTimeoutRef.current);
      scrollSaveTimeoutRef.current = setTimeout(() => {
        if (currentBook && lastSavedRowIdRef.current !== rowToSave) {
          lastSavedRowIdRef.current = rowToSave;
          localStorage.setItem('pr_last_book_id', currentBook.id);
          localStorage.setItem(`pr_last_row_${currentBook.id}`, rowToSave);

          const updatedBook: Book = {
            ...currentBook,
            lastReadAt: Date.now(),
            lastReadRowId: rowToSave
          };
          setCurrentBook(updatedBook);
          setBooks(prev => prev.map(b => b.id === updatedBook.id ? updatedBook : b));
          saveBook(updatedBook).catch(() => {});
        }
      }, 300);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleCopyMeanings = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // E-Reader Copy/Share active sentence
  const handleShareOrCopy = () => {
    if (!currentBook) return;
    const targetRow = currentBook.alignedRows.find(r => r.id === activeRowId) || currentBook.alignedRows[0];
    if (!targetRow) return;

    const textToCopy = `${targetRow.arabic}\n\n${targetRow.english}\n\n[${currentBook.title}]`;
    navigator.clipboard.writeText(textToCopy);
    showToast('تم نسخ الفقرة وترجمتها للحافظة');
  };

  // Auto-save reading position and update active row
  const updateActiveRowAndSaveProgress = (rowId: string, smoothScroll = true) => {
    setActiveRowId(rowId);
    setActiveReaderDrawer('none');

    if (currentBook) {
      localStorage.setItem('pr_last_book_id', currentBook.id);
      localStorage.setItem(`pr_last_row_${currentBook.id}`, rowId);

      const updatedBook: Book = {
        ...currentBook,
        lastReadAt: Date.now(),
        lastReadRowId: rowId
      };
      setCurrentBook(updatedBook);
      setBooks(prev => prev.map(b => b.id === updatedBook.id ? updatedBook : b));
      saveBook(updatedBook).catch(() => {});
    }

    if (smoothScroll) {
      const el = document.getElementById(`sentence-${rowId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  // Central book reader opener with automatic resume to last read position
  const openBookForReading = (book: Book, targetRowId?: string, batchId?: string) => {
    setCurrentBook(book);
    if (batchId) {
      setActiveBatchId(batchId);
    } else {
      setActiveBatchId('all');
    }

    const allRows = getBookAllRowsSorted(book);
    const savedRowId = targetRowId || book.lastReadRowId || localStorage.getItem(`pr_last_row_${book.id}`);
    const validRow = allRows.find(r => r.id === savedRowId);
    const rowToActivate = validRow ? validRow.id : (allRows[0]?.id || null);

    setActiveRowId(rowToActivate);
    setIsReading(true);

    if (validRow && allRows.length > 1) {
      const rowIdx = allRows.findIndex(r => r.id === validRow.id) + 1;
      showToast(`تم استئناف القراءة من آخر نقطة (الفقرة ${rowIdx} من ${allRows.length}) ✦`);
    }
  };

  // E-Reader Jump to sentence
  const handleJumpToSentence = (rowId: string) => {
    updateActiveRowAndSaveProgress(rowId, true);
  };

  // Delete a book locally
  const handleDeleteBook = async (bookId: string) => {
    try {
      await deleteBook(bookId);
      setBooks(prev => {
        const remaining = prev.filter(b => b.id !== bookId);
        if (currentBook?.id === bookId) {
          setCurrentBook(remaining.length > 0 ? remaining[0] : null);
        }
        return remaining;
      });
      showToast('تم حذف الكتاب من ذاكرة الهاتف المحلية');
    } catch (err) {
      console.error('Error deleting book:', err);
    }
  };

  // Edit Book metadata
  const handleOpenEditBookModal = (book: Book) => {
    setEditingBook(book);
    setEditTitle(book.title || '');
    setEditAuthor(book.author || '');
    setEditCategory(book.category || 'أدب مترجم');
    setEditNotes(book.notes || '');
    setEditCoverColor(book.coverColor || 'from-amber-950/40 to-slate-900/80');
    setEditCoverImage(book.coverImage || '');
    setShowEditBookModal(true);
  };

  const handleCoverImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      showToast('حجم الصورة كبير جداً، يرجى اختيار صورة أقل من 8 ميجابايت');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result) {
        setEditCoverImage(reader.result.toString());
        showToast('تم رفع صورة الغلاف بجودة عالية ✨');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveBookEdits = async () => {
    if (!editingBook) return;
    if (!editTitle.trim()) {
      showToast('يرجى كتابة عنوان للكتاب');
      return;
    }
    const updatedBook: Book = {
      ...editingBook,
      title: editTitle.trim(),
      author: editAuthor.trim(),
      category: editCategory.trim(),
      notes: editNotes.trim(),
      coverColor: editCoverColor,
      coverImage: editCoverImage.trim()
    };
    await saveBook(updatedBook);
    setBooks(prev => prev.map(b => b.id === updatedBook.id ? updatedBook : b));
    if (currentBook?.id === updatedBook.id) {
      setCurrentBook(updatedBook);
    }
    if (selectedBookForBatches?.id === updatedBook.id) {
      setSelectedBookForBatches(updatedBook);
    }
    setShowEditBookModal(false);
    setEditingBook(null);
    showToast('تم حفظ تعديلات بيانات وغلاف الكتاب بنجاح ✨');
  };

  // Batches management handlers
  const handleOpenBatchesModal = (book: Book) => {
    setSelectedBookForBatches(book);
    setShowBatchesModal(true);
  };

  const handleDeleteBatch = async (bookId: string, batchId: string) => {
    const targetBook = books.find(b => b.id === bookId);
    if (!targetBook) return;

    const currentBatches = getBookBatchesSorted(targetBook);
    if (currentBatches.length <= 1) {
      showToast('لا يمكن حذف الدفعة الأخيرة، يمكنك حذف الكتاب كاملاً');
      return;
    }

    const updatedBatches = currentBatches.filter(b => b.id !== batchId);
    const updatedBook: Book = {
      ...targetBook,
      batches: updatedBatches,
      alignedRows: updatedBatches.flatMap(b => b.alignedRows)
    };

    await saveBook(updatedBook);
    setBooks(prev => prev.map(b => b.id === updatedBook.id ? updatedBook : b));
    if (currentBook?.id === updatedBook.id) {
      setCurrentBook(updatedBook);
    }
    if (selectedBookForBatches?.id === updatedBook.id) {
      setSelectedBookForBatches(updatedBook);
    }
    showToast('تم حذف دفعة النصوص');
  };

  const handleSaveBatchRename = async (bookId: string, batchId: string) => {
    if (!editBatchTitleInput.trim()) return;
    const targetBook = books.find(b => b.id === bookId);
    if (!targetBook) return;

    const currentBatches = getBookBatchesSorted(targetBook);
    const updatedBatches = currentBatches.map(b => b.id === batchId ? { ...b, title: editBatchTitleInput.trim() } : b);
    const updatedBook: Book = {
      ...targetBook,
      batches: updatedBatches
    };

    await saveBook(updatedBook);
    setBooks(prev => prev.map(b => b.id === updatedBook.id ? updatedBook : b));
    if (currentBook?.id === updatedBook.id) {
      setCurrentBook(updatedBook);
    }
    if (selectedBookForBatches?.id === updatedBook.id) {
      setSelectedBookForBatches(updatedBook);
    }
    setEditingBatchId(null);
    setEditBatchTitleInput('');
    showToast('تم تغيير عنوان الدفعة');
  };

  const handleOpenWorkspaceForBatchAppend = (book: Book) => {
    setWorkspaceMode('append_batch');
    setSelectedTargetBookId(book.id);
    setActiveTab('workspace');
    setShowBatchesModal(false);
    showToast(`جاهز لإضافة دفعة نصوص جديدة لكتاب "${book.title}"`);
  };

  // Auto-save workspace draft with debouncing to prevent loss of work during reloads
  useEffect(() => {
    const hasContent = 
      newArabicText.trim() || 
      newEnglishText.trim() || 
      newTitle.trim() || 
      newAuthor.trim() || 
      newBatchTitle.trim();

    if (!hasContent) {
      return;
    }

    const timer = setTimeout(() => {
      const now = Date.now();
      saveWorkspaceDraft({
        mode: workspaceMode,
        targetBookId: selectedTargetBookId,
        batchTitle: newBatchTitle,
        title: newTitle,
        author: newAuthor,
        arabicText: newArabicText,
        englishText: newEnglishText,
        customDelimiter: customDelimiter,
        lastSavedAt: now
      });
      setDraftSavedAt(now);
    }, 500);

    return () => clearTimeout(timer);
  }, [workspaceMode, selectedTargetBookId, newBatchTitle, newTitle, newAuthor, newArabicText, newEnglishText, customDelimiter]);

  const handleClearDraft = () => {
    clearWorkspaceDraft();
    setNewArabicText('');
    setNewEnglishText('');
    setNewTitle('');
    setNewAuthor('');
    setNewBatchTitle('');
    setCustomDelimiter('');
    setDraftSavedAt(null);
    showToast('تم تفريغ مسودة العمل بنجاح ✦');
  };

  // Load books & saved vocabulary from phone's local storage (IndexedDB)
  useEffect(() => {
    async function init() {
      try {
        await initDB();
        const storedBooks = await getAllBooks();
        
        // Purge old demo books if needed, or identify user books
        const demoPrefixes = ['book-the-mother', 'book-pride', 'book-poet', 'book-oldman'];
        const userBooks: Book[] = [];

        for (const book of storedBooks) {
          if (demoPrefixes.some(prefix => book.id.startsWith(prefix))) {
            await deleteBook(book.id);
          } else {
            userBooks.push(book);
          }
        }

        // Add a long demo book if the library is totally empty
        if (userBooks.length === 0) {
          const prophetDemo: Book = {
            id: 'book-prophet-long-demo',
            title: 'النبي (مقتطفات)',
            author: 'جبران خليل جبران',
            arabicText: '',
            englishText: '',
            createdAt: Date.now(),
            coverColor: '#5A189A',
            alignedRows: [
              {
                id: 'p1',
                arabic: 'المصطفى، المختار والحبيب، الذي كان فجراً لذاته، قد انتظر اثنتي عشرة سنة في مدينة أورفليس لعودة سفينته التي ستحمله ثانية إلى الجزيرة التي وُلد فيها.',
                english: 'Almustafa, the chosen and the beloved, who was a dawn unto his own day, had waited twelve years in the city of Orphalese for his ship that was to return and bear him back to the isle of his birth.'
              },
              {
                id: 'p2',
                arabic: 'وفي السنة الثانية عشرة، في اليوم السابع من شهر أيلول، شهر الحصاد، صعد إلى التل الذي يقع خارج أسوار المدينة، ونظر نحو البحر؛ فرأى سفينته تقترب مع الضباب.',
                english: 'And in the twelfth year, on the seventh day of Ielool, the month of reaping, he climbed the hill without the city walls and looked seaward; and he beheld his ship coming with the mist.'
              },
              {
                id: 'p3',
                arabic: 'حينئذ انفتح رتاج قلبه، وطار فرحه فوق البحر. وأغمض عينيه وصلى في صمت روحه.',
                english: 'Then the gates of his heart were flung open, and his joy flew far over the sea. And he closed his eyes and prayed in the silences of his soul.'
              },
              {
                id: 'p4',
                arabic: 'ولكنه بينما كان ينحدر من التل، اعتراه حزن، وفكر في قلبه: كيف أنصرف بسلام وبدون كآبة؟ لا، لست أستطيع أن أغادر هذه المدينة بدون جرح في الروح.',
                english: 'But as he descended the hill, a sadness came upon him, and he thought in his heart: How shall I go in peace and without sorrow? Nay, not without a wound in the spirit shall I leave this city.'
              },
              {
                id: 'p5',
                arabic: 'طويلة كانت أيام الألم التي قضيتها بين جدرانها، وطويلة كانت ليالي الوحدة؛ ومن ذا الذي يستطيع أن ينفصل عن ألمه ووحدته بدون أسف؟',
                english: 'Long were the days of pain I have spent within its walls, and long were the nights of aloneness; and who can depart from his pain and his aloneness without regret?'
              },
              {
                id: 'p6',
                arabic: 'لقد نثرت أجزاء كثيرة من روحي في هذه الشوارع، وأبناء شوقي كثر هم الذين يمشون عراة بين هذه التلال، ولا أستطيع أن أنسلخ عنهم بدون ثقل وكآبة.',
                english: 'Too many fragments of the spirit have I scattered in these streets, and too many are the children of my longing that walk naked among these hills, and I cannot withdraw from them without a burden and an ache.'
              },
              {
                id: 'p7',
                arabic: 'ليس ثوباً هذا الذي أخلعه اليوم، بل هو جلد أمزقه بيدي. وليس فكراً هذا الذي أتركه وراءي، بل هو قلب رققه الجوع والعطش.',
                english: 'It is not a garment I cast off this day, but a skin that I tear with my own hands. Nor is it a thought I leave behind me, but a heart made soft with hunger and with thirst.'
              },
              {
                id: 'p8',
                arabic: 'بيد أنني لا أستطيع أن أتمهل طويلاً. فالبحر الذي يدعو كل الأشياء إليه يدعوني أنا أيضاً، وعليّ أن أركب السفينة.',
                english: 'Yet I cannot tarry longer. The sea that calls all things unto her calls me, and I must embark.'
              },
              {
                id: 'p9',
                arabic: 'لأن البقاء، رغم أن الساعات تحترق في الليل، إنما هو تجميد وجمود، وحبس في قالب. أود لو أحمل معي كل ما هو هنا. ولكن كيف السبيل؟',
                english: 'For to stay, though the hours burn in the night, is to freeze and crystallize and be bound in a mould. Fain would I take with me all that is here. But how shall I?'
              },
              {
                id: 'p10',
                arabic: 'إن الصوت لا يستطيع أن يحمل اللسان والشفاه التي أعطته أجنحة. فبمفرده يجب أن يطلب الفضاء. وبمفرده وبدون عشه يطير العقاب عبر الشمس.',
                english: 'A voice cannot carry the tongue and the lips that gave it wings. Alone must it seek the ether. And alone and without his nest shall the eagle fly across the sun.'
              },
              {
                id: 'p11',
                arabic: 'والآن عندما وصل إلى سفح التل، نظر ثانية نحو البحر، فرأى سفينته تقترب من الميناء، وعلى مقدمتها البحارة، أبناء بلاده. فصرخت روحه إليهم وقال:',
                english: 'Now when he reached the foot of the hill, he turned again towards the sea, and he saw his ship approaching the harbour, and upon her prow the mariners, the men of his own land. And his soul cried out to them, and he said:'
              },
              {
                id: 'p12',
                arabic: 'يا أبناء أمي العتيقة، يا ركاب الأمواج، كم مرة أبحرتم في أحلامي. والآن ها أنتم تأتون في يقظتي، التي هي حلمي الأعمق.',
                english: 'Sons of my ancient mother, you riders of the tides, how often have you sailed in my dreams. And now you come in my awakening, which is my deeper dream.'
              },
              {
                id: 'p13',
                arabic: 'أنا مستعد للرحيل، وشراعي ينتظر الريح في لهفة. نفس واحد فقط سأتنفسه في هذا الهواء الهادئ، نظرة محبة واحدة سألقيها إلى الوراء، ثم أقف بينكم، بحاراً بين البحارة.',
                english: 'Ready am I to go, and my eagerness with sails full set awaits the wind. Only another breath will I breathe in this still air, only another loving look cast backward, And then I shall stand among you, a seafarer among seafarers.'
              },
              {
                id: 'p14',
                arabic: 'وأنت أيها البحر العظيم، الأم التي لا تنام، أنت التي وحدك السلام والحرية للنهر والجدول، جدول واحد فقط سيعرج هذا المنعطف، همسة واحدة فقط سيهمس بها في هذا المرج، ثم آتيك، قطرة غير محدودة إلى محيط غير محدود.',
                english: 'And you, vast sea, sleeping mother, Who alone are peace and freedom to the river and the stream, Only another winding will this stream make, only another murmur in this glade, And then I shall come to you, a boundless drop to a boundless ocean.'
              }
            ]
          };
          await saveBook(prophetDemo);
          userBooks.push(prophetDemo);
        }

        setBooks(userBooks);

        const lastBookId = localStorage.getItem('pr_last_book_id');
        const savedIsReading = localStorage.getItem('pr_isReading') === 'true';
        const savedActiveBatchId = localStorage.getItem('pr_active_batch_id') || 'all';

        let targetBook: Book | null = null;
        if (lastBookId && userBooks.some(b => b.id === lastBookId)) {
          targetBook = userBooks.find(b => b.id === lastBookId) || null;
        } else if (userBooks.length > 0) {
          targetBook = userBooks[0];
        }

        setCurrentBook(targetBook);
        setActiveBatchId(savedActiveBatchId);

        if (targetBook) {
          const savedRowId = targetBook.lastReadRowId || localStorage.getItem(`pr_last_row_${targetBook.id}`);
          const allRows = getBookAllRowsSorted(targetBook);
          const validRow = savedRowId ? allRows.find(r => r.id === savedRowId) : null;
          const rowToActivate = validRow ? validRow.id : (allRows[0]?.id || null);
          setActiveRowId(rowToActivate);

          if (savedIsReading) {
            setIsReading(true);
          }
        }

        const words = await getAllSavedWords();
        setSavedWords(words);
      } catch (err) {
        console.error('Failed to init DB:', err);
        setBooks([]);
        setCurrentBook(null);
      }
    }
    init();
  }, []);

  // Sync settings and view state with local storage for offline phone persistence
  useEffect(() => { localStorage.setItem('pr_activeTab', activeTab); }, [activeTab]);
  useEffect(() => { localStorage.setItem('pr_isReading', isReading ? 'true' : 'false'); }, [isReading]);
  useEffect(() => { localStorage.setItem('pr_active_batch_id', activeBatchId); }, [activeBatchId]);
  useEffect(() => { localStorage.setItem('pr_layoutMode', layoutMode); }, [layoutMode]);
  useEffect(() => {
    localStorage.setItem('pr_theme', theme);
    document.body.className = `theme-${theme}`;
  }, [theme]);
  useEffect(() => { localStorage.setItem('pr_fontSize', fontSize.toString()); }, [fontSize]);
  useEffect(() => { localStorage.setItem('pr_arabicFont', arabicFont); }, [arabicFont]);
  useEffect(() => { localStorage.setItem('pr_englishFont', englishFont); }, [englishFont]);
  useEffect(() => { localStorage.setItem('pr_lineHeight', lineHeight.toString()); }, [lineHeight]);
  useEffect(() => { localStorage.setItem('pr_syncScroll', syncScroll.toString()); }, [syncScroll]);
  useEffect(() => { localStorage.setItem('pr_focusLanguage', focusLanguage); }, [focusLanguage]);
  useEffect(() => { localStorage.setItem('pr_showWordUnderline', showWordUnderline.toString()); }, [showWordUnderline]);

  // Synchronous emergency persistence on window reload, tab switch, page hide, or sudden exit
  useEffect(() => {
    const handleFlushPersistence = () => {
      // 1. Immediately save workspace text draft
      const hasContent = 
        newArabicText.trim() || 
        newEnglishText.trim() || 
        newTitle.trim() || 
        newAuthor.trim() || 
        newBatchTitle.trim();

      if (hasContent) {
        saveWorkspaceDraft({
          mode: workspaceMode,
          targetBookId: selectedTargetBookId,
          batchTitle: newBatchTitle,
          title: newTitle,
          author: newAuthor,
          arabicText: newArabicText,
          englishText: newEnglishText,
          customDelimiter: customDelimiter,
          lastSavedAt: Date.now()
        });
      }

      // 2. Immediately save active book and reading row
      if (currentBook) {
        localStorage.setItem('pr_last_book_id', currentBook.id);
        if (activeRowId) {
          localStorage.setItem(`pr_last_row_${currentBook.id}`, activeRowId);
        }
      }

      // 3. Immediately save active view state
      localStorage.setItem('pr_activeTab', activeTab);
      localStorage.setItem('pr_isReading', isReading ? 'true' : 'false');
      localStorage.setItem('pr_active_batch_id', activeBatchId);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleFlushPersistence();
      }
    };

    window.addEventListener('beforeunload', handleFlushPersistence);
    window.addEventListener('pagehide', handleFlushPersistence);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleFlushPersistence);
      window.removeEventListener('pagehide', handleFlushPersistence);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    workspaceMode,
    selectedTargetBookId,
    newBatchTitle,
    newTitle,
    newAuthor,
    newArabicText,
    newEnglishText,
    customDelimiter,
    currentBook,
    activeRowId,
    activeTab,
    isReading,
    activeBatchId
  ]);

  // Auto-scroll to saved reading position upon entering or resuming reader
  useEffect(() => {
    if (isReading && activeRowId) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`sentence-${activeRowId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [isReading]);

  // Helper for English stemming
  const stemEnglishWord = (s: string): string => {
    let norm = s.toLowerCase().replace(/['’]s$/i, '').trim();
    if (norm.endsWith('ing') && norm.length > 5) norm = norm.slice(0, -3);
    else if (norm.endsWith('ied') && norm.length > 4) norm = norm.slice(0, -3) + 'y';
    else if (norm.endsWith('ed') && norm.length > 4) norm = norm.slice(0, -2);
    else if (norm.endsWith('es') && norm.length > 4) norm = norm.slice(0, -2);
    else if (norm.endsWith('s') && norm.length > 3) norm = norm.slice(0, -1);
    else if (norm.endsWith('ly') && norm.length > 4) norm = norm.slice(0, -2);
    return norm;
  };

  // Local word-to-target sentence matcher engine
  const findTargetMatchInSentence = (
    meanings: string[],
    rootLemma: string | undefined,
    targetSentence: string,
    direction: 'ar-en' | 'en-ar'
  ): string | undefined => {
    if (!targetSentence || !targetSentence.trim()) return undefined;

    const rawTokens = targetSentence.split(/[\s،.؛:!؟«»""''`()\[\]{}\-_—–]+/);
    const cleanedTokens = rawTokens
      .map(t => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim())
      .filter(t => t.length > 0);

    if (cleanedTokens.length === 0) return undefined;

    const searchTerms: string[] = [];
    if (rootLemma && rootLemma.trim()) searchTerms.push(rootLemma.trim());

    meanings.forEach(m => {
      const parts = m.split(/[,/;\-\(\)]/);
      parts.forEach(p => {
        const cleanP = p.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if (cleanP && cleanP.length >= 2) searchTerms.push(cleanP);
      });
    });

    if (searchTerms.length === 0) return undefined;

    if (direction === 'ar-en') {
      for (const token of cleanedTokens) {
        const lowerToken = token.toLowerCase();
        for (const term of searchTerms) {
          const lowerTerm = term.toLowerCase();
          if (
            wordsMatchPattern(lowerToken, lowerTerm) ||
            (lowerToken.length >= 3 && lowerTerm.length >= 3 && (lowerTerm.includes(lowerToken) || lowerToken.includes(lowerTerm)))
          ) {
            return token;
          }
        }
      }
    } else {
      for (const token of cleanedTokens) {
        for (const term of searchTerms) {
          if (wordsMatchPattern(token, term)) {
            return token;
          }
        }
      }
    }

    return undefined;
  };

  // Word Click Handler with AI Context Translation & Lexicon Integration
  const handleWordClick = async (
    rawWord: string, 
    direction: 'ar-en' | 'en-ar',
    rowContext?: AlignedUnit
  ) => {
    if (rowContext) {
      updateActiveRowAndSaveProgress(rowContext.id, false);
    }

    const cleanWord = rawWord
      .replace(/^[\s\p{P}«»“”()\[\]{}،.:؛!؟-]+/gu, '')
      .replace(/[\s\p{P}«»“”()\[\]{}،.:؛!؟-]+$/gu, '')
      .trim();
    if (!cleanWord) return;

    // Extract surrounding sentences (target sentence + 2 surrounding sentences)
    let sourceContext: { prev?: string; current: string; next?: string } | undefined;
    let targetContext: { prev?: string; current: string; next?: string } | undefined;

    if (rowContext && currentBook) {
      const allRows = getBookAllRowsSorted(currentBook);
      const rowIndex = allRows.findIndex(r => r.id === rowContext.id);
      const prevRow = rowIndex > 0 ? allRows[rowIndex - 1] : undefined;
      const nextRow = rowIndex >= 0 && rowIndex < allRows.length - 1 
        ? allRows[rowIndex + 1] 
        : undefined;

      if (direction === 'ar-en') {
        sourceContext = {
          prev: prevRow?.arabic,
          current: rowContext.arabic,
          next: nextRow?.arabic
        };
        targetContext = {
          prev: prevRow?.english,
          current: rowContext.english,
          next: nextRow?.english
        };
      } else {
        sourceContext = {
          prev: prevRow?.english,
          current: rowContext.english,
          next: nextRow?.english
        };
        targetContext = {
          prev: prevRow?.arabic,
          current: rowContext.arabic,
          next: nextRow?.arabic
        };
      }
    }

    const hasContext = !!sourceContext?.current && !!targetContext?.current;

    setSelectedWord({
      word: cleanWord,
      meanings: [],
      direction,
      loading: true,
      aiLoading: hasContext,
      aiExactMatch: undefined,
      aiContextualMeaning: undefined,
      aiExplanation: undefined,
      aiError: false
    });

    // 1. Fetch Lexical Dictionary (Wiktionary + Phrasal Verb Recognition Engine)
    const fetchLexicon = async () => {
      try {
        let activeQuery = cleanWord;
        let isDetectedPhrasalVerb = false;

        // Multi-word Phrasal Verb Scanner for English reading mode
        if (direction === 'en-ar' && sourceContext?.current) {
          const sentence = sourceContext.current;
          const tokens = sentence.split(/[\s،.؛:!؟«»""''`()\[\]{}\-_—–]+/u).filter(Boolean);
          const cleanTokens = tokens.map(t => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim());
          const wordIdx = cleanTokens.findIndex(t => t.toLowerCase() === cleanWord.toLowerCase());

          if (wordIdx >= 0) {
            const candidatePhrases: string[] = [];
            // 3-word n-gram candidate phrases
            if (wordIdx <= cleanTokens.length - 3) candidatePhrases.push(`${cleanTokens[wordIdx]} ${cleanTokens[wordIdx+1]} ${cleanTokens[wordIdx+2]}`);
            if (wordIdx >= 1 && wordIdx <= cleanTokens.length - 2) candidatePhrases.push(`${cleanTokens[wordIdx-1]} ${cleanTokens[wordIdx]} ${cleanTokens[wordIdx+1]}`);
            if (wordIdx >= 2) candidatePhrases.push(`${cleanTokens[wordIdx-2]} ${cleanTokens[wordIdx-1]} ${cleanTokens[wordIdx]}`);
            // 2-word n-gram candidate phrases
            if (wordIdx <= cleanTokens.length - 2) candidatePhrases.push(`${cleanTokens[wordIdx]} ${cleanTokens[wordIdx+1]}`);
            if (wordIdx >= 1) candidatePhrases.push(`${cleanTokens[wordIdx-1]} ${cleanTokens[wordIdx]}`);

            for (const phrase of candidatePhrases) {
              try {
                const pvRes = await fetch(`/api/lexicon/en-ar?word=${encodeURIComponent(phrase)}`);
                const pvData = await pvRes.json();
                if (pvData && pvData.meanings && pvData.meanings.length > 0) {
                  activeQuery = phrase;
                  isDetectedPhrasalVerb = true;
                  break;
                }
              } catch (_) {}
            }
          }
        }

        const endpoint = direction === 'ar-en' ? '/api/lexicon/ar-en' : '/api/lexicon/en-ar';
        const res = await fetch(`${endpoint}?word=${encodeURIComponent(activeQuery)}`);
        const data = await res.json();

        // Extract real example sentences for this word from local book aligned units or server dictionary data
        const extractedExamples: { arabic: string; english: string }[] = [];
        if (data.examples && Array.isArray(data.examples)) {
          extractedExamples.push(...data.examples);
        }

        if (currentBookAllRows.length > 0 && extractedExamples.length < 3) {
          for (const row of currentBookAllRows) {
            if (!row.arabic || !row.english) continue;
            const matchesWord = wordsMatchPattern(row.arabic, activeQuery) || 
              (data.root && wordsMatchPattern(row.arabic, data.root)) ||
              (direction === 'en-ar' && wordsMatchPattern(row.english, activeQuery));
            
            if (matchesWord && !extractedExamples.some(ex => ex.arabic === row.arabic)) {
              extractedExamples.push({ arabic: row.arabic, english: row.english });
              if (extractedExamples.length >= 3) break;
            }
          }
        }

        const localTargetMatch = findTargetMatchInSentence(
          data.meanings || [],
          data.root,
          targetContext?.current || '',
          direction
        );

        setSelectedWord(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            word: activeQuery,
            normalized: data.normalized || activeQuery,
            meanings: data.meanings || [],
            examples: extractedExamples.slice(0, 3),
            root: data.root,
            details: data.details,
            isPhrasalVerb: isDetectedPhrasalVerb,
            aiExactMatch: prev.aiExactMatch || localTargetMatch,
            loading: false
          };
        });
      } catch (err) {
        console.error('Word lookup failed:', err);
        setSelectedWord(prev => {
          if (!prev || prev.word !== cleanWord) return prev;
          return {
            ...prev,
            meanings: [],
            examples: [],
            loading: false
          };
        });
      }
    };

    // 2. Fetch AI Contextual Translation automatically
    const fetchAiTranslation = async () => {
      if (!hasContext) return;
      try {
        const res = await fetch('/api/ai/context-translation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            word: cleanWord,
            direction,
            sourceContext,
            targetContext
          })
        });
        const data = await res.json();
        if (data.status === 'success') {
          setSelectedWord(prev => {
            if (!prev || prev.word !== cleanWord) return prev;
            return {
              ...prev,
              aiLoading: false,
              aiExactMatch: data.exactMatchedWord,
              aiContextualMeaning: data.contextualMeaning,
              aiExplanation: data.explanation,
              confidenceScore: data.confidenceScore,
              confidenceLabel: data.confidenceLabel,
              aiSource: data.source,
              aiConnected: true,
              aiStatusMessage: data.aiStatusMessage,
              apiKeyNotice: data.apiKeyNotice,
              aiError: false
            };
          });
        } else {
          setSelectedWord(prev => {
            if (!prev || prev.word !== cleanWord) return prev;
            return {
              ...prev,
              aiLoading: false,
              aiError: false,
              aiConnected: true,
              aiStatusMessage: ''
            };
          });
        }
      } catch (err) {
        console.error('AI contextual lookup failed:', err);
        setSelectedWord(prev => {
          if (!prev || prev.word !== cleanWord) return prev;
          return {
            ...prev,
            aiLoading: false,
            aiError: true,
            aiConnected: false,
            aiStatusMessage: 'تعذر الاتصال بالخادم.'
          };
        });
      }
    };

    fetchLexicon();
    fetchAiTranslation();
  };

  // Toggle Save Word to Vocabulary
  const handleToggleSaveWord = async (wordData: { word: string; meanings: string[]; direction: 'ar-en' | 'en-ar' }) => {
    const existing = savedWords.find(w => w.word.toLowerCase() === wordData.word.toLowerCase());
    if (existing) {
      await deleteWordEntry(existing.id);
      setSavedWords(prev => prev.filter(w => w.id !== existing.id));
      showToast('تمت إزالة الكلمة من المفردات');
    } else {
      const newEntry: SavedWord = {
        id: `word-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        word: wordData.word,
        meanings: wordData.meanings,
        direction: wordData.direction,
        bookTitle: currentBook?.title,
        savedAt: Date.now(),
        mastered: false,
        level: 0,
        streak: 0,
        reviewCount: 0,
        intervalDays: 1,
        nextReviewAt: Date.now()
      };
      await saveWordEntry(newEntry);
      setSavedWords(prev => [newEntry, ...prev]);
      showToast('تم حفظ الكلمة في قائمة المفردات والمراجعة');
    }
  };

  const isWordSaved = (w: string) => {
    return savedWords.some(item => item.word.toLowerCase() === w.toLowerCase());
  };

  // Toggle Mastered Status manually
  const handleToggleMastered = async (wordId: string) => {
    const word = savedWords.find(w => w.id === wordId);
    if (!word) return;
    const isNowMastered = !word.mastered;
    const updated: SavedWord = {
      ...word,
      mastered: isNowMastered,
      level: isNowMastered ? 3 : 1
    };
    await saveWordEntry(updated);
    setSavedWords(prev => prev.map(w => w.id === wordId ? updated : w));
    showToast(isNowMastered ? 'تم تمييز المفردة كمتقنة ⭐' : 'تم إعادة المفردة لقيد المراجعة');
  };

  // Review & Spaced Repetition Calculations
  // Real-time sentence and delimiter counts for workspace textboxes
  const isDelimiterMode = Boolean(customDelimiter && customDelimiter.trim());
  const activeDelim = isDelimiterMode ? customDelimiter.trim() : '';

  const arDelimiterCount = useMemo(() => {
    return isDelimiterMode ? countDelimiterOccurrences(newArabicText, activeDelim) : 0;
  }, [newArabicText, isDelimiterMode, activeDelim]);

  const enDelimiterCount = useMemo(() => {
    return isDelimiterMode ? countDelimiterOccurrences(newEnglishText, activeDelim) : 0;
  }, [newEnglishText, isDelimiterMode, activeDelim]);

  const parsedArSentences = useMemo(() => {
    return segmentParallelText(newArabicText, 'ar', activeDelim);
  }, [newArabicText, activeDelim]);

  const parsedEnSentences = useMemo(() => {
    return segmentParallelText(newEnglishText, 'en', activeDelim);
  }, [newEnglishText, activeDelim]);

  const dueWords = useMemo(() => {
    return savedWords.filter(w => !w.nextReviewAt || w.nextReviewAt <= Date.now());
  }, [savedWords]);

  const masteredWords = useMemo(() => {
    return savedWords.filter(w => (w.level ?? 0) >= 3 || w.mastered);
  }, [savedWords]);

  const learningWords = useMemo(() => {
    return savedWords.filter(w => (w.level ?? 0) < 3 && !w.mastered);
  }, [savedWords]);

  const filteredSavedWords = useMemo(() => {
    let list = savedWords;
    if (vocabFilter === 'due') list = dueWords;
    else if (vocabFilter === 'learning') list = learningWords;
    else if (vocabFilter === 'mastered') list = masteredWords;

    if (vocabSearch.trim()) {
      const q = vocabSearch.trim().toLowerCase();
      list = list.filter(w =>
        w.word.toLowerCase().includes(q) ||
        w.meanings.some(m => m.toLowerCase().includes(q)) ||
        (w.bookTitle && w.bookTitle.toLowerCase().includes(q))
      );
    }
    return list;
  }, [savedWords, vocabFilter, vocabSearch, dueWords, learningWords, masteredWords]);

  // Dynamic Quiz Distractor Algorithm (Picks smart contextually relevant distractors)
  const generateQuizOptions = (targetWord: SavedWord, all: SavedWord[]) => {
    const correctMeaning = targetWord.meanings[0] || targetWord.word;

    // Filter distractors from same language direction if available
    const sameDirectionWords = all.filter(w => w.id !== targetWord.id && w.direction === targetWord.direction && w.meanings.length > 0);
    const otherWords = all.filter(w => w.id !== targetWord.id && w.meanings.length > 0);

    const poolWords = sameDirectionWords.length >= 3 ? sameDirectionWords : (otherWords.length >= 3 ? otherWords : all);
    const candidateMeanings = poolWords.map(w => w.meanings[0]).filter(m => m && m.toLowerCase() !== correctMeaning.toLowerCase());

    const fallbackDistractors = targetWord.direction === 'ar-en'
      ? ['literary expression', 'emotional state', 'rapid movement', 'scenic description', 'philosophical concept', 'historical era']
      : ['تعبير أو اصطلاح أدبي', 'حالة وجدانية عميقة', 'حركة سريعة أو انتقال', 'وصف لمشهد طبيعي', 'فكرة أو مفهوم فلسفي', 'حقبة زمنية تاريخية'];

    const fullPool = [...new Set([...candidateMeanings, ...fallbackDistractors])].filter(m => m.toLowerCase() !== correctMeaning.toLowerCase());
    const shuffledPool = fullPool.sort(() => 0.5 - Math.random()).slice(0, 3);
    const finalOptions = [correctMeaning, ...shuffledPool].sort(() => 0.5 - Math.random());

    setQuizOptions(finalOptions);
    setQuizSelected(null);
    setQuizRevealed(false);
  };

  // Matching Pair Game Generator (Scales up to 8 pairs = 16 cards)
  const setupMatchingGame = (wordsList: SavedWord[]) => {
    const pairCount = Math.min(8, Math.max(3, wordsList.length));
    const sample = [...wordsList].sort(() => 0.5 - Math.random()).slice(0, pairCount);
    const cards: { id: string; wordId: string; text: string; type: 'term' | 'meaning' }[] = [];

    sample.forEach((w) => {
      cards.push({
        id: `term-${w.id}`,
        wordId: w.id,
        text: w.word,
        type: 'term'
      });
      cards.push({
        id: `meaning-${w.id}`,
        wordId: w.id,
        text: w.meanings[0] || w.word,
        type: 'meaning'
      });
    });

    setMatchingCards(cards.sort(() => 0.5 - Math.random()));
    setSelectedMatching([]);
    setMatchedCardIds([]);
    setMatchingErrorIds([]);
  };

  // Matching Card Click Handler
  const handleMatchingCardClick = (cardId: string) => {
    if (matchedCardIds.includes(cardId) || selectedMatching.includes(cardId)) return;

    const newSelected = [...selectedMatching, cardId];
    setSelectedMatching(newSelected);

    if (newSelected.length === 2) {
      const card1 = matchingCards.find(c => c.id === newSelected[0]);
      const card2 = matchingCards.find(c => c.id === newSelected[1]);

      if (card1 && card2 && card1.wordId === card2.wordId && card1.type !== card2.type) {
        // Match Success!
        const newlyMatched = [...matchedCardIds, card1.id, card2.id];
        setMatchedCardIds(newlyMatched);
        setSelectedMatching([]);

        // Check if all matched
        if (newlyMatched.length === matchingCards.length) {
          setReviewStats(prev => ({
            ...prev,
            good: prev.good + matchingCards.length / 2,
            completed: true
          }));
        }
      } else {
        // Mismatch
        setMatchingErrorIds(newSelected);
        setTimeout(() => {
          setSelectedMatching([]);
          setMatchingErrorIds([]);
        }, 700);
      }
    }
  };

  // Keyboard navigation for review sessions
  useEffect(() => {
    if (!showReviewModal || reviewStats.completed) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['input', 'textarea'].includes((e.target as HTMLElement)?.tagName?.toLowerCase())) return;

      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        if (reviewMode === 'flashcard') {
          setIsFlipped(prev => !prev);
        }
      } else if (e.key === '1') {
        if (reviewMode === 'flashcard') handleRateCurrentWord('again');
      } else if (e.key === '2') {
        if (reviewMode === 'flashcard') handleRateCurrentWord('hard');
      } else if (e.key === '3') {
        if (reviewMode === 'flashcard') handleRateCurrentWord('good');
      } else if (e.key === 'Escape') {
        setShowReviewModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showReviewModal, reviewStats.completed, reviewMode, reviewIndex, reviewQueue]);

  // Start Review Session
  const startReviewSession = (mode: 'flashcard' | 'quiz' | 'recall' | 'matching', targetWords?: SavedWord[]) => {
    let list = targetWords ? [...targetWords] : (vocabFilter === 'due' ? [...dueWords] : [...savedWords]);
    if (list.length === 0) list = [...savedWords];
    if (list.length === 0) {
      showToast('لا توجد مفردات محفوظة للمراجعة');
      return;
    }

    // Sort due words first
    list.sort((a, b) => {
      const aDue = !a.nextReviewAt || a.nextReviewAt <= Date.now() ? 0 : 1;
      const bDue = !b.nextReviewAt || b.nextReviewAt <= Date.now() ? 0 : 1;
      return aDue - bDue;
    });

    setReviewMode(mode);
    setReviewQueue(list);
    setReviewIndex(0);
    setIsFlipped(false);
    setReviewStats({ again: 0, hard: 0, good: 0, total: list.length, completed: false });
    
    if (mode === 'matching') {
      setupMatchingGame(list);
    } else if (mode === 'quiz' && list[0]) {
      generateQuizOptions(list[0], savedWords);
    }
    setRecallInput('');
    setRecallChecked(false);
    setRecallIsCorrect(false);
    setRecallShowHint(false);
    setShowReviewModal(true);
  };

  // Manual Word Creation Handler
  const handleSaveNewManualWord = async () => {
    if (!addWordTerm.trim() || !addWordMeanings.trim()) {
      showToast('يرجى إدخال المفردة والمعنى المقابل');
      return;
    }
    const meaningsList = addWordMeanings
      .split(/[,،;\n]+/)
      .map(m => m.trim())
      .filter(Boolean);

    const newEntry: SavedWord = {
      id: `word-manual-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      word: addWordTerm.trim(),
      meanings: meaningsList,
      notes: addWordNotes.trim() || undefined,
      direction: addWordDirection,
      savedAt: Date.now(),
      mastered: false,
      level: 0,
      streak: 0,
      reviewCount: 0,
      intervalDays: 1,
      nextReviewAt: Date.now()
    };

    await saveWordEntry(newEntry);
    setSavedWords(prev => [newEntry, ...prev]);
    setShowAddWordModal(false);
    setAddWordTerm('');
    setAddWordMeanings('');
    setAddWordNotes('');
    showToast('تمت إضافة المفردة يدوياً إلى دفتر المراجعة ✦');
  };

  // Open Edit Word & Notes Modal
  const handleOpenEditWordModal = (word: SavedWord) => {
    setEditingWord(word);
    setEditWordMeanings(word.meanings.join('، '));
    setEditWordNotes(word.notes || '');
    setShowEditWordModal(true);
  };

  // Save Edit Word & Notes
  const handleSaveEditWord = async () => {
    if (!editingWord) return;
    const meaningsList = editWordMeanings
      .split(/[,،;\n]+/)
      .map(m => m.trim())
      .filter(Boolean);

    const updatedWord: SavedWord = {
      ...editingWord,
      meanings: meaningsList.length > 0 ? meaningsList : editingWord.meanings,
      notes: editWordNotes.trim() || undefined
    };

    await saveWordEntry(updatedWord);
    setSavedWords(prev => prev.map(w => w.id === updatedWord.id ? updatedWord : w));
    setShowEditWordModal(false);
    setEditingWord(null);
    showToast('تم تحديث بيانات المفردة والملاحظات بنجاح ✦');
  };

  // Export Entire Database (Books + Batches + Vocabulary + Draft)
  const handleExportFullBackup = async () => {
    try {
      const backupJson = await exportCompleteBackup();
      const blob = new Blob([backupJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `parallel_reader_full_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('تم تصدير نسخة احتياطية شاملة لكافة الكتب والمفردات 💾');
    } catch (err) {
      console.error('Export backup failed:', err);
      showToast('حدث خطأ أثناء تصدير النسخة الاحتياطية');
    }
  };

  // Import Entire Database (Books + Batches + Vocabulary + Draft)
  const handleImportFullBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const rawJson = evt.target?.result as string;
        const res = await importCompleteBackup(rawJson);
        const allBooks = await getAllBooks();
        const allWords = await getAllSavedWords();
        setBooks(allBooks);
        setSavedWords(allWords);
        if (allBooks.length > 0) {
          setCurrentBook(allBooks[0]);
        }
        showToast(`تمت استعادة النسخة الاحتياطية بنجاح (${res.booksCount} كتاب، ${res.wordsCount} مفردة) ✦`);
      } catch (err) {
        console.error('Import backup failed:', err);
        showToast('تعذر استيراد ملف النسخة الاحتياطية، تأكد من صحة الملف');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Export Vocabulary to JSON File
  const handleExportVocabulary = () => {
    if (savedWords.length === 0) {
      showToast('لا توجد مفردات لتصديرها');
      return;
    }
    const dataStr = JSON.stringify(savedWords, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vocabulary_notebook_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('تم تصدير ملف المفردات بنجاح 💾');
  };

  // Import Vocabulary from JSON File
  const handleImportVocabulary = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        if (Array.isArray(parsed)) {
          let count = 0;
          for (const item of parsed) {
            if (item.word && Array.isArray(item.meanings)) {
              await saveWordEntry({
                ...item,
                id: item.id || `word-imp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
              });
              count++;
            }
          }
          const all = await getAllSavedWords();
          setSavedWords(all);
          showToast(`تم استيراد ${count} مفردة بنجاح ✦`);
        } else {
          showToast('تنسيق ملف المفردات غير صالح');
        }
      } catch {
        showToast('تعذر قراءة ملف الاستيراد');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Remove duplicate words
  const handleRemoveDuplicates = async () => {
    const seen = new Set<string>();
    let removedCount = 0;
    for (const w of savedWords) {
      const key = w.word.trim().toLowerCase();
      if (seen.has(key)) {
        await deleteWordEntry(w.id);
        removedCount++;
      } else {
        seen.add(key);
      }
    }
    const remaining = await getAllSavedWords();
    setSavedWords(remaining);
    showToast(removedCount > 0 ? `تم حذف ${removedCount} مفردة مكررة` : 'لا توجد مفردات مكررة');
  };

  // Reset SRS review dates
  const handleResetSrsSchedule = async () => {
    const now = Date.now();
    for (const w of savedWords) {
      await saveWordEntry({
        ...w,
        nextReviewAt: now,
        intervalDays: 1,
        level: 0
      });
    }
    const updated = await getAllSavedWords();
    setSavedWords(updated);
    showToast('تمت إعادة ضبط مواعيد مراجعة كافة المفردات ✦');
  };

  // SuperMemo SM-2 Spaced Repetition Algorithm Engine
  const handleRateCurrentWord = async (rating: 'again' | 'hard' | 'good') => {
    const currentWord = reviewQueue[reviewIndex];
    if (!currentWord) return;

    const prevLevel = currentWord.level ?? 0;
    const prevStreak = currentWord.streak ?? 0;
    const prevInterval = currentWord.intervalDays ?? 1;
    const prevEF = currentWord.easinessFactor ?? 2.5;

    let newLevel = prevLevel;
    let newStreak = prevStreak;
    let newInterval = prevInterval;
    let newEF = prevEF;

    if (rating === 'again') {
      // Grade 0: Failed recall
      newStreak = 0;
      newLevel = Math.max(0, prevLevel - 1);
      newInterval = 1;
      newEF = Math.max(1.3, prevEF - 0.2);
      setReviewStats(prev => ({ ...prev, again: prev.again + 1 }));
    } else if (rating === 'hard') {
      // Grade 1: Difficult recall
      newStreak = Math.max(1, prevStreak);
      newInterval = Math.max(1, Math.round(prevInterval * 1.2));
      newEF = Math.max(1.3, prevEF - 0.15);
      setReviewStats(prev => ({ ...prev, hard: prev.hard + 1 }));
    } else if (rating === 'good') {
      // Grade 2: Successful recall
      newStreak = prevStreak + 1;
      newLevel = Math.min(3, prevLevel + 1);
      if (prevStreak === 0) newInterval = 1;
      else if (prevStreak === 1) newInterval = 6;
      else newInterval = Math.round(prevInterval * prevEF);
      newEF = prevEF; // Constant
      setReviewStats(prev => ({ ...prev, good: prev.good + 1 }));
    }

    const nextReviewTimestamp = Date.now() + newInterval * 24 * 60 * 60 * 1000;

    const updatedWord: SavedWord = {
      ...currentWord,
      level: newLevel,
      streak: newStreak,
      intervalDays: newInterval,
      easinessFactor: parseFloat(newEF.toFixed(2)),
      lastReviewedAt: Date.now(),
      nextReviewAt: nextReviewTimestamp,
      reviewCount: (currentWord.reviewCount ?? 0) + 1,
      mastered: newLevel >= 3
    };

    await saveWordEntry(updatedWord);
    setSavedWords(prev => prev.map(w => w.id === updatedWord.id ? updatedWord : w));
    setReviewQueue(prev => prev.map(w => w.id === updatedWord.id ? updatedWord : w));

    // Next card or complete
    if (reviewIndex + 1 < reviewQueue.length) {
      const nextIdx = reviewIndex + 1;
      setReviewIndex(nextIdx);
      setIsFlipped(false);
      if (reviewMode === 'quiz' && reviewQueue[nextIdx]) {
        generateQuizOptions(reviewQueue[nextIdx], savedWords);
      }
      setRecallInput('');
      setRecallChecked(false);
      setRecallIsCorrect(false);
      setRecallShowHint(false);
    } else {
      setReviewStats(prev => ({ ...prev, completed: true }));
    }
  };

  // Check user answer in recall/spelling mode with smart normalization
  const handleCheckRecall = () => {
    const currentWord = reviewQueue[reviewIndex];
    if (!currentWord || !recallInput.trim()) return;
    const cleanUser = recallInput.trim();
    const cleanTarget = currentWord.word.trim();
    const isExact = cleanUser.toLowerCase() === cleanTarget.toLowerCase();
    const isNormalizedMatch = normalizeForMatch(cleanUser) === normalizeForMatch(cleanTarget);
    const isPatternMatch = wordsMatchPattern(cleanUser, cleanTarget);
    const isCorrect = isExact || isNormalizedMatch || isPatternMatch;
    setRecallChecked(true);
    setRecallIsCorrect(isCorrect);
  };

  // Dynamic text batches sorted by newest first (الأحدث أولاً)
  const currentBookBatches = useMemo(() => {
    if (!currentBook) return [];
    return getBookBatchesSorted(currentBook);
  }, [currentBook]);

  // Aligned rows depending on activeBatchId filter or all batches concatenated (newest first)
  const currentBookAllRows = useMemo(() => {
    if (!currentBook) return [];
    if (activeBatchId && activeBatchId !== 'all') {
      const b = currentBookBatches.find(item => item.id === activeBatchId);
      return b ? (b.alignedRows || []).map(r => ({ ...r, batchId: b.id })) : [];
    }
    return getBookAllRowsSorted(currentBook);
  }, [currentBook, currentBookBatches, activeBatchId]);

  // Filtered rows for in-book search and active batch filtering
  const filteredRows = useMemo(() => {
    if (!currentBook) return [];
    if (!bookSearchQuery.trim()) return currentBookAllRows;
    const q = bookSearchQuery.trim().toLowerCase();
    return currentBookAllRows.filter(r =>
      r.arabic.toLowerCase().includes(q) || r.english.toLowerCase().includes(q)
    );
  }, [currentBook, currentBookAllRows, bookSearchQuery]);

  // Filtered books in library
  const filteredBooks = useMemo(() => {
    if (!searchFilter.trim()) return books;
    const q = searchFilter.trim().toLowerCase();
    return books.filter(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q));
  }, [books, searchFilter]);

  // Active Hero Book for the spotlight showcase (most recently read or first book)
  const activeHeroBook = useMemo(() => {
    if (books.length === 0) return null;
    if (currentBook && books.some(b => b.id === currentBook.id)) {
      return currentBook;
    }
    const sorted = [...books].sort((a, b) => (b.lastReadAt || b.createdAt || 0) - (a.lastReadAt || a.createdAt || 0));
    return sorted[0];
  }, [books, currentBook]);

  // Other books (excluding the active hero book when not in search filter mode)
  const otherBooks = useMemo(() => {
    if (!activeHeroBook) return books;
    return books.filter(b => b.id !== activeHeroBook.id);
  }, [books, activeHeroBook]);

  // Standalone Lexicon Live Search
  useEffect(() => {
    if (!lexiconQuery.trim()) {
      setLexiconResult(null);
      return;
    }
    const timer = setTimeout(async () => {
      setLexiconLoading(true);
      try {
        const endpoint = lexiconDirection === 'ar-en' ? '/api/lexicon/ar-en' : '/api/lexicon/en-ar';
        const res = await fetch(`${endpoint}?word=${encodeURIComponent(lexiconQuery.trim())}`);
        const data = await res.json();
        setLexiconResult({
          word: data.word || lexiconQuery,
          meanings: data.meanings || []
        });
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setLexiconLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [lexiconQuery, lexiconDirection]);

  // Helper for formatting last read relative date
  const formatLastRead = (timestamp?: number) => {
    if (!timestamp) return 'لم يُقرأ بعد';
    const diffHours = Math.round((Date.now() - timestamp) / (1000 * 60 * 60));
    if (diffHours < 1) return 'قبل قليل';
    if (diffHours < 24) return `منذ ${diffHours} س`;
    const diffDays = Math.round(diffHours / 24);
    if (diffDays === 1) return 'أمس';
    if (diffDays < 30) return `منذ ${diffDays} أيام`;
    return new Date(timestamp).toLocaleDateString('ar-EG');
  };

  // Helper for relative next review time badge
  const getRelativeNextReview = (nextReviewAt?: number) => {
    if (!nextReviewAt || nextReviewAt <= Date.now()) {
      return { label: 'مستحقة الآن', isDue: true, color: 'text-amber-300 bg-amber-950/60 border-amber-500/30 animate-pulse' };
    }
    const diffMs = nextReviewAt - Date.now();
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 24) {
      return { label: `خلال ${Math.max(1, diffHours)} س`, isDue: false, color: 'text-amber-300 bg-amber-950/40 border-amber-500/20' };
    } else if (diffDays === 1) {
      return { label: 'غداً', isDue: false, color: 'text-blue-300 bg-blue-950/40 border-blue-500/20' };
    } else {
      return { label: `بعد ${diffDays} أيام`, isDue: false, color: 'text-slate-300 bg-slate-800/40 border-white/10' };
    }
  };
  const normalizeForMatch = (w: string) => {
    if (!w) return '';
    return w
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // remove Arabic tashkeel & tatweel
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/[ة]/g, 'ه')
      .replace(/[ى]/g, 'ي')
      .replace(/^[\s\p{P}«»“”()\[\]{}،.:؛!؟-]+/gu, '')
      .replace(/[\s\p{P}«»“”()\[\]{}،.:؛!؟-]+$/gu, '')
      .trim();
  };

  // Helper to extract base Arabic stem/lemma by stripping prefixes & attached pronouns (handles mega-words like أفأسقيناكموها)
  const stemArabicWord = (word: string): string => {
    if (!word) return '';
    let norm = normalizeForMatch(word);
    if (!norm) return '';

    // Strip compound prefixes (أفأس, أفأ, أوا, أفس, أوس, فسي, أف, أو, فبال, وبال, إلخ)
    const prefixes = [
      'أفأس', 'أفأ', 'أوا', 'أفس', 'أوس', 'فسي', 'فسأ', 'فسن', 'فست',
      'أف', 'أو', 'فلي', 'ولت', 'ولن', 'فلن', 'أبال', 'أفبال', 'أوبال',
      'فبال', 'وبال', 'فكال', 'وكال', 'فلل', 'ولل',
      'بال', 'فال', 'وال', 'كال', 'لل', 'ال',
      'وس', 'فس', 'وب', 'فب', 'ول', 'فل', 'وك', 'فك',
      'و', 'ف', 'ب', 'ل', 'ك', 'س', 'أ'
    ];
    for (const pref of prefixes) {
      if (norm.startsWith(pref) && norm.length - pref.length >= 2) {
        norm = norm.slice(pref.length);
        break;
      }
    }

    // Strip compound attached pronouns & multi-object clitics (ناكموها, ناكموه, تكموها, كموها, تموها, نيها, إلخ)
    const suffixes = [
      'ناكموها', 'ناكموه', 'تكموها', 'تكموه', 'كموها', 'كموه', 'تموها', 'تموه',
      'ناهموها', 'ناهموه', 'هموها', 'هموه', 'نيها', 'نيه', 'كها', 'كه',
      'ناكم', 'ناهم', 'تكم', 'تهم', 'تموني', 'تمونا', 'تموهم', 'تموهن',
      'تكما', 'تكم', 'تكن', 'تهما', 'تهم', 'تهن', 'تها', 'تنا', 'تك', 'ته', 'تي',
      'كما', 'هما', 'كم', 'كن', 'هم', 'هن', 'ها', 'نا', 'ك', 'ه', 'ي', 'ني',
      'تان', 'تين', 'ان', 'ين', 'ون', 'ات', 'وها', 'وه'
    ];
    for (const suf of suffixes) {
      if (norm.endsWith(suf) && norm.length - suf.length >= 2) {
        norm = norm.slice(0, -suf.length);
        break;
      }
    }

    // Weak vowel & Alif Maqsura normalization (اسقي -> اسقى / سقى)
    if (norm.endsWith('ي') && norm.length >= 3) {
      norm = norm.slice(0, -1) + 'ى';
    }

    // Five nouns weak vowel normalization (اخو/اخي/اخا -> اخ, ابو/ابي/ابا -> اب)
    if (['اخو', 'اخي', 'اخا'].includes(norm)) return 'اخ';
    if (['ابو', 'ابي', 'ابا'].includes(norm)) return 'اب';

    return norm;
  };

  // Check if two tokens match in base lemma, definite article, dual/plural pronouns, or singular
  const wordsMatchPattern = (wordA: string, wordB: string): boolean => {
    const a = normalizeForMatch(wordA);
    const b = normalizeForMatch(wordB);
    if (!a || !b) return false;
    if (a === b) return true;

    // Arabic Morphological Stemming Match
    const stemA = stemArabicWord(wordA);
    const stemB = stemArabicWord(wordB);
    if (stemA && stemB && stemA === stemB) return true;

    // English plural / singular (s / es)
    const stripEnglishSuffix = (s: string) => {
      if (s.endsWith('es') && s.length > 4) return s.slice(0, -2);
      if (s.endsWith('s') && s.length > 3) return s.slice(0, -1);
      return s;
    };
    if (stripEnglishSuffix(a) === stripEnglishSuffix(b) && stripEnglishSuffix(a).length >= 3) return true;

    return false;
  };

  // Parse sentence into interactive words with row context & explicitly selected word highlight
  const parseInteractiveTokens = (
    sentence: string, 
    direction: 'ar-en' | 'en-ar',
    rowContext?: AlignedUnit
  ) => {
    const tokens = sentence.split(/(\s+|[،.؛:!؟«»""''`()\[\]{}\-_—–]+)/);

    return tokens.map((token, idx) => {
      const isWord = /[^\s،.؛:!؟«»""''`()\[\]{}\-_—–]+/.test(token);
      if (!isWord) return <span key={idx}>{token}</span>;

      const cleanToken = token
        .replace(/^[\s\p{P}«»“”()\[\]{}،.:؛!؟-]+/gu, '')
        .replace(/[\s\p{P}«»“”()\[\]{}،.:؛!؟-]+$/gu, '')
        .trim();

      if (!cleanToken) return <span key={idx}>{token}</span>;

      // Check match ONLY for explicitly selected word and its AI target match
      const isExactSelected = Boolean(selectedWord && (cleanToken.toLowerCase() === selectedWord.word.toLowerCase()));
      const isAiTargetMatch = Boolean(selectedWord?.aiExactMatch && wordsMatchPattern(cleanToken, selectedWord.aiExactMatch));

      let highlightClass = '';
      if (isExactSelected) {
        highlightClass = 'active-word selected-primary';
      } else if (isAiTargetMatch) {
        highlightClass = 'active-word active-word-pattern-match';
      }

      return (
        <span
          key={idx}
          onClick={(e) => {
            e.stopPropagation();
            if (rowContext) {
              updateActiveRowAndSaveProgress(rowContext.id, false);
            }
            handleWordClick(token, direction, rowContext);
          }}
          className={`word-link ${highlightClass}`.trim()}
          title={cleanToken}
        >
          {token}
        </span>
      );
    });
  };

  // Add custom book with auto-alignment & open standalone reading screen
  const handleAutoAlign = () => {
    if (!newArabicText.trim() || !newEnglishText.trim()) return;
    setIsAligning(true);

    const activeDelim = customDelimiter?.trim() || '';
    const arSentences = segmentParallelText(newArabicText, 'ar', activeDelim);
    const enSentences = segmentParallelText(newEnglishText, 'en', activeDelim);

    const maxLen = Math.max(arSentences.length, enSentences.length);
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const rows: AlignedUnit[] = [];

    for (let i = 0; i < maxLen; i++) {
      rows.push({
        id: `row-${batchId}-${i + 1}`,
        arabic: arSentences[i] || '',
        english: enSentences[i] || '',
        batchId
      });
    }

    if (workspaceMode === 'append_batch' && selectedTargetBookId) {
      const targetBook = books.find(b => b.id === selectedTargetBookId);
      if (targetBook) {
        const existingBatches = getBookBatchesSorted(targetBook);
        const createdBatch: TextBatch = {
          id: batchId,
          title: newBatchTitle.trim() || `دفعة جديدة (${new Date().toLocaleDateString('ar-EG')})`,
          arabicText: newArabicText,
          englishText: newEnglishText,
          alignedRows: rows,
          createdAt: Date.now()
        };

        const updatedBatches = [createdBatch, ...existingBatches];
        const updatedBook: Book = {
          ...targetBook,
          batches: updatedBatches,
          alignedRows: updatedBatches.flatMap(b => b.alignedRows),
          lastReadAt: Date.now()
        };

        saveBook(updatedBook).then(() => {
          setBooks(prev => [updatedBook, ...prev.filter(b => b.id !== updatedBook.id)]);
          setCurrentBook(updatedBook);
          setActiveBatchId('all');
          setIsAligning(false);
          setIsReading(true);
          clearWorkspaceDraft();
          setDraftSavedAt(null);
          setNewArabicText('');
          setNewEnglishText('');
          setNewBatchTitle('');
          showToast(`تمت إضافة الدفعة الجديدة (${rows.length} فقرة) إلى "${targetBook.title}" بنجاح`);
        });
        return;
      }
    }

    const initialBatch: TextBatch = {
      id: batchId,
      title: newBatchTitle.trim() || 'الدفعة الأولى',
      arabicText: newArabicText,
      englishText: newEnglishText,
      alignedRows: rows,
      createdAt: Date.now()
    };

    const createdBook: Book = {
      id: `book-user-${Date.now()}`,
      title: newTitle.trim() || 'كتاب مخصص — Parallel Reader',
      author: newAuthor.trim() || 'مؤلف مخصص — Author',
      arabicText: newArabicText,
      englishText: newEnglishText,
      alignedRows: rows,
      batches: [initialBatch],
      createdAt: Date.now(),
      lastReadAt: Date.now(),
      coverColor: 'from-amber-950/40 to-slate-900/80'
    };

    saveBook(createdBook).then(() => {
      setBooks(prev => [createdBook, ...prev.filter(b => b.id !== createdBook.id)]);
      setCurrentBook(createdBook);
      setActiveBatchId('all');
      setIsAligning(false);
      setIsReading(true);
      clearWorkspaceDraft();
      setDraftSavedAt(null);
      setNewArabicText('');
      setNewEnglishText('');
      setNewTitle('');
      setNewAuthor('');
      showToast(`تم إنشاء الكتاب والدفعة الأولى بنجاح (${rows.length} فقرة)`);
    });
  };

  // Digital Book E-Reader Progress Metrics
  const activeRowIdx = useMemo(() => {
    if (!filteredRows || filteredRows.length === 0) return 0;
    const idx = filteredRows.findIndex(r => r.id === activeRowId);
    return idx >= 0 ? idx : 0;
  }, [filteredRows, activeRowId]);

  const readingPercentage = useMemo(() => {
    if (!filteredRows || filteredRows.length === 0) return 0;
    return Math.round(((activeRowIdx + 1) / filteredRows.length) * 100);
  }, [filteredRows, activeRowIdx]);

  return (
    <>
      {/* ================= STANDALONE READING SCREEN ================= */}
      {/* When isReading is true, render the completely standalone, distraction-free reading folio with bottom settings bar */}
      {isReading && currentBook ? (
        <div 
          onClick={handleReaderCanvasClick}
          className={`standalone-reader-screen ${isFullscreen ? 'fullscreen-mode' : ''} ${isFullscreen && !fullscreenControlsVisible ? 'controls-hidden' : 'controls-visible'} ${showWordUnderline ? 'with-word-underlines' : 'no-word-underlines'}`}
        >
          {/* Subtle Floating Pill to reveal controls in Zen Fullscreen mode */}
          {isFullscreen && !fullscreenControlsVisible && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFullscreenControlsVisible(true);
              }}
              className="fullscreen-reveal-pill"
              title="إظهار أشرطة وأزرار التحكم"
            >
              <i className="fa-solid fa-sliders text-xs"></i>
              <span>إظهار الأشرطة والتحكم</span>
            </button>
          )}

          <div className="folder-reading-wrap">
            <article className="paper-book-page">
              
              {/* Paper Page Running Top Header */}
              <div className="paper-page-header">
                {/* Back / Close Folder Button */}
                <button
                  onClick={() => setIsReading(false)}
                  className="paper-action-btn back-btn"
                  title="إغلاق الكتاب والعودة للتطبيق"
                >
                  <i className="fa-solid fa-arrow-right"></i>
                  <span>إغلاق الكتاب</span>
                </button>

                {/* Book & Author title in classical serif */}
                <div className="paper-book-identity">
                  <span className="paper-book-title">{currentBook.title}</span>
                  {currentBook.author && (
                    <>
                      <span className="paper-identity-sep">·</span>
                      <span className="paper-book-author">{currentBook.author}</span>
                    </>
                  )}
                </div>

                {/* Top Controls & Search */}
                <div className="paper-controls">
                  {/* Batch Management Button if multiple batches exist and not in fullscreen mode */}
                  {currentBookBatches.length > 1 && !isFullscreen && (
                    <button
                      onClick={() => {
                        if (currentBook) {
                          setSelectedBookForBatches(currentBook);
                          setShowBatchesModal(true);
                        }
                      }}
                      className="paper-action-btn"
                      title="عرض وإدارة بطاقات دفعات هذا الكتاب"
                    >
                      <i className="fa-solid fa-layer-group text-xs text-amber-300"></i>
                      <span className="hidden sm:inline text-xs">إدارة الدفعات</span>
                    </button>
                  )}

                  {/* In-Book Search Input */}
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      value={bookSearchQuery}
                      onChange={(e) => setBookSearchQuery(e.target.value)}
                      placeholder="بحث في الكتاب..."
                      className="paper-search-input"
                    />
                    {bookSearchQuery && (
                      <button 
                        onClick={() => setBookSearchQuery('')} 
                        className="absolute left-2 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100"
                        title="مسح البحث"
                      >
                        <i className="fa-solid fa-xmark text-xs"></i>
                      </button>
                    )}
                  </div>

                  {/* Progress Percentage Badge */}
                  <div className="paper-progress-badge hidden sm:inline-flex">
                    {filteredRows.length > 0 ? (
                      <span>
                        {readingPercentage}% · فقرة {activeRowIdx + 1} من {filteredRows.length}
                      </span>
                    ) : (
                      <span>0 فقرات</span>
                    )}
                  </div>

                  {/* Fullscreen Button */}
                  <button
                    onClick={toggleFullscreen}
                    className={`paper-action-btn ${isFullscreen ? 'active' : ''}`}
                    title={isFullscreen ? 'الخروج من ملء الشاشة' : 'ملء الشاشة'}
                  >
                    <i className={`fa-solid ${isFullscreen ? 'fa-compress' : 'fa-expand'} text-sm`}></i>
                    <span className="hidden md:inline">{isFullscreen ? 'تصغير' : 'ملء الشاشة'}</span>
                  </button>
                </div>
              </div>

              {/* Fast Chapter & Batch Navigation Bar (Hidden in Fullscreen Mode) */}
              {currentBookBatches.length > 1 && !isFullscreen && (
                <div className="paper-fast-chapter-bar flex items-center gap-1.5 overflow-x-auto py-2 px-4 bg-black/40 border-b border-[var(--editorial-border)] scrollbar-none text-xs">
                  <span className="text-amber-300 font-bold shrink-0 flex items-center gap-1.5 ml-2 font-serif">
                    <i className="fa-solid fa-layer-group text-xs"></i>
                    <span>فصول الكتاب:</span>
                  </span>

                  <button
                    onClick={() => setActiveBatchId('all')}
                    className={`px-3 py-1 rounded-full text-xs font-serif font-bold transition-all shrink-0 ${
                      activeBatchId === 'all'
                        ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20'
                        : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white border border-white/5'
                    }`}
                  >
                    الكل ({currentBookBatches.length} دفعات)
                  </button>

                  {currentBookBatches.map((batch, idx) => (
                    <button
                      key={batch.id}
                      onClick={() => setActiveBatchId(batch.id)}
                      className={`px-3 py-1 rounded-full text-xs font-serif transition-all shrink-0 flex items-center gap-1.5 ${
                        activeBatchId === batch.id
                          ? 'bg-amber-600 text-white font-bold shadow-md shadow-amber-600/30 ring-1 ring-amber-400'
                          : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white border border-white/5'
                      }`}
                    >
                      <span>{batch.title || `دفعة ${currentBookBatches.length - idx}`}</span>
                      <span className="text-[10px] opacity-75 font-mono">({batch.alignedRows?.length || 0})</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Book Spine Center Crease (for Dual Facing Pages) */}
              {layoutMode === 'dual' && <div className="paper-spine-crease" aria-hidden="true"></div>}

              {/* Reading Content Canvas */}
              <div className="paper-reading-canvas">
                {/* DUAL MODE */}
                {layoutMode === 'dual' && (
                  <div className="paper-dual-spread">
                    {/* Arabic Page (Right Page) */}
                    <div 
                      ref={arPaneRef}
                      onScroll={(e) => {
                        handleArScroll();
                        handleContainerScroll(e);
                      }}
                      className="paper-page-column paper-page-ar"
                    >
                      {filteredRows.length === 0 ? (
                        <p className="paper-empty-notice">لا توجد فقرات مطابقة للبحث</p>
                      ) : (
                        filteredRows.map((row) => (
                          <div
                            key={row.id}
                            id={`sentence-${row.id}`}
                            onClick={() => updateActiveRowAndSaveProgress(row.id, false)}
                            className={`paper-sentence-row paper-row-ar ${activeRowId === row.id ? 'active-row' : ''}`}
                          >
                            <p 
                              className="text-ar"
                              style={{ 
                                fontFamily: `${arabicFont}, serif`, 
                                fontSize: `${fontSize}px`, 
                                lineHeight: lineHeight 
                              }}
                            >
                              {parseInteractiveTokens(row.arabic, 'ar-en', row)}
                            </p>
                          </div>
                        ))
                      )}
                    </div>

                    {/* English Page (Left Page) */}
                    <div 
                      ref={enPaneRef}
                      onScroll={(e) => {
                        handleEnScroll();
                        handleContainerScroll(e);
                      }}
                      className="paper-page-column paper-page-en"
                    >
                      {filteredRows.length === 0 ? (
                        <p className="paper-empty-notice">No matching sentences found</p>
                      ) : (
                        filteredRows.map((row) => (
                          <div
                            key={row.id}
                            onClick={() => updateActiveRowAndSaveProgress(row.id, false)}
                            className={`paper-sentence-row paper-row-en ${activeRowId === row.id ? 'active-row' : ''}`}
                          >
                            <p 
                              className="text-en" 
                              style={{ 
                                fontFamily: `${englishFont}, serif`, 
                                fontSize: `${Math.round(fontSize * 0.84)}px`, 
                                lineHeight: lineHeight 
                              }}
                            >
                              {parseInteractiveTokens(row.english, 'en-ar', row)}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* INTERLEAVED MODE */}
                {layoutMode === 'interleaved' && (
                  <div className="paper-interleaved-spread" onScroll={handleContainerScroll}>
                    {filteredRows.map((row, idx) => {
                      const isNewBatchStart = activeBatchId === 'all' && currentBookBatches.length > 1 && (idx === 0 || row.batchId !== filteredRows[idx - 1]?.batchId);
                      const batchInfo = isNewBatchStart ? currentBookBatches.find(b => b.id === row.batchId) : null;

                      return (
                        <React.Fragment key={row.id}>
                          {isNewBatchStart && (
                            <div className="batch-chapter-divider">
                              <span className="batch-chapter-badge">
                                <i className="fa-solid fa-bookmark text-[11px]"></i>
                                <span>{batchInfo?.title || `الدفعة`}</span>
                                <span className="opacity-70 text-[11px] font-mono">({batchInfo?.alignedRows?.length || 0} فقرة)</span>
                              </span>
                            </div>
                          )}
                          <div
                            id={`sentence-${row.id}`}
                            onClick={() => updateActiveRowAndSaveProgress(row.id, false)}
                            className={`paper-interleaved-row ${activeRowId === row.id ? 'active-row' : ''}`}
                          >
                            <p 
                              className="text-ar mb-1.5" 
                              style={{ 
                                fontFamily: `${arabicFont}, serif`, 
                                fontSize: `${fontSize}px`, 
                                lineHeight: lineHeight 
                              }}
                            >
                              {parseInteractiveTokens(row.arabic, 'ar-en', row)}
                            </p>
                            <p 
                              className="text-en" 
                              style={{ 
                                fontFamily: `${englishFont}, serif`, 
                                fontSize: `${Math.round(fontSize * 0.84)}px`, 
                                lineHeight: lineHeight 
                              }}
                            >
                              {parseInteractiveTokens(row.english, 'en-ar', row)}
                            </p>
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}

                {/* MODE 3: SINGLE TEXT FOCUS MODE (عرض أحد النصين لوحده) */}
                {layoutMode === 'focus' && (
                  <div className="paper-focus-spread space-y-4" onScroll={handleContainerScroll}>
                    {filteredRows.length === 0 ? (
                      <p className="paper-empty-notice">لا توجد فقرات مطابقة للبحث</p>
                    ) : (
                      filteredRows.map((row, idx) => {
                        const isNewBatchStart = activeBatchId === 'all' && currentBookBatches.length > 1 && (idx === 0 || row.batchId !== filteredRows[idx - 1]?.batchId);
                        const batchInfo = isNewBatchStart ? currentBookBatches.find(b => b.id === row.batchId) : null;

                        return (
                          <React.Fragment key={row.id}>
                            {isNewBatchStart && (
                              <div className="batch-chapter-divider">
                                <span className="batch-chapter-badge">
                                  <i className="fa-solid fa-bookmark text-[11px]"></i>
                                  <span>{batchInfo?.title || `الدفعة`}</span>
                                  <span className="opacity-70 text-[11px] font-mono">({batchInfo?.alignedRows?.length || 0} فقرة)</span>
                                </span>
                              </div>
                            )}
                            <div
                              id={`sentence-${row.id}`}
                              onClick={() => updateActiveRowAndSaveProgress(row.id, false)}
                              className={`paper-focus-row ${activeRowId === row.id ? 'active-row' : ''}`}
                            >
                              {focusLanguage === 'ar' ? (
                                <p 
                                  className="text-ar" 
                                  style={{ 
                                    fontFamily: `${arabicFont}, serif`, 
                                    fontSize: `${fontSize + 1}px`, 
                                    lineHeight: lineHeight 
                                  }}
                                >
                                  {parseInteractiveTokens(row.arabic, 'ar-en', row)}
                                </p>
                              ) : (
                                <p 
                                  className="text-en" 
                                  style={{ 
                                    fontFamily: `${englishFont}, serif`, 
                                    fontSize: `${fontSize}px`, 
                                    lineHeight: lineHeight 
                                  }}
                                >
                                  {parseInteractiveTokens(row.english, 'en-ar', row)}
                                </p>
                              )}
                            </div>
                          </React.Fragment>
                        );
                      })
                    )}
                  </div>
                )}

                {/* End of Chapter / Batch Navigation Card with Next Chapter Arrow */}
                {currentBookBatches.length > 1 && (() => {
                  const activeBatchIndex = currentBookBatches.findIndex(b => b.id === activeBatchId);
                  const nextBatch = activeBatchIndex >= 0 && activeBatchIndex < currentBookBatches.length - 1
                    ? currentBookBatches[activeBatchIndex + 1]
                    : null;
                  const prevBatch = activeBatchIndex > 0
                    ? currentBookBatches[activeBatchIndex - 1]
                    : null;

                  return (
                    <div className="end-of-chapter-navigation my-8 p-4 rounded-2xl bg-black/40 border border-[var(--editorial-border)] text-center space-y-3 max-w-lg mx-auto shadow-xl">
                      <div className="text-xs text-amber-300 font-serif flex items-center justify-center gap-1.5">
                        <i className="fa-solid fa-bookmark text-amber-400 text-xs"></i>
                        <span>
                          {activeBatchId === 'all'
                            ? 'نهاية جميع فصول ودفعات الكتاب'
                            : `نهاية ${currentBookBatches.find(b => b.id === activeBatchId)?.title || 'هذا الفصل'}`}
                        </span>
                      </div>

                      <div className="flex items-center justify-center gap-3 pt-1 flex-wrap">
                        {prevBatch && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveBatchId(prevBatch.id);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="btn btn-secondary py-2 px-4 text-xs flex items-center gap-2 text-slate-300 hover:text-white"
                            title="الانتقال إلى الفصل السابق"
                          >
                            <i className="fa-solid fa-arrow-right text-xs text-amber-300"></i>
                            <span>{prevBatch.title || 'الفصل السابق'}</span>
                          </button>
                        )}

                        {nextBatch ? (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveBatchId(nextBatch.id);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="btn btn-primary py-2.5 px-6 text-xs flex items-center gap-2 bg-gradient-to-r from-amber-600 via-amber-600 to-amber-600 text-white font-bold shadow-lg shadow-amber-900/30 hover:scale-105 transition-all"
                            title="الانتقال إلى الفصل التالي"
                          >
                            <span>{nextBatch.title || 'الانتقال إلى الفصل التالي'}</span>
                            <i className="fa-solid fa-arrow-left text-sm text-amber-300"></i>
                          </button>
                        ) : (
                          activeBatchId !== 'all' && (
                            <button
                              type="button"
                              onClick={() => setActiveBatchId('all')}
                              className="btn btn-secondary py-2 px-4 text-xs flex items-center gap-1.5 text-amber-300"
                            >
                              <i className="fa-solid fa-book-open text-xs"></i>
                              <span>عرض كافة فصول الكتاب</span>
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* ================= BOTTOM SETTINGS & CONTROLS TOOLBAR ================= */}
              {/* Essential, quiet reading toolbar */}
              <footer className="ereader-bottom-toolbar">
                {/* 1. Previous Sentence */}
                <button
                  onClick={() => {
                    if (filteredRows.length === 0) return;
                    const idx = filteredRows.findIndex(r => r.id === activeRowId);
                    const targetIdx = idx > 0 ? idx - 1 : filteredRows.length - 1;
                    handleJumpToSentence(filteredRows[targetIdx].id);
                  }}
                  className="paper-action-btn"
                  title="الفقرة السابقة"
                >
                  <i className="fa-solid fa-chevron-right text-xs"></i>
                  <span className="hidden sm:inline">السابق</span>
                </button>

                {/* 2. Compact Reading Progress Navigation Slider */}
                <div className="ereader-progress-slider flex-1 max-w-xs flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max={Math.max(0, filteredRows.length - 1)}
                    value={Math.max(0, filteredRows.findIndex(r => r.id === activeRowId))}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      if (filteredRows[idx]) handleJumpToSentence(filteredRows[idx].id);
                    }}
                    title="شريط التقديم والترجيع في الكتاب"
                    className="w-full"
                  />
                  <span className="text-xs font-mono font-bold opacity-80 whitespace-nowrap">
                    {filteredRows.length > 0 ? Math.max(1, filteredRows.findIndex(r => r.id === activeRowId) + 1) : 0} / {filteredRows.length}
                  </span>
                </div>

                {/* 3. Next Sentence */}
                <button
                  onClick={() => {
                    if (filteredRows.length === 0) return;
                    const idx = filteredRows.findIndex(r => r.id === activeRowId);
                    const targetIdx = idx < filteredRows.length - 1 ? idx + 1 : 0;
                    handleJumpToSentence(filteredRows[targetIdx].id);
                  }}
                  className="paper-action-btn"
                  title="الفقرة التالية"
                >
                  <span className="hidden sm:inline">التالي</span>
                  <i className="fa-solid fa-chevron-left text-xs"></i>
                </button>

                {/* Quick Theme Swatches */}
                <div className="hidden md:flex items-center gap-1.5 bg-black/30 p-1.5 rounded-full border border-white/10">
                  <button
                    type="button"
                    onClick={() => setTheme('obsidian')}
                    className={`theme-dot-btn theme-dot-obsidian ${theme === 'obsidian' ? 'active' : ''}`}
                    title="عقيق الليل"
                  />
                  <button
                    type="button"
                    onClick={() => setTheme('parchment')}
                    className={`theme-dot-btn theme-dot-parchment ${theme === 'parchment' ? 'active' : ''}`}
                    title="الورق العتيق"
                  />
                  <button
                    type="button"
                    onClick={() => setTheme('emerald')}
                    className={`theme-dot-btn theme-dot-emerald ${theme === 'emerald' ? 'active' : ''}`}
                    title="الزمرد الفاخر"
                  />
                  <button
                    type="button"
                    onClick={() => setTheme('matrix')}
                    className={`theme-dot-btn theme-dot-matrix ${theme === 'matrix' ? 'active' : ''}`}
                    title="سواد OLED المطلق"
                  />
                </div>

                {/* 4. Settings & Layout Popover Drawer Trigger */}
                <button
                  onClick={() => setShowSettings(true)}
                  className="paper-action-btn"
                  title="فتح لوحة إعدادات العرض والأنماط والخطوط"
                >
                  <i className="fa-solid fa-sliders text-sm"></i>
                  <span>الإعدادات</span>
                </button>
              </footer>

            </article>
          </div>
        </div>
      ) : (
        /* ================= MAIN APPLICATION LAYOUT ================= */
        <div className="app-container">
          {/* Ambient background glow orbs */}
          <div className="ambient-background">
            <div className="ambient-orb orb-1"></div>
            <div className="ambient-orb orb-2"></div>
          </div>

          {/* ================= HEADER ================= */}
          <aside className="header sidebar-shell" aria-label="التنقل الرئيسي">
            <div className="header-content">
              
              {/* Brand */}
              <button 
                onClick={() => setActiveTab('workspace')}
                className="header-brand"
              >
                <img src={customAppLogo} alt="Logo" className="header-brand-logo-img" />
                <div>
                  <div className="header-brand-title">محراب القراءة المتوازية</div>
                </div>
              </button>

              {/* Desktop Navigation */}
              <nav className="header-nav">
                <button
                  onClick={() => setActiveTab('workspace')}
                  className={`nav-item ${activeTab === 'workspace' ? 'active' : ''}`}
                >
                  <i className="fa-solid fa-pen-to-square"></i>
                  <span>إعداد النصوص</span>
                </button>

                <button
                  onClick={() => setActiveTab('library')}
                  className={`nav-item ${activeTab === 'library' ? 'active' : ''}`}
                >
                  <i className="fa-solid fa-lines-leaning"></i>
                  <span>المكتبة</span>
                </button>

                <button
                  onClick={() => setActiveTab('notebook')}
                  className={`nav-item ${activeTab === 'notebook' ? 'active' : ''}`}
                >
                  <i className="fa-solid fa-bookmark"></i>
                  <span>المفردات ({savedWords.length})</span>
                </button>
              </nav>

              <div className="tech-topstats mono" aria-label="مؤشرات">
                <span><i className="fa-solid fa-book" /> {books.length}</span>
                <span><i className="fa-solid fa-bookmark" /> {savedWords.length}</span>
                <span className="tech-saved"><span className="tech-dot ok" /> محفوظ محلياً</span>
              </div>

              <button className="tech-cmdk-hint" onClick={() => window.dispatchEvent(new Event('open-cmdk'))}>
                <i className="fa-solid fa-magnifying-glass"></i>
                <span>بحث وأوامر</span>
                <kbd>Ctrl K</kbd>
              </button>

              {/* Header Actions */}
              <div className="header-actions">
                {/* Theme switcher */}
                <div className="flex items-center gap-1 bg-black/30 p-1 rounded-xl border border-white/10">
                  <button
                    onClick={() => setTheme('obsidian')}
                    title="نمط العقيق الأسود"
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      theme === 'obsidian' ? 'bg-amber-600/40 text-amber-300' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <i className="fa-solid fa-moon text-xs"></i>
                  </button>
                  <button
                    onClick={() => setTheme('parchment')}
                    title="نمط المخطوطة العاجية"
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      theme === 'parchment' ? 'bg-amber-800/40 text-amber-300' : 'text-slate-400 hover:text-amber-200'
                    }`}
                  >
                    <i className="fa-solid fa-scroll text-xs"></i>
                  </button>
                  <button
                    onClick={() => setTheme('emerald')}
                    title="نمط الزمرد الأندلسي"
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      theme === 'emerald' ? 'bg-emerald-800/40 text-emerald-300' : 'text-slate-400 hover:text-emerald-200'
                    }`}
                  >
                    <i className="fa-solid fa-gem text-xs"></i>
                  </button>
                  <button
                    onClick={() => setTheme('matrix')}
                    title="Matrix Mode"
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      theme === 'matrix' ? 'bg-lime-500/30 text-lime-300' : 'text-slate-400 hover:text-lime-200'
                    }`}
                  >
                    <i className="fa-solid fa-terminal text-xs"></i>
                  </button>
                </div>
              </div>

            </div>
          </aside>

          {/* ================= MAIN CONTENT ================= */}
          <main className="main-content">

            {/* --- VIEW 1: TEXT WORKSPACE & START WORK ("بدء العمل") --- */}
            {activeTab === 'workspace' && (
              <div className="view-enter workspace-layout space-y-4">
                <div className="workspace-intro flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-[var(--editorial-border)] mb-2">
                  <div>
                    <h1 className="page-title gold-shimmer-text text-xl font-bold">إعداد النصوص</h1>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Auto-save status badge */}
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs border border-[var(--editorial-border)] bg-[var(--editorial-surface-2)] shadow-sm">
                      <i className={`fa-solid ${draftSavedAt ? 'fa-shield-halved text-emerald-400' : 'fa-pen-clip text-amber-300'} text-xs`}></i>
                      <span className="text-[var(--text-secondary)] font-serif text-xs">
                        {draftSavedAt 
                          ? 'المسودة محفوظة'
                          : (newArabicText.trim() || newEnglishText.trim() ? 'جارٍ الحفظ...' : 'مسودة جديدة')}
                      </span>
                    </div>

                    {(newArabicText.trim() || newEnglishText.trim() || newTitle.trim() || newAuthor.trim() || newBatchTitle.trim()) && (
                      <button
                        type="button"
                        onClick={handleClearDraft}
                        className="btn btn-secondary py-1 px-3 text-xs text-red-300 hover:text-red-100 hover:border-red-500/40"
                        title="تفريغ كافة الحقول والبدء من جديد"
                      >
                        <i className="fa-solid fa-trash-can text-[11px] ml-1"></i>
                        <span>تفريغ</span>
                      </button>
                    )}
                  </div>
                </div>
                
                {/* The Two Parallel Text Editors */}
                <div className="alignment-grid workspace-main">
                  {/* Arabic Input */}
                  <div className="alignment-editor">
                    <div className="alignment-editor-header">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-[var(--editorial-ivory)] text-sm">النص العربي</h3>
                      </div>
                      <button
                        onClick={() => setNewArabicText('')}
                        className="text-xs text-slate-400 hover:text-red-300"
                        title="مسح"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </div>
                    <textarea
                      rows={10}
                      value={newArabicText}
                      onChange={(e) => setNewArabicText(e.target.value)}
                      placeholder="الصق النص العربي هنا..."
                      className="form-textarea w-full text-ar leading-relaxed"
                    />

                    {/* Sentence & Paragraph Count Indicator */}
                    <div className="mt-2 pt-2 border-t border-[var(--editorial-border)] flex items-center justify-between text-xs gap-2">
                      <span className="text-[var(--editorial-muted)] font-medium">
                        {isDelimiterMode ? `${parsedArSentences.length} فقرة` : `${parsedArSentences.length} جملة`}
                      </span>
                      {newArabicText && (
                        <button
                          type="button"
                          onClick={() => setNewArabicText('')}
                          className="text-slate-400 hover:text-red-300 text-xs"
                        >
                          مسح
                        </button>
                      )}
                    </div>
                  </div>

                  {/* English Input */}
                  <div className="alignment-preview">
                    <div className="alignment-editor-header">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-[var(--editorial-ivory)] text-sm">النص الإنجليزي</h3>
                      </div>
                      <button
                        onClick={() => setNewEnglishText('')}
                        className="text-xs text-slate-400 hover:text-red-300"
                        title="مسح"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </div>
                    <textarea
                      rows={10}
                      value={newEnglishText}
                      onChange={(e) => setNewEnglishText(e.target.value)}
                      placeholder="Paste parallel English text here..."
                      className="form-textarea w-full text-en leading-relaxed"
                    />

                    {/* Sentence & Paragraph Count Indicator */}
                    <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-xs gap-2">
                      <span className="text-slate-400 font-medium">
                        {isDelimiterMode ? `${parsedEnSentences.length} فقرة` : `${parsedEnSentences.length} جملة`}
                      </span>
                      {newEnglishText && (
                        <button
                          type="button"
                          onClick={() => setNewEnglishText('')}
                          className="text-slate-400 hover:text-red-300 text-xs"
                        >
                          مسح
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Book Metadata & Delimiter Settings Card */}
                <div className="workspace-card workspace-context space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-white/10">
                    <h2 className="text-base font-bold text-white font-serif">إعدادات النص والتصنيف</h2>

                    {/* Mode Selector Switch */}
                    <div className="flex items-center gap-1 p-1 bg-black/40 rounded-xl border border-white/10">
                      <button
                        type="button"
                        onClick={() => setWorkspaceMode('new_book')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          workspaceMode === 'new_book' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        كتاب جديد
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setWorkspaceMode('append_batch');
                          if (!selectedTargetBookId && books.length > 0) {
                            setSelectedTargetBookId(books[0].id);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          workspaceMode === 'append_batch' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        إضافة لكتاب سابق
                      </button>
                    </div>
                  </div>

                  {/* Form fields based on Mode */}
                  {workspaceMode === 'append_batch' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="form-label text-amber-300 font-medium text-xs mb-1 block">اختر الكتاب</label>
                        <select
                          value={selectedTargetBookId}
                          onChange={(e) => setSelectedTargetBookId(e.target.value)}
                          className="form-input w-full font-serif text-sm bg-black/60"
                        >
                          {books.length === 0 ? (
                            <option value="">لا توجد كتب بالسجل</option>
                          ) : (
                            books.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.title} ({getBookBatchesSorted(b).length} دفعات)
                              </option>
                            ))
                          )}
                        </select>
                      </div>

                      <div>
                        <label className="form-label text-amber-300 font-medium text-xs mb-1 block">عنوان الدفعة الجديدة</label>
                        <input
                          type="text"
                          value={newBatchTitle}
                          onChange={(e) => setNewBatchTitle(e.target.value)}
                          placeholder="مثال: الفصل الثاني..."
                          className="form-input w-full text-sm"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="form-label text-xs mb-1 block">العنوان</label>
                        <input
                          type="text"
                          value={newTitle}
                          onChange={(e) => setNewTitle(e.target.value)}
                          placeholder="عنوان الكتاب..."
                          className="form-input w-full text-sm"
                        />
                      </div>
                      <div>
                        <label className="form-label text-xs mb-1 block">المؤلف</label>
                        <input
                          type="text"
                          value={newAuthor}
                          onChange={(e) => setNewAuthor(e.target.value)}
                          placeholder="اسم المؤلف أو المترجم..."
                          className="form-input w-full text-sm"
                        />
                      </div>
                    </div>
                  )}

                  {/* Delimiter & Split Bar */}
                  <div className="pt-2 border-t border-white/5 space-y-2">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <label className="text-xs text-[var(--editorial-muted)] shrink-0 font-medium">رمز الفصل:</label>
                        <input
                          type="text"
                          value={customDelimiter}
                          onChange={(e) => setCustomDelimiter(e.target.value)}
                          placeholder="اختياري (مثال: | أو #)..."
                          className="form-input text-xs font-mono py-1.5 px-3 bg-black/40 flex-1 min-w-0 w-full"
                        />
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setCustomDelimiter('|')}
                          className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                            customDelimiter === '|' ? 'bg-amber-600 text-white font-bold' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                          }`}
                        >
                          |
                        </button>
                        <button
                          type="button"
                          onClick={() => setCustomDelimiter('#')}
                          className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                            customDelimiter === '#' ? 'bg-amber-600 text-white font-bold' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                          }`}
                        >
                          #
                        </button>
                        <button
                          type="button"
                          onClick={() => setCustomDelimiter('~')}
                          className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                            customDelimiter === '~' ? 'bg-amber-600 text-white font-bold' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                          }`}
                        >
                          ~
                        </button>
                        <button
                          type="button"
                          onClick={() => setCustomDelimiter('')}
                          className={`px-2.5 py-1 rounded-md text-xs transition-all ${
                            !customDelimiter ? 'bg-amber-700 text-white font-bold' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                          }`}
                        >
                          تلقائي
                        </button>
                      </div>
                    </div>

                    {/* Minimal Balance Status Line */}
                    <div className="text-xs pt-1">
                      {isDelimiterMode ? (
                        arDelimiterCount === enDelimiterCount ? (
                          <span className="text-emerald-400 font-medium flex items-center gap-1">
                            <i className="fa-solid fa-circle-check text-[11px]"></i>
                            <span>متطابق: {parsedArSentences.length} فقرة متوازية</span>
                          </span>
                        ) : (
                          <span className="text-amber-300 font-medium flex items-center gap-1">
                            <i className="fa-solid fa-triangle-exclamation text-[11px]"></i>
                            <span>تفاوت في علامات الفصل: العربي ({arDelimiterCount}) — الإنجليزي ({enDelimiterCount})</span>
                          </span>
                        )
                      ) : (
                        parsedArSentences.length === parsedEnSentences.length ? (
                          <span className="text-emerald-400 font-medium flex items-center gap-1">
                            <i className="fa-solid fa-circle-check text-[11px]"></i>
                            <span>متطابق: {parsedArSentences.length} جملة متوازية</span>
                          </span>
                        ) : (
                          <span className="text-amber-300 font-medium flex items-center gap-1">
                            <i className="fa-solid fa-triangle-exclamation text-[11px]"></i>
                            <span>تفاوت الجمل: العربي ({parsedArSentences.length}) — الإنجليزي ({parsedEnSentences.length})</span>
                          </span>
                        )
                      )}
                    </div>
                  </div>

                  {/* Primary Action Button */}
                  <div className="flex items-center justify-center pt-2">
                    <button
                      onClick={handleAutoAlign}
                      disabled={!newArabicText.trim() || !newEnglishText.trim() || isAligning}
                      className="btn-start-action"
                    >
                      <i className={`fa-solid ${isAligning ? 'fa-spinner fa-spin' : 'fa-play'}`}></i>
                      <span>بدء القراءة</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* --- VIEW 3: VOCABULARY NOTEBOOK & SPACED REPETITION REVIEW --- */}
            {activeTab === 'notebook' && (
              <div className="view-enter notebook-layout">
                {/* Header & Quick Action */}
                <div className="flex items-center justify-between flex-wrap gap-4 notebook-header">
                  <div>
                    <div className="illuminated-crest">كناشة القارئ والمفردات</div>
                    <h2 className="section-title gold-shimmer-text">حافظة المفردات والمراجعة ({savedWords.length})</h2>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => setShowAddWordModal(true)}
                      className="btn btn-secondary text-amber-300 hover:text-white"
                      title="إضافة مفردة جديدة يدوياً"
                    >
                      <i className="fa-solid fa-plus"></i>
                      <span>إضافة مفردة</span>
                    </button>

                    {savedWords.length > 0 && (
                      <>
                        <button
                          onClick={() => startReviewSession('flashcard')}
                          className="btn btn-primary shadow-lg shadow-amber-950/40"
                          title="مراجعة المفردات بنظام التكرار المتباعد"
                        >
                          <i className="fa-solid fa-layer-group"></i>
                          <span>البطاقات الذكية</span>
                          {dueWords.length > 0 && (
                            <span className="bg-amber-400 text-black text-[11px] font-bold px-1.5 py-0.5 rounded-full mr-1">
                              {dueWords.length}
                            </span>
                          )}
                        </button>

                        <button
                          onClick={() => startReviewSession('matching')}
                          className="btn bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white"
                          title="لعبة ربط ومطابقة الكلمات والمعاني"
                        >
                          <i className="fa-solid fa-puzzle-piece"></i>
                          <span>لعبة المطابقة</span>
                        </button>

                        <button
                          onClick={() => startReviewSession('quiz')}
                          className="btn btn-secondary text-amber-300 hover:text-white"
                          title="اختبار التسميع السريع بالاختيار من متعدد"
                        >
                          <i className="fa-solid fa-list-check"></i>
                          <span>اختبار التسميع</span>
                        </button>

                        <button
                          onClick={() => startReviewSession('recall')}
                          className="btn btn-secondary text-amber-300 hover:text-white"
                          title="اختبار الإملاء والكتابة"
                        >
                          <i className="fa-solid fa-keyboard"></i>
                          <span>اختبار الكتابة</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Vocabulary Tools Bar */}
                <div className="flex items-center justify-between flex-wrap gap-2 p-2.5 rounded-2xl bg-[var(--editorial-surface-2)] border border-[var(--editorial-border)] text-xs text-[var(--editorial-muted)] notebook-tools">
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-toolbox text-amber-400"></i>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={handleExportVocabulary}
                      className="hover:text-[var(--editorial-ivory)] transition-colors flex items-center gap-1 bg-white/5 py-1 px-2.5 rounded-lg border border-white/5"
                      title="تصدير جميع المفردات كملف JSON للنسخ الاحتياطي"
                    >
                      <i className="fa-solid fa-download text-amber-300"></i>
                      <span>تصدير (Backup)</span>
                    </button>

                    <label
                      className="hover:text-[var(--editorial-ivory)] transition-colors flex items-center gap-1 bg-white/5 py-1 px-2.5 rounded-lg border border-white/5 cursor-pointer"
                      title="استيراد مفردات من ملف JSON"
                    >
                      <i className="fa-solid fa-file-import text-amber-300"></i>
                      <span>استيراد</span>
                      <input
                        type="file"
                        accept=".json"
                        onChange={handleImportVocabulary}
                        className="hidden"
                      />
                    </label>

                    <button
                      onClick={handleRemoveDuplicates}
                      className="hover:text-[var(--editorial-ivory)] transition-colors flex items-center gap-1 bg-white/5 py-1 px-2.5 rounded-lg border border-white/5"
                      title="تنظيف المفردات المكررة"
                    >
                      <i className="fa-solid fa-broom text-amber-300"></i>
                      <span>حذف المكرر</span>
                    </button>

                    <button
                      onClick={handleResetSrsSchedule}
                      className="hover:text-[var(--editorial-ivory)] transition-colors flex items-center gap-1 bg-white/5 py-1 px-2.5 rounded-lg border border-white/5 text-amber-300"
                      title="إعادة المواعيد لتصبح جميع البطاقات مستحقة الآن"
                    >
                      <i className="fa-solid fa-rotate text-amber-400"></i>
                      <span>تصفير المواعيد</span>
                    </button>
                  </div>
                </div>

                {/* Vocabulary Review Stats Dashboard */}
                {savedWords.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 notebook-summary">
                    <div className="interleaved-card p-3 text-center">
                      <div className="text-xs text-slate-400 mb-1">إجمالي المفردات</div>
                      <div className="text-xl font-bold font-serif text-[var(--editorial-ivory)]">{savedWords.length}</div>
                    </div>
                    
                    <div 
                      onClick={() => setVocabFilter('due')}
                      className={`interleaved-card p-3 text-center cursor-pointer transition-all ${
                        vocabFilter === 'due' ? 'border-amber-500/50 bg-amber-950/20 ring-1 ring-amber-500/30' : 'hover:border-amber-500/30'
                      }`}
                    >
                      <div className="text-xs text-amber-300/90 mb-1 flex items-center justify-center gap-1">
                        <i className="fa-solid fa-clock-rotate-left text-xs"></i>
                        <span>مستحقة للمراجعة</span>
                      </div>
                      <div className="text-xl font-bold font-serif text-amber-300">{dueWords.length}</div>
                    </div>

                    <div 
                      onClick={() => setVocabFilter('learning')}
                      className={`interleaved-card p-3 text-center cursor-pointer transition-all ${
                        vocabFilter === 'learning' ? 'border-amber-500/50 bg-amber-950/20 ring-1 ring-amber-500/30' : 'hover:border-amber-500/30'
                      }`}
                    >
                      <div className="text-xs text-amber-300/90 mb-1 flex items-center justify-center gap-1">
                        <i className="fa-solid fa-seedling text-xs"></i>
                        <span>قيد التعلّم</span>
                      </div>
                      <div className="text-xl font-bold font-serif text-amber-300">{learningWords.length}</div>
                    </div>

                    <div 
                      onClick={() => setVocabFilter('mastered')}
                      className={`interleaved-card p-3 text-center cursor-pointer transition-all ${
                        vocabFilter === 'mastered' ? 'border-emerald-500/50 bg-emerald-950/20 ring-1 ring-emerald-500/30' : 'hover:border-emerald-500/30'
                      }`}
                    >
                      <div className="text-xs text-emerald-300/90 mb-1 flex items-center justify-center gap-1">
                        <i className="fa-solid fa-circle-check text-xs"></i>
                        <span>متقنة</span>
                      </div>
                      <div className="text-xl font-bold font-serif text-emerald-300">{masteredWords.length}</div>
                    </div>
                  </div>
                )}

                {/* Search & Filter Controls */}
                {savedWords.length > 0 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 library-controls p-3 notebook-filters">
                    {/* Search Input */}
                    <div className="relative flex-1 w-full">
                      <input
                        type="text"
                        value={vocabSearch}
                        onChange={(e) => setVocabSearch(e.target.value)}
                        placeholder="ابحث في الكلمات أو المعاني أو الملاحظات..."
                        className="search-box w-full text-sm py-2"
                      />
                      {vocabSearch && (
                        <button
                          onClick={() => setVocabSearch('')}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        >
                          <i className="fa-solid fa-xmark text-xs"></i>
                        </button>
                      )}
                    </div>

                    {/* Filter Tabs */}
                    <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto">
                      <button
                        onClick={() => setVocabFilter('all')}
                        className={`preset-chip py-1.5 px-3 text-xs ${vocabFilter === 'all' ? 'btn-primary text-white' : ''}`}
                      >
                        الكل ({savedWords.length})
                      </button>
                      <button
                        onClick={() => setVocabFilter('due')}
                        className={`preset-chip py-1.5 px-3 text-xs ${vocabFilter === 'due' ? 'btn-primary text-white' : ''}`}
                      >
                        للمراجعة ({dueWords.length})
                      </button>
                      <button
                        onClick={() => setVocabFilter('learning')}
                        className={`preset-chip py-1.5 px-3 text-xs ${vocabFilter === 'learning' ? 'btn-primary text-white' : ''}`}
                      >
                        قيد التعلّم ({learningWords.length})
                      </button>
                      <button
                        onClick={() => setVocabFilter('mastered')}
                        className={`preset-chip py-1.5 px-3 text-xs ${vocabFilter === 'mastered' ? 'btn-primary text-white' : ''}`}
                      >
                        متقنة ({masteredWords.length})
                      </button>
                    </div>
                  </div>
                )}

                {/* Empty State or Cards Grid */}
                {savedWords.length === 0 ? (
                  <div className="interleaved-card text-center py-16 space-y-4">
                    <div className="w-16 h-16 rounded-full bg-amber-900/30 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-300 text-2xl shadow-lg shadow-amber-950/50">
                      <i className="fa-solid fa-bookmark"></i>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold font-serif text-[var(--editorial-ivory)]">دفتر المفردات فارغ</h3>
                    </div>
                    <div className="pt-2">
                      <button
                        onClick={() => setShowAddWordModal(true)}
                        className="btn btn-primary px-6"
                      >
                        <i className="fa-solid fa-plus ml-1"></i>
                        <span>إضافة أول مفردة الآن</span>
                      </button>
                    </div>
                  </div>
                ) : filteredSavedWords.length === 0 ? (
                  <div className="interleaved-card text-center py-12">
                    <p className="text-slate-400 text-sm">لا توجد نتائج</p>
                  </div>
                ) : (
                  /* Cards Grid */
                  <div className="vocab-list vocab-grid-mode">
                    {filteredSavedWords.map((item) => {
                      const level = item.level ?? 0;
                      const isMastered = item.mastered || level >= 3;
                      const isDue = !item.nextReviewAt || item.nextReviewAt <= Date.now();

                      return (
                        <div key={item.id} className="vocab-card relative flex flex-col justify-between">
                          <div>
                            {/* Card Top Header */}
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="text-xl font-bold font-serif text-[var(--editorial-ivory)] tracking-wide">{item.word}</h4>
                                  <span className="text-[10px] text-amber-300/80 bg-amber-950/60 border border-amber-500/30 px-1.5 py-0.5 rounded">
                                    {item.direction === 'ar-en' ? 'عربي ➔ E' : 'English ➔ ع'}
                                  </span>
                                </div>
                                {item.bookTitle && (
                                  <span className="text-[11px] text-slate-500 line-clamp-1 mt-0.5 flex items-center gap-1">
                                    <i className="fa-solid fa-book-open text-[10px] text-amber-400"></i>
                                    <span>{item.bookTitle}</span>
                                  </span>
                                )}
                              </div>

                              {/* Action buttons */}
                              <details className="vocab-actions-menu">
                                <summary title="إجراءات المفردة" aria-label="إجراءات المفردة">
                                  <i className="fa-solid fa-ellipsis"></i>
                                </summary>
                                <div className="vocab-actions-popover">
                                <button
                                  onClick={() => handleOpenEditWordModal(item)}
                                  className="btn btn-ghost py-1 px-2 text-xs text-slate-400 hover:text-amber-300"
                                  title="تعديل الملاحظات والمعاني"
                                >
                                  <i className="fa-solid fa-pen-to-square"></i>
                                </button>

                                <button
                                  onClick={() => handleToggleMastered(item.id)}
                                  className={`btn btn-ghost py-1 px-2 text-xs ${
                                    isMastered ? 'text-emerald-400 hover:text-emerald-300' : 'text-slate-500 hover:text-amber-300'
                                  }`}
                                  title={isMastered ? 'إلغاء الإتقان وإعادتها للمراجعة' : 'تحديد كمتقنة ⭐'}
                                >
                                  <i className={`fa-solid ${isMastered ? 'fa-star text-amber-400' : 'fa-star'}`}></i>
                                </button>

                                <button
                                  onClick={() => handleToggleSaveWord(item)}
                                  className="btn btn-ghost py-1 px-2 text-xs text-slate-500 hover:text-red-400"
                                  title="حذف من المفردات"
                                >
                                  <i className="fa-solid fa-trash"></i>
                                </button>
                                </div>
                              </details>
                            </div>

                            {/* Meanings */}
                            <div className="pt-2 pb-2.5 border-t border-white/5">
                              <div className="flex flex-wrap gap-1.5">
                                {item.meanings.map((m, i) => (
                                  <span key={i} className="btn btn-secondary py-0.5 px-2.5 text-xs text-amber-200">
                                    {m}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Context Sentence or Notes */}
                            {item.notes && (
                              <div className="text-[11.5px] text-slate-300 bg-black/25 p-2 rounded-xl border border-white/5 mb-2.5 leading-relaxed">
                                <i className="fa-solid fa-sticky-note text-amber-400 ml-1 text-[11px]"></i>
                                <span>{item.notes}</span>
                              </div>
                            )}
                          </div>

                          {/* Spaced Repetition Footer */}
                          <div className="pt-2.5 border-t border-white/5 flex items-center justify-between text-xs mt-1 flex-wrap gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`vocab-level-badge level-badge-${Math.min(3, level)}`}>
                                {isMastered ? (
                                  <>
                                    <i className="fa-solid fa-circle-check text-xs"></i>
                                    <span>متقنة</span>
                                  </>
                                ) : level === 2 ? (
                                  <>
                                    <i className="fa-solid fa-layer-group text-xs"></i>
                                    <span>مألوفة</span>
                                  </>
                                ) : level === 1 ? (
                                  <>
                                    <i className="fa-solid fa-seedling text-xs"></i>
                                    <span>قيد التعلّم</span>
                                  </>
                                ) : (
                                  <>
                                    <i className="fa-solid fa-sparkles text-xs"></i>
                                    <span>جديدة</span>
                                  </>
                                )}
                              </span>

                              {(() => {
                                const dueInfo = getRelativeNextReview(item.nextReviewAt);
                                return (
                                  <span className={`text-[10px] px-2 py-0.5 rounded-md border flex items-center gap-1 font-semibold ${dueInfo.color}`}>
                                    <i className={`fa-solid ${dueInfo.isDue ? 'fa-bell text-[9px]' : 'fa-clock text-[9px]'}`}></i>
                                    <span>{dueInfo.label}</span>
                                  </span>
                                );
                              })()}

                              {item.easinessFactor && (
                                <span className="text-[10px] text-slate-400 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded" title="معامل سهولة الذاكرة SM-2">
                                  EF {item.easinessFactor.toFixed(1)}
                                </span>
                              )}
                            </div>

                            <button
                              onClick={() => startReviewSession('flashcard', [item])}
                              className="text-amber-300 hover:text-white text-xs flex items-center gap-1 py-1 px-2.5 rounded-lg hover:bg-amber-900/30 transition-all border border-amber-500/20 shadow-sm"
                            >
                              <i className="fa-solid fa-play text-[10px]"></i>
                              <span>مراجعة المفردة</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* --- VIEW 4: LIBRARY --- */}
            {activeTab === 'library' && (
              <div className="view-enter library-layout space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3 library-heading mb-2 pb-3 border-b border-[var(--editorial-border)]">
                  <div>
                    <h2 className="section-title gold-shimmer-text text-xl font-bold">المكتبة ({books.length})</h2>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Full Backup Export */}
                    <button
                      type="button"
                      onClick={handleExportFullBackup}
                      className="btn btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5"
                      title="تصدير نسخة احتياطية (JSON)"
                    >
                      <i className="fa-solid fa-download text-amber-300"></i>
                      <span>تصدير</span>
                    </button>

                    {/* Full Backup Import */}
                    <label
                      className="btn btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5 cursor-pointer"
                      title="استعادة نسخة من ملف JSON"
                    >
                      <i className="fa-solid fa-upload text-amber-300"></i>
                      <span>استعادة</span>
                      <input
                        type="file"
                        accept=".json"
                        onChange={handleImportFullBackup}
                        className="hidden"
                      />
                    </label>

                    <button
                      onClick={() => setActiveTab('workspace')}
                      className="btn btn-primary py-1.5 px-3 text-xs flex items-center gap-1.5"
                    >
                      <i className="fa-solid fa-plus"></i>
                      <span>نص جديد</span>
                    </button>
                  </div>
                </div>

                {/* Library Search */}
                {books.length > 0 && (
                  <div className="library-controls library-context my-2">
                    <input
                      type="text"
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      placeholder="ابحث في عناوين الكتب أو المؤلفين..."
                      className="search-box w-full"
                    />
                  </div>
                )}

                {/* Books Grid & Empty State */}
                {filteredBooks.length === 0 ? (
                  <div className="interleaved-card text-center py-16 space-y-4">
                    <div className="w-16 h-16 rounded-full bg-amber-900/30 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-300 text-2xl">
                      <i className="fa-solid fa-book-open"></i>
                    </div>
                    <h3 className="text-lg font-bold text-[var(--editorial-ivory)] font-serif">المكتبة فارغة</h3>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      لم تقم بإنشاء أية كتب بعد.
                    </p>
                    <div className="pt-2">
                      <button
                        onClick={() => setActiveTab('workspace')}
                        className="btn btn-primary px-6 py-2"
                      >
                        <i className="fa-solid fa-plus ml-1.5"></i>
                        <span>إعداد نص جديد</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {/* Featured Book Spotlight when not searching and activeHeroBook exists */}
                    {!searchFilter.trim() && activeHeroBook && (() => {
                      const heroAllRows = getBookAllRowsSorted(activeHeroBook);
                      const heroSavedRowId = activeHeroBook.lastReadRowId || localStorage.getItem(`pr_last_row_${activeHeroBook.id}`);
                      const heroRowIdx = heroSavedRowId ? Math.max(0, heroAllRows.findIndex(r => r.id === heroSavedRowId)) : 0;
                      const heroProgressPct = heroAllRows.length > 0 ? Math.round(((heroRowIdx + 1) / heroAllRows.length) * 100) : 0;

                      return (
                        <div className="hero-book-spotlight mb-4">
                          <div className="hero-spotlight-content">
                            {/* Cover */}
                            <div 
                              onClick={() => openBookForReading(activeHeroBook)}
                              className="hero-spotlight-cover group cursor-pointer"
                              title="انقر لاستئناف القراءة"
                            >
                              <div className="book-spine-spine" />
                              {activeHeroBook.coverImage ? (
                                <img
                                  src={activeHeroBook.coverImage}
                                  alt={activeHeroBook.title}
                                  className="w-full h-full object-cover rounded"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="flex flex-col justify-between h-full p-1 text-center">
                                  <span className="book-cover-monogram">{activeHeroBook.title.slice(0, 1)}</span>
                                  <div className="book-cover-title line-clamp-2 text-xs">{activeHeroBook.title}</div>
                                  <div className="book-cover-author line-clamp-1 text-[10px]">{activeHeroBook.author || 'مؤلف مخصص'}</div>
                                </div>
                              )}
                            </div>

                            {/* Info & Details */}
                            <div className="flex-1 min-w-0">
                              <h3 className="hero-spotlight-title text-lg font-bold">{activeHeroBook.title}</h3>
                              <p className="hero-spotlight-author text-xs text-slate-400 mb-2">{activeHeroBook.author || 'مؤلف غير محدد'}</p>

                              {/* Progress Bar */}
                              <div className="hero-spotlight-progress-wrap my-2">
                                <div className="flex items-center justify-between text-xs text-[var(--editorial-muted)] mb-1">
                                  <span>الفقرة {heroRowIdx + 1} من {heroAllRows.length} ({formatLastRead(activeHeroBook.lastReadAt)})</span>
                                  <span className="font-mono font-bold text-amber-300">{heroProgressPct}%</span>
                                </div>
                                <div className="book-progress-bar-bg">
                                  <div className="book-progress-bar-fill" style={{ width: `${Math.max(4, heroProgressPct)}%` }} />
                                </div>
                              </div>

                              {/* Action Buttons */}
                              <div className="hero-spotlight-actions flex items-center gap-2 mt-3">
                                <button
                                  onClick={() => openBookForReading(activeHeroBook)}
                                  className="btn-hero-resume flex-1 text-sm py-2"
                                  title="استئناف القراءة"
                                >
                                  <i className="fa-solid fa-book-open"></i>
                                  <span>استئناف القراءة</span>
                                </button>

                                <button
                                  onClick={() => handleOpenBatchesModal(activeHeroBook)}
                                  className="btn btn-secondary text-xs py-2"
                                  title="إدارة الدفعات وتعديل البيانات"
                                >
                                  <i className="fa-solid fa-layer-group text-amber-400 ml-1"></i>
                                  <span>خيارات الكتاب</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Section heading for other books if spotlight is shown and other books exist */}
                    {!searchFilter.trim() && otherBooks.length > 0 && (
                      <div className="mb-3 pt-2 border-t border-[var(--editorial-border)] flex items-center justify-between">
                        <h3 className="text-sm font-bold text-[var(--editorial-ivory)]">
                          بقية الكتب ({otherBooks.length})
                        </h3>
                      </div>
                    )}

                    {/* Grid of books */}
                    <div className="library-book-grid">
                      {(searchFilter.trim() ? filteredBooks : otherBooks).map((book) => {
                        const allRows = getBookAllRowsSorted(book);
                        const savedRowId = book.lastReadRowId || localStorage.getItem(`pr_last_row_${book.id}`);
                        const rowIdx = savedRowId ? Math.max(0, allRows.findIndex(r => r.id === savedRowId)) : 0;
                        const progressPct = allRows.length > 0 ? Math.round(((rowIdx + 1) / allRows.length) * 100) : 0;

                        return (
                          <div
                            key={book.id}
                            onClick={() => openBookForReading(book)}
                            className="book-card-editorial group cursor-pointer"
                          >
                            {/* Vertical Book Cover (2:3 Aspect Ratio) */}
                            <div className="book-cover-portrait relative overflow-hidden rounded-lg shadow-md group shrink-0">
                              <div className="book-spine-spine" />
                              {book.coverImage ? (
                                <img
                                  src={book.coverImage}
                                  alt={book.title}
                                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="book-cover-inner flex flex-col justify-between h-full p-2 text-center">
                                  <span className="book-cover-monogram">{book.title.slice(0, 1)}</span>
                                  <div className="book-cover-title line-clamp-2 text-xs font-serif font-bold text-[var(--editorial-ivory)]">{book.title}</div>
                                  <div className="book-cover-author line-clamp-1 text-[10px] text-[var(--editorial-muted)]">{book.author || 'مؤلف مخصص'}</div>
                                </div>
                              )}
                            </div>

                            {/* Editorial Details - Reordered Clean Hierarchy */}
                            <div className="book-editorial-details min-w-0 flex-1 flex flex-col justify-between self-stretch">
                              {/* 1. Header: Title & Options Menu */}
                              <div>
                                <div className="flex items-start justify-between gap-1.5 mb-1">
                                  <h3 className="book-editorial-title line-clamp-2 text-sm font-bold font-serif text-[var(--editorial-ivory)] leading-snug">
                                    {book.title}
                                  </h3>

                                  {/* Options Menu ⋯ */}
                                  <details className="book-options-menu shrink-0" onClick={(e) => e.stopPropagation()}>
                                    <summary title="خيارات الكتاب" aria-label="خيارات الكتاب">
                                      <i className="fa-solid fa-ellipsis-vertical text-xs"></i>
                                    </summary>
                                    <div className="book-options-popover">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenEditBookModal(book);
                                        }}
                                        className="btn btn-ghost text-amber-200 hover:text-white hover:bg-white/10 w-full text-right py-1.5 px-3 text-xs"
                                      >
                                        <i className="fa-solid fa-pen-to-square ml-1.5 text-xs text-amber-400"></i>
                                        <span>تعديل بيانات الكتاب</span>
                                      </button>

                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenBatchesModal(book);
                                        }}
                                        className="btn btn-ghost text-amber-200 hover:text-white hover:bg-white/10 w-full text-right py-1.5 px-3 text-xs"
                                      >
                                        <i className="fa-solid fa-layer-group ml-1.5 text-xs text-amber-400"></i>
                                        <span>إدارة دفعات النصوص</span>
                                      </button>

                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenWorkspaceForBatchAppend(book);
                                        }}
                                        className="btn btn-ghost text-emerald-300 hover:text-white hover:bg-white/10 w-full text-right py-1.5 px-3 text-xs"
                                      >
                                        <i className="fa-solid fa-plus-circle ml-1.5 text-xs text-emerald-400"></i>
                                        <span>إضافة دفعة جديدة</span>
                                      </button>

                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteBook(book.id);
                                        }}
                                        className="btn btn-ghost text-red-300 hover:text-red-100 hover:bg-red-900/40 w-full text-right py-1.5 px-3 text-xs border-t border-white/10 mt-1 pt-2"
                                      >
                                        <i className="fa-solid fa-trash-can ml-1.5 text-xs"></i>
                                        <span>حذف الكتاب</span>
                                      </button>
                                    </div>
                                  </details>
                                </div>

                                {/* 2. Author Name */}
                                <p className="book-editorial-author text-xs text-slate-400 line-clamp-1 mb-2">
                                  {book.author || 'مؤلف غير محدد'}
                                </p>
                              </div>

                              {/* 3. Reading Progress & Metadata */}
                              <div className="pt-2 border-t border-white/5 space-y-1.5 mt-auto">
                                <div className="flex items-center justify-between text-[11px] text-[var(--editorial-muted)]">
                                  <span>{allRows.length} فقرة · {formatLastRead(book.lastReadAt)}</span>
                                  <span className="font-mono font-bold text-amber-300">{progressPct}%</span>
                                </div>
                                <div className="book-progress-bar-bg">
                                  <div className="book-progress-bar-fill" style={{ width: `${Math.max(4, progressPct)}%` }} />
                                </div>

                                {/* 4. Primary Action Button */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openBookForReading(book);
                                  }}
                                  className="btn btn-primary w-full text-xs py-1.5 mt-2 flex items-center justify-center gap-1.5"
                                >
                                  <i className="fa-solid fa-book-open text-xs"></i>
                                  <span>متابعة القراءة</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

          </main>

          <nav className="tech-activitybar" aria-label="شريط الأنشطة">
            {([
              ['workspace', 'fa-pen-to-square', 'إعداد النصوص'],
              ['library', 'fa-folder-tree', 'المكتبة'],
              ['notebook', 'fa-bookmark', 'المفردات'],
            ] as const).map(([t, icon, label]) => (
              <button
                key={t}
                title={label}
                aria-label={label}
                onClick={() => setActiveTab(t)}
                className={`tech-act-btn ${activeTab === t ? 'active' : ''}`}
              >
                <i className={`fa-solid ${icon}`} />
                {t === 'notebook' && savedWords.length > 0 && <span className="tech-act-badge">{savedWords.length}</span>}
              </button>
            ))}
            <span className="tech-act-spacer" />
            <button title="بحث وأوامر (Ctrl+K)" aria-label="بحث وأوامر" className="tech-act-btn" onClick={() => window.dispatchEvent(new Event('open-cmdk'))}>
              <i className="fa-solid fa-magnifying-glass" />
            </button>
            <button
              title="تبديل المظهر"
              aria-label="تبديل المظهر"
              className="tech-act-btn"
              onClick={() => setTheme(theme === 'parchment' ? 'obsidian' : 'parchment')}
            >
              <i className={`fa-solid ${theme === 'parchment' ? 'fa-moon' : 'fa-sun'}`} />
            </button>
          </nav>
          <TechCommandPalette
            books={books.map((b: any) => ({ id: String(b.id), title: String(b.title ?? b.name ?? 'كتاب') }))}
            onTab={setActiveTab}
            onTheme={(t) => setTheme(t as ReadingTheme)}
          />

          {/* ================= MOBILE BOTTOM NAVIGATION ================= */}
          <nav className="mobile-bottom-nav">
            <div className="mobile-nav-grid">
              <button
                onClick={() => setActiveTab('workspace')}
                className={`mobile-nav-btn ${activeTab === 'workspace' ? 'active' : ''}`}
              >
                <i className="fa-solid fa-pen-to-square"></i>
                <span>إعداد النصوص</span>
              </button>

              <button
                onClick={() => setActiveTab('library')}
                className={`mobile-nav-btn ${activeTab === 'library' ? 'active' : ''}`}
              >
                <i className="fa-solid fa-lines-leaning"></i>
                <span>المكتبة</span>
              </button>

              <button
                onClick={() => setActiveTab('notebook')}
                className={`mobile-nav-btn ${activeTab === 'notebook' ? 'active' : ''}`}
              >
                <i className="fa-solid fa-bookmark"></i>
                <span>المفردات</span>
              </button>
            </div>
          </nav>
        </div>
      )}

      {/* ================= FLOATING LOCAL DICTIONARY & CONTEXT CARD ================= */}
      {selectedWord && (
        <>
          <div
            className="smart-lexicon-backdrop"
            onClick={() => setSelectedWord(null)}
            aria-label="إغلاق نافذة الترجمة"
          />
          <div className="smart-lexicon-floating" role="dialog" aria-modal="true">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 mb-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xl font-bold font-serif text-[var(--editorial-ivory)]">{selectedWord.word}</h3>
                {selectedWord.root && (
                  <span className="text-[11px] font-mono text-amber-300 bg-amber-950/40 border border-amber-500/30 px-2 py-0.5 rounded-md" title="الجذر/الأصل المعجمي">
                    الأصل: {selectedWord.root}
                  </span>
                )}
                {selectedWord.isPhrasalVerb && (
                  <span className="text-[11px] font-semibold text-emerald-300 bg-emerald-950/60 border border-emerald-500/40 px-2 py-0.5 rounded-md flex items-center gap-1" title="تم التعرف عليه كفعل مركب من عدة كلمات">
                    <i className="fa-solid fa-layer-group text-[10px]"></i>
                    فعل مركب (Phrasal Verb)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                {(selectedWord.aiExactMatch || selectedWord.meanings.length > 0) && (
                  <button
                    onClick={() => handleCopyMeanings(
                      [
                        selectedWord.aiExactMatch ? `[سياق]: ${selectedWord.aiExactMatch}` : '',
                        ...selectedWord.meanings
                      ].filter(Boolean).join(', ')
                    )}
                    className="btn btn-ghost py-1 px-2 text-xs text-amber-300 hover:text-white"
                    title="نسخ الترجمة"
                  >
                    <i className={`fa-solid ${copyFeedback ? 'fa-check text-emerald-400' : 'fa-copy'}`}></i>
                    {copyFeedback && <span className="text-xs mr-1 text-emerald-400 font-sans">تم</span>}
                  </button>
                )}
                <button
                  onClick={() => handleToggleSaveWord({
                    word: selectedWord.word,
                    meanings: [
                      ...(selectedWord.aiExactMatch ? [selectedWord.aiExactMatch] : []),
                      ...selectedWord.meanings
                    ],
                    direction: selectedWord.direction
                  })}
                  className={`btn ${isWordSaved(selectedWord.word) ? 'btn-primary' : 'btn-secondary'} py-1 px-2.5 text-xs`}
                  title={isWordSaved(selectedWord.word) ? 'محفوظة' : 'حفظ'}
                >
                  <i className={`fa-solid ${isWordSaved(selectedWord.word) ? 'fa-check' : 'fa-bookmark'}`}></i>
                  <span className="mr-1 hidden sm:inline">{isWordSaved(selectedWord.word) ? 'محفوظة' : 'حفظ'}</span>
                </button>
                <button
                  onClick={() => setSelectedWord(null)}
                  className="btn btn-ghost py-1 px-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg"
                  title="إغلاق النافذة"
                >
                  <i className="fa-solid fa-xmark text-sm"></i>
                </button>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-white/10">
              {/* 1. LOCAL DICTIONARY DIRECT TRANSLATION SECTION */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <i className="fa-solid fa-book-bookmark text-amber-400 text-xs"></i>
                    <span>الترجمة المباشرة (المعجم المحلي):</span>
                  </span>
                  {selectedWord.direction && (
                    <span className="text-[10px] text-amber-300 bg-amber-950/60 border border-amber-500/20 px-2 py-0.5 rounded">
                      {selectedWord.direction === 'ar-en' ? 'عربي ➔ إنجليزي' : 'إنجليزي ➔ عربي'}
                    </span>
                  )}
                </div>

                {selectedWord.loading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                    <i className="fa-solid fa-spinner fa-spin text-amber-400"></i>
                    <span>جارٍ الاستعلام من المعجم المحلي...</span>
                  </div>
                ) : selectedWord.meanings.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {selectedWord.meanings.map((m, idx) => (
                      <span
                        key={idx}
                        className="py-1 px-3 text-sm text-amber-100 bg-[var(--editorial-surface-2)] border border-[var(--editorial-border)] rounded-lg font-medium shadow-sm"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 text-center bg-white/5 border border-white/10 rounded-xl text-slate-400 text-xs flex items-center justify-center gap-2">
                    <i className="fa-solid fa-circle-exclamation text-amber-400 text-sm"></i>
                    <span>لم يُعثر على ترجمة لهذه الكلمة في المعجم المحلي.</span>
                  </div>
                )}
              </div>

              {/* 2. REAL EXAMPLE SENTENCES SECTION */}
              {selectedWord.examples && selectedWord.examples.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <i className="fa-solid fa-quote-right text-amber-400 text-xs"></i>
                    <span>جمل وتطبيقات سياقية:</span>
                  </div>
                  <div className="space-y-2">
                    {selectedWord.examples.map((ex, idx) => (
                      <div key={idx} className="p-2.5 rounded-xl bg-black/25 border border-white/5 space-y-1 text-xs">
                        <p className="text-ar font-serif text-amber-200 leading-relaxed">
                          {ex.arabic}
                        </p>
                        <p className="text-en text-slate-400 leading-normal">
                          {ex.english}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. PARALLEL TEXT MATCH (WHEN AVAILABLE) */}
              {(selectedWord.aiExactMatch || selectedWord.aiLoading) && (
                <div className="ai-translation-box rounded-xl p-2.5 bg-black/20 border border-white/10 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="ai-tag-badge bg-gradient-to-r from-amber-900/80 via-amber-900/80 to-amber-900/80 border border-amber-400/25 text-amber-100 flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-medium">
                      <i className="fa-solid fa-wand-magic-sparkles text-[10px] text-amber-300"></i>
                      <span>المطابقة في النص المقابل</span>
                    </span>

                    {selectedWord.aiLoading ? (
                      <span className="text-[10px] text-amber-200/80 flex items-center gap-1">
                        <i className="fa-solid fa-spinner fa-spin text-xs text-amber-300"></i>
                        <span>مطابقة النص...</span>
                      </span>
                    ) : selectedWord.aiExactMatch ? (
                      <div className="flex items-baseline gap-2 flex-wrap text-xs">
                        <span className="text-slate-400">المقابل النصي:</span>
                        <span className="ai-matched-word font-bold text-amber-200 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                          {selectedWord.aiExactMatch}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ================= COMPREHENSIVE VOCABULARY REVIEW MODAL ================= */}
      {showReviewModal && reviewQueue.length > 0 && (
        <div className="modal-overlay active review-modal-overlay" onClick={() => setShowReviewModal(false)}>
          <div className="modal-card max-w-xl review-modal-card" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="modal-header">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-900/40 border border-amber-500/30 flex items-center justify-center text-amber-300">
                  <i className="fa-solid fa-graduation-cap text-sm"></i>
                </div>
                <div>
                  <h2 className="text-base font-bold font-serif text-[var(--editorial-ivory)]">
                    {reviewStats.completed
                      ? 'اكتملت الجلسة'
                      : `مراجعة: بطاقة ${reviewIndex + 1} من ${reviewQueue.length}`}
                  </h2>
                </div>
              </div>

              {/* Mode Switcher */}
              {!reviewStats.completed && (
                <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10 text-xs flex-wrap">
                  <button
                    onClick={() => {
                      setReviewMode('flashcard');
                      setIsFlipped(false);
                    }}
                    className={`py-1 px-2.5 rounded-lg transition-all ${
                      reviewMode === 'flashcard' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                    title="نمط البطاقات الذكية"
                  >
                    <i className="fa-solid fa-layer-group ml-1"></i>
                    <span className="hidden sm:inline">بطاقات</span>
                  </button>

                  <button
                    onClick={() => {
                      setReviewMode('matching');
                      setupMatchingGame(reviewQueue);
                    }}
                    className={`py-1 px-2.5 rounded-lg transition-all ${
                      reviewMode === 'matching' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                    title="لعبة ربط الكلمة بمعناها"
                  >
                    <i className="fa-solid fa-puzzle-piece ml-1"></i>
                    <span className="hidden sm:inline">مطابقة</span>
                  </button>

                  <button
                    onClick={() => {
                      setReviewMode('quiz');
                      if (reviewQueue[reviewIndex]) {
                        generateQuizOptions(reviewQueue[reviewIndex], savedWords);
                      }
                    }}
                    className={`py-1 px-2.5 rounded-lg transition-all ${
                      reviewMode === 'quiz' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                    title="اختبار التسميع السريع"
                  >
                    <i className="fa-solid fa-list-check ml-1"></i>
                    <span className="hidden sm:inline">تسميع</span>
                  </button>

                  <button
                    onClick={() => {
                      setReviewMode('recall');
                      setRecallInput('');
                      setRecallChecked(false);
                      setRecallIsCorrect(false);
                      setRecallShowHint(false);
                    }}
                    className={`py-1 px-2.5 rounded-lg transition-all ${
                      reviewMode === 'recall' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                    title="اختبار الكتابة والإملاء"
                  >
                    <i className="fa-solid fa-keyboard ml-1"></i>
                    <span className="hidden sm:inline">كتابة</span>
                  </button>
                </div>
              )}

              <button
                onClick={() => setShowReviewModal(false)}
                className="modal-close"
                title="إغلاق الجلسة"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {/* Progress Bar */}
            {!reviewStats.completed && (
              <div className="w-full bg-black/30 h-1.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-amber-500 to-amber-400 h-full transition-all duration-300"
                  style={{ width: `${Math.round(((reviewIndex) / reviewQueue.length) * 100)}%` }}
                ></div>
              </div>
            )}

            {/* Modal Body */}
            <div className="modal-body space-y-4">
              {reviewStats.completed ? (
                /* Session Complete Screen */
                <div className="text-center py-6 space-y-5">
                  <div className="w-16 h-16 rounded-full bg-emerald-900/40 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-300 text-2xl shadow-lg shadow-emerald-900/20 animate-bounce">
                    <i className="fa-solid fa-trophy"></i>
                  </div>

                  <div>
                    <h3 className="text-xl font-bold font-serif text-[var(--editorial-ivory)] mb-1">
                      اكتملت المراجعة
                    </h3>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto">
                    <div className="interleaved-card p-3 text-center border-emerald-500/30 bg-emerald-950/20">
                      <div className="text-xs text-emerald-300 mb-1">أتقنتها</div>
                      <div className="text-xl font-bold text-emerald-300">{reviewStats.good}</div>
                    </div>
                    <div className="interleaved-card p-3 text-center border-amber-500/30 bg-amber-950/20">
                      <div className="text-xs text-amber-300 mb-1">صعبة</div>
                      <div className="text-xl font-bold text-amber-300">{reviewStats.hard}</div>
                    </div>
                    <div className="interleaved-card p-3 text-center border-red-500/30 bg-red-950/20">
                      <div className="text-xs text-red-300 mb-1">تحتاج إعادة</div>
                      <div className="text-xl font-bold text-red-300">{reviewStats.again}</div>
                    </div>
                  </div>

                  {/* Retention Score Index */}
                  {(() => {
                    const totalEvaluated = reviewStats.good + reviewStats.hard + reviewStats.again;
                    const accuracy = totalEvaluated > 0 ? Math.round(((reviewStats.good + reviewStats.hard * 0.5) / totalEvaluated) * 100) : 100;
                    return (
                      <div className="bg-gradient-to-r from-amber-950/40 via-amber-900/20 to-amber-950/40 border border-amber-500/30 p-3 rounded-2xl max-w-sm mx-auto flex items-center justify-between shadow-lg shadow-amber-950/30">
                        <div className="text-right">
                          <div className="text-xs text-amber-300 font-semibold flex items-center gap-1.5">
                            <i className="fa-solid fa-brain text-amber-400"></i>
                            <span>مؤشر استقرار الذاكرة SM-2:</span>
                          </div>
                        </div>
                        <div className="text-2xl font-bold font-serif text-emerald-300">
                          {accuracy}%
                        </div>
                      </div>
                    );
                  })()}

                  {/* Actions */}
                  <div className="flex items-center justify-center gap-3 pt-3">
                    <button
                      onClick={() => startReviewSession(reviewMode, reviewQueue)}
                      className="btn btn-secondary"
                    >
                      <i className="fa-solid fa-rotate-right ml-1"></i>
                      <span>إعادة هذه الجلسة</span>
                    </button>
                    <button
                      onClick={() => setShowReviewModal(false)}
                      className="btn btn-primary px-6"
                    >
                      <i className="fa-solid fa-check ml-1"></i>
                      <span>إنهاء والعودة للمفردات</span>
                    </button>
                  </div>
                </div>
              ) : reviewMode === 'matching' ? (
                /* MODE: MATCHING PAIRS GAME */
                <div className="space-y-4">
                  <div className="text-center space-y-1 mb-2">
                    <p className="text-[11px] text-slate-400">
                      تم مطابقة {matchedCardIds.length / 2} من {matchingCards.length / 2} أزواج
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {matchingCards.map((card) => {
                      const isMatched = matchedCardIds.includes(card.id);
                      const isSelected = selectedMatching.includes(card.id);
                      const isError = matchingErrorIds.includes(card.id);

                      let cardStyle = 'bg-[var(--editorial-surface-2)] border-[var(--editorial-border)] hover:border-amber-500/50 text-[var(--text-primary)]';
                      if (isMatched) {
                        cardStyle = 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400 opacity-60 cursor-default scale-95';
                      } else if (isSelected) {
                        cardStyle = 'bg-[var(--editorial-surface)] border-[var(--editorial-violet)] text-[var(--text-primary)] ring-2 ring-[var(--editorial-violet)] scale-105';
                      } else if (isError) {
                        cardStyle = 'bg-red-950/60 border-red-500 text-red-200 animate-shake';
                      }

                      return (
                        <button
                          key={card.id}
                          disabled={isMatched}
                          onClick={() => handleMatchingCardClick(card.id)}
                          className={`p-3 rounded-xl border text-center transition-all duration-200 flex flex-col items-center justify-center min-h-[75px] ${cardStyle}`}
                        >
                          <span className={`text-sm font-semibold ${card.type === 'term' ? 'font-serif text-base' : 'font-sans'}`}>
                            {card.text}
                          </span>
                          <span className="text-[10px] opacity-60 mt-1">
                            {card.type === 'term' ? 'مفردة' : 'معنى'}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex justify-center pt-2">
                    <button
                      onClick={() => setupMatchingGame(reviewQueue)}
                      className="btn btn-secondary text-xs"
                    >
                      <i className="fa-solid fa-shuffle ml-1"></i>
                      <span>توليد مجموعة مطابقة جديدة</span>
                    </button>
                  </div>
                </div>
              ) : reviewMode === 'flashcard' ? (
                /* MODE 1: SMART FLASHCARDS */
                <div className="space-y-4">
                  <div
                    onClick={() => setIsFlipped(!isFlipped)}
                    className={`study-flip-card ${isFlipped ? 'is-flipped' : ''}`}
                  >
                    <div className="study-flip-inner">
                      {/* FRONT OF CARD */}
                      <div className="study-card-front">
                        <div className="text-xs text-amber-300 font-semibold mb-2">
                          {reviewQueue[reviewIndex]?.direction === 'ar-en' ? 'نص عربي' : 'English Term'}
                        </div>
                        <h3 className="text-3xl font-bold font-serif text-[var(--editorial-ivory)] mb-2">
                          {reviewQueue[reviewIndex]?.word}
                        </h3>
                        {reviewQueue[reviewIndex]?.bookTitle && (
                          <p className="text-xs text-slate-400 mb-4 line-clamp-1">
                            {reviewQueue[reviewIndex]?.bookTitle}
                          </p>
                        )}
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-auto">
                          <i className="fa-solid fa-hand-pointer text-[10px]"></i>
                          <span>اضغط لقلب البطاقة [المسافة Space]</span>
                        </div>
                      </div>

                      {/* BACK OF CARD */}
                      <div className="study-card-back">
                        <div className="text-xs text-emerald-300 font-semibold mb-2">المعنى المقابل والترجمة</div>
                        <h3 className="text-xl font-bold font-serif text-[var(--editorial-ivory)] mb-3">
                          {reviewQueue[reviewIndex]?.word}
                        </h3>
                        <div className="flex flex-wrap gap-2 justify-center mb-4">
                          {reviewQueue[reviewIndex]?.meanings.map((m, idx) => (
                            <span key={idx} className="btn btn-secondary py-1 px-3 text-base text-amber-200">
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Rating Buttons */}
                  <div className="space-y-2 pt-2">
                    <div className="text-xs text-center text-slate-400 flex items-center justify-center gap-1">
                      <span>قيّم مستوى تذكرك لتحديث جدول التكرار المتباعد:</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 review-rating-bar">
                      <button
                        onClick={() => handleRateCurrentWord('again')}
                        className="btn review-rating-option review-rating-again bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 text-red-200 py-2.5 text-xs flex flex-col items-center justify-center gap-0.5 relative group"
                      >
                        <span className="font-bold flex items-center gap-1">
                          <i className="fa-solid fa-xmark text-red-400"></i>
                          <span>لم أتذكرها</span>
                        </span>
                        <span className="text-[10px] text-red-300/70">إعادة [1]</span>
                      </button>

                      <button
                        onClick={() => handleRateCurrentWord('hard')}
                        className="btn review-rating-option review-rating-hard bg-amber-950/40 hover:bg-amber-900/60 border border-amber-500/40 text-amber-200 py-2.5 text-xs flex flex-col items-center justify-center gap-0.5 relative group"
                      >
                        <span className="font-bold flex items-center gap-1">
                          <i className="fa-solid fa-question text-amber-400"></i>
                          <span>صعبة قليلاً</span>
                        </span>
                        <span className="text-[10px] text-amber-300/70">بعد يومين [2]</span>
                      </button>

                      <button
                        onClick={() => handleRateCurrentWord('good')}
                        className="btn review-rating-option review-rating-good bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/40 text-emerald-200 py-2.5 text-xs flex flex-col items-center justify-center gap-0.5 relative group"
                      >
                        <span className="font-bold flex items-center gap-1">
                          <i className="fa-solid fa-check text-emerald-400"></i>
                          <span>أتقنتها</span>
                        </span>
                        <span className="text-[10px] text-emerald-300/70">بعد أسبوع [3]</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : reviewMode === 'quiz' ? (
                /* MODE 2: MULTIPLE CHOICE QUIZ */
                <div className="space-y-4">
                  {/* Prompt Card */}
                  <div className="interleaved-card text-center p-6 space-y-2 border-amber-500/30">
                    <div className="text-xs text-amber-300 font-semibold">ما هو المعنى الصحيح لهذه المفردة؟</div>
                    <h3 className="text-3xl font-bold font-serif text-[var(--editorial-ivory)]">
                      {reviewQueue[reviewIndex]?.word}
                    </h3>
                  </div>

                  {/* 4 Choices */}
                  <div className="grid grid-cols-1 gap-2.5">
                    {quizOptions.map((opt, idx) => {
                      const isCorrectAnswer = reviewQueue[reviewIndex]?.meanings.includes(opt);
                      let optionClass = '';
                      if (quizRevealed) {
                        if (isCorrectAnswer) optionClass = 'correct';
                        else if (quizSelected === opt) optionClass = 'incorrect';
                      }

                      return (
                        <button
                          key={idx}
                          disabled={quizRevealed}
                          onClick={() => {
                            setQuizSelected(opt);
                            setQuizRevealed(true);
                          }}
                          className={`review-quiz-option ${optionClass}`}
                        >
                          <span className="font-serif text-base">{opt}</span>
                          <span className="text-xs opacity-60">
                            {quizRevealed && isCorrectAnswer && (
                              <i className="fa-solid fa-circle-check text-emerald-400"></i>
                            )}
                            {quizRevealed && !isCorrectAnswer && quizSelected === opt && (
                              <i className="fa-solid fa-circle-xmark text-red-400"></i>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Feedback & Next Action */}
                  {quizRevealed && (
                    <div className="pt-2 flex items-center justify-between gap-3 animate-fade-in">
                      <div className="text-xs">
                        {quizSelected && reviewQueue[reviewIndex]?.meanings.includes(quizSelected) ? (
                          <span className="text-emerald-300 font-bold flex items-center gap-1">
                            <i className="fa-solid fa-check"></i>
                            <span>إجابة صحيحة وممتازة!</span>
                          </span>
                        ) : (
                          <span className="text-red-300 font-bold flex items-center gap-1">
                            <i className="fa-solid fa-xmark"></i>
                            <span>الإجابة الصحيحة: {reviewQueue[reviewIndex]?.meanings.join('، ')}</span>
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          const wasCorrect =
                            quizSelected && reviewQueue[reviewIndex]?.meanings.includes(quizSelected);
                          handleRateCurrentWord(wasCorrect ? 'good' : 'again');
                        }}
                        className="btn btn-primary py-2 px-5 text-xs"
                      >
                        <span>المتابعة للكلمة التالية</span>
                        <i className="fa-solid fa-arrow-left mr-1"></i>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* MODE 3: ACTIVE RECALL / SPELLING */
                <div className="space-y-4">
                  <div className="interleaved-card text-center p-6 space-y-2 border-amber-500/30">
                    <div className="text-xs text-amber-300 font-semibold">اكتب الكلمة المقابلة لهذا المعنى:</div>
                    <div className="flex flex-wrap gap-2 justify-center py-2">
                      {reviewQueue[reviewIndex]?.meanings.map((m, idx) => (
                        <span key={idx} className="btn btn-secondary py-1 px-3 text-lg font-serif text-amber-200">
                          {m}
                        </span>
                      ))}
                    </div>
                    {reviewQueue[reviewIndex]?.bookTitle && (
                      <p className="text-xs text-slate-500">{reviewQueue[reviewIndex]?.bookTitle}</p>
                    )}
                  </div>

                  {/* Typing input */}
                  <div className="space-y-2">
                    <div className="relative">
                      <input
                        type="text"
                        value={recallInput}
                        onChange={(e) => {
                          setRecallInput(e.target.value);
                          setRecallChecked(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (!recallChecked) handleCheckRecall();
                            else handleRateCurrentWord(recallIsCorrect ? 'good' : 'again');
                          }
                        }}
                        placeholder="اكتب المفردة هنا..."
                        className="form-input w-full text-center text-lg font-serif py-3"
                        autoFocus
                      />
                    </div>

                    {/* Hint / Answer reveal */}
                    {recallShowHint && (
                      <div className="interleaved-card p-3 text-center text-xs text-amber-300 bg-amber-950/20 border-amber-500/30">
                        الكلمة المطلوبة تبدأ بـ: <strong>{reviewQueue[reviewIndex]?.word.substring(0, 2)}...</strong>
                        <span className="block mt-1 text-slate-400">({reviewQueue[reviewIndex]?.word})</span>
                      </div>
                    )}

                    {/* Result feedback */}
                    {recallChecked && (
                      <div
                        className={`p-3 rounded-xl text-center text-sm font-bold ${
                          recallIsCorrect
                            ? 'bg-emerald-950/40 border border-emerald-500/40 text-emerald-300'
                            : 'bg-red-950/40 border border-red-500/40 text-red-300'
                        }`}
                      >
                        {recallIsCorrect ? (
                          <div className="flex items-center justify-center gap-2">
                            <i className="fa-solid fa-circle-check text-emerald-400"></i>
                            <span>صحيح تماماً! كتابة متقنة.</span>
                          </div>
                        ) : (
                          <div>
                            <div>للأسف كتابة غير مطابقة.</div>
                            <div className="text-xs font-normal text-slate-300 mt-1">
                              الإملاء الصحيح: <strong>{reviewQueue[reviewIndex]?.word}</strong>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between gap-2 pt-2">
                    <button
                      onClick={() => setRecallShowHint(!recallShowHint)}
                      className="btn btn-ghost text-xs text-amber-300"
                    >
                      <i className="fa-solid fa-lightbulb ml-1"></i>
                      <span>{recallShowHint ? 'إخفاء التلميح' : 'إظهار تلميح'}</span>
                    </button>

                    {!recallChecked ? (
                      <button
                        onClick={handleCheckRecall}
                        disabled={!recallInput.trim()}
                        className="btn btn-primary"
                      >
                        <span>التحقق من الإجابة</span>
                        <i className="fa-solid fa-magnifying-glass mr-1"></i>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRateCurrentWord(recallIsCorrect ? 'good' : 'again')}
                        className="btn btn-primary"
                      >
                        <span>المتابعة</span>
                        <i className="fa-solid fa-arrow-left mr-1"></i>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= READING SETTINGS MODAL ================= */}
      {/* ================= ADD NEW WORD MODAL ================= */}
      {showAddWordModal && (
        <div className="modal-overlay active" onClick={() => setShowAddWordModal(false)}>
          <div className="modal-card max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-plus-circle text-amber-400"></i>
                <h2 className="text-base font-bold font-serif text-[var(--editorial-ivory)]">إضافة مفردة جديدة</h2>
              </div>
              <button onClick={() => setShowAddWordModal(false)} className="modal-close" title="إغلاق">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="modal-body space-y-4">
              <div>
                <label className="form-label">الكلمة / المفردة *</label>
                <input
                  type="text"
                  value={addWordTerm}
                  onChange={(e) => setAddWordTerm(e.target.value)}
                  placeholder="مثال: Almustafa أو المصطفى..."
                  className="form-input w-full text-lg font-serif"
                  autoFocus
                />
              </div>

              <div>
                <label className="form-label">المعاني / الترجمات * (افصل بينها بفواصل)</label>
                <textarea
                  rows={3}
                  value={addWordMeanings}
                  onChange={(e) => setAddWordMeanings(e.target.value)}
                  placeholder="مثال: المختار، الحبيب، الصفوة..."
                  className="form-textarea w-full text-sm"
                />
              </div>

              <div>
                <label className="form-label">الاتجاه</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAddWordDirection('ar-en')}
                    className={`btn text-xs py-2 ${addWordDirection === 'ar-en' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    عربي ➔ إنجليزي
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddWordDirection('en-ar')}
                    className={`btn text-xs py-2 ${addWordDirection === 'en-ar' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    إنجليزي ➔ عربي
                  </button>
                </div>
              </div>

              <div>
                <label className="form-label">ملاحظات حرة / شواهد لغوية (اختياري)</label>
                <textarea
                  rows={2}
                  value={addWordNotes}
                  onChange={(e) => setAddWordNotes(e.target.value)}
                  placeholder="ملاحظات حول الجذر، السياق، أو طريقة التذكر..."
                  className="form-textarea w-full text-xs"
                />
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setShowAddWordModal(false)} className="btn btn-secondary text-xs">
                إلغاء
              </button>
              <button onClick={handleSaveNewManualWord} className="btn btn-primary text-xs px-5">
                <i className="fa-solid fa-check ml-1"></i>
                <span>حفظ المفردة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= EDIT WORD & NOTES MODAL ================= */}
      {showEditWordModal && editingWord && (
        <div className="modal-overlay active" onClick={() => setShowEditWordModal(false)}>
          <div className="modal-card max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-pen-to-square text-amber-400"></i>
                <h2 className="text-base font-bold font-serif text-[var(--editorial-ivory)]">تعديل: {editingWord.word}</h2>
              </div>
              <button onClick={() => setShowEditWordModal(false)} className="modal-close" title="إغلاق">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="modal-body space-y-4">
              <div>
                <label className="form-label">المعاني / الترجمات (افصل بينها بفواصل)</label>
                <textarea
                  rows={3}
                  value={editWordMeanings}
                  onChange={(e) => setEditWordMeanings(e.target.value)}
                  className="form-textarea w-full text-sm font-serif"
                />
              </div>

              <div>
                <label className="form-label">الملاحظات والشواهد اللغوية</label>
                <textarea
                  rows={3}
                  value={editWordNotes}
                  onChange={(e) => setEditWordNotes(e.target.value)}
                  placeholder="أضف ملاحظتك أو تلميح التذكر هنا..."
                  className="form-textarea w-full text-xs"
                />
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setShowEditWordModal(false)} className="btn btn-secondary text-xs">
                إلغاء
              </button>
              <button onClick={handleSaveEditWord} className="btn btn-primary text-xs px-5">
                <i className="fa-solid fa-check ml-1"></i>
                <span>حفظ التعديلات</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ================= READING SETTINGS MODAL ================= */}
      {showSettings && (
        <div className="modal-overlay active" onClick={() => setShowSettings(false)}>
          <div className="modal-card max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-sliders text-amber-400"></i>
                <h2 className="text-base font-bold font-serif text-[var(--editorial-ivory)]">إعدادات القراءة</h2>
              </div>
              <button onClick={() => setShowSettings(false)} className="modal-close" title="إغلاق">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="modal-body space-y-5">
              
              {/* Layout Mode */}
              <div className="space-y-2">
                <label className="form-label text-sm font-semibold">نمط العرض والقراءة</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setLayoutMode('dual')}
                    className={`btn text-xs py-2 px-2 border transition-all ${
                      layoutMode === 'dual'
                        ? 'btn-primary'
                        : 'btn-secondary text-slate-300'
                    }`}
                  >
                    <i className="fa-solid fa-columns text-xs ml-1"></i>
                    <span>بجانب بعضهما</span>
                  </button>

                  <button
                    onClick={() => setLayoutMode('interleaved')}
                    className={`btn text-xs py-2 px-2 border transition-all ${
                      layoutMode === 'interleaved'
                        ? 'btn-primary'
                        : 'btn-secondary text-slate-300'
                    }`}
                  >
                    <i className="fa-solid fa-bars-staggered text-xs ml-1"></i>
                    <span>جملة بمقابلة</span>
                  </button>

                  <button
                    onClick={() => setLayoutMode('focus')}
                    className={`btn text-xs py-2 px-2 border transition-all ${
                      layoutMode === 'focus'
                        ? 'btn-primary'
                        : 'btn-secondary text-slate-300'
                    }`}
                  >
                    <i className="fa-solid fa-eye text-xs ml-1"></i>
                    <span>نص واحد</span>
                  </button>
                </div>
              </div>

              {/* Paper Theme */}
              <div className="space-y-2">
                <label className="form-label text-sm font-semibold">مظهر الورق والسمة</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    onClick={() => setTheme('parchment')}
                    className={`btn text-xs py-2 px-3 border transition-all ${
                      theme === 'parchment'
                        ? 'border-amber-600 bg-amber-900/30 text-amber-200 ring-2 ring-amber-500/40'
                        : 'border-white/10 bg-black/20 text-slate-300 hover:border-amber-500/40'
                    }`}
                  >
                    <i className="fa-solid fa-scroll text-sm"></i>
                    <span>ورق عتيق</span>
                  </button>

                  <button
                    onClick={() => setTheme('obsidian')}
                    className={`btn text-xs py-2 px-3 border transition-all ${
                      theme === 'obsidian'
                        ? 'border-amber-600 bg-amber-900/30 text-amber-200 ring-2 ring-amber-500/40'
                        : 'border-white/10 bg-black/20 text-slate-300 hover:border-amber-500/40'
                    }`}
                  >
                    <i className="fa-solid fa-moon text-sm"></i>
                    <span>عقيق الليل</span>
                  </button>

                  <button
                    onClick={() => setTheme('emerald')}
                    className={`btn text-xs py-2 px-3 border transition-all ${
                      theme === 'emerald'
                        ? 'border-emerald-600 bg-emerald-900/30 text-emerald-200 ring-2 ring-emerald-500/40'
                        : 'border-white/10 bg-black/20 text-slate-300 hover:border-emerald-500/40'
                    }`}
                  >
                    <i className="fa-solid fa-gem text-sm"></i>
                    <span>زمرد فاخر</span>
                  </button>
                  <button
                    onClick={() => setTheme('matrix')}
                    className={`btn text-xs py-2 px-3 border transition-all ${
                      theme === 'matrix'
                        ? 'border-lime-500 bg-lime-950/40 text-lime-200 ring-2 ring-lime-400/40'
                        : 'border-white/10 bg-black/20 text-slate-300 hover:border-lime-400/40'
                    }`}
                  >
                    <i className="fa-solid fa-terminal text-sm"></i>
                    <span>Matrix</span>
                  </button>
                </div>
              </div>

              {/* Font Size */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="form-label text-sm font-semibold">حجم الخط</label>
                  <span className="text-amber-300 font-mono text-sm">{fontSize}px</span>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setFontSize(prev => Math.max(16, prev - 2))}
                    className="btn btn-secondary py-1.5 px-3"
                  >
                    A-
                  </button>
                  <input
                    type="range"
                    min="16"
                    max="28"
                    step="1"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="flex-1 accent-purple-500 cursor-pointer"
                  />
                  <button 
                    onClick={() => setFontSize(prev => Math.min(28, prev + 2))}
                    className="btn btn-secondary py-1.5 px-3"
                  >
                    A+
                  </button>
                </div>
              </div>

              {/* Arabic Font Family */}
              <div className="space-y-2">
                <label className="form-label text-sm font-semibold">الخط العربي</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setArabicFont('Amiri')}
                    className={`btn text-xs py-2 border transition-all ${
                      arabicFont === 'Amiri'
                        ? 'btn-primary'
                        : 'btn-secondary text-slate-300'
                    }`}
                    style={{ fontFamily: 'Amiri, serif' }}
                  >
                    الأميري
                  </button>
                  <button
                    onClick={() => setArabicFont('IBM Plex Sans Arabic')}
                    className={`btn text-xs py-2 border transition-all ${
                      arabicFont === 'IBM Plex Sans Arabic'
                        ? 'btn-primary'
                        : 'btn-secondary text-slate-300'
                    }`}
                    style={{ fontFamily: 'IBM Plex Sans Arabic, sans-serif' }}
                  >
                    المهند
                  </button>
                  <button
                    onClick={() => setArabicFont('Scheherazade New')}
                    className={`btn text-xs py-2 border transition-all ${
                      arabicFont === 'Scheherazade New'
                        ? 'btn-primary'
                        : 'btn-secondary text-slate-300'
                    }`}
                    style={{ fontFamily: 'Scheherazade New, serif' }}
                  >
                    النسخ
                  </button>
                </div>
              </div>

              {/* Line Spacing */}
              <div className="space-y-2">
                <label className="form-label text-sm font-semibold">تباعد الأسطر</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setLineHeight(1.8)}
                    className={`btn text-xs py-2 ${lineHeight === 1.8 ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    مريح (1.8)
                  </button>
                  <button
                    onClick={() => setLineHeight(2.2)}
                    className={`btn text-xs py-2 ${lineHeight === 2.2 ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    متوازن (2.2)
                  </button>
                  <button
                    onClick={() => setLineHeight(2.6)}
                    className={`btn text-xs py-2 ${lineHeight === 2.6 ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    فسيح (2.6)
                  </button>
                </div>
              </div>

              {/* Layout Mode */}
              <div className="space-y-2">
                <label className="form-label text-sm font-semibold">نمط العرض في القارئ</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    onClick={() => setLayoutMode('dual')}
                    className={`btn text-xs py-2.5 px-2 flex flex-col gap-1 items-center justify-center ${layoutMode === 'dual' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    <i className="fa-solid fa-columns text-sm"></i>
                    <span className="font-bold">النصان بجانب بعضهما</span>
                  </button>
                  <button
                    onClick={() => setLayoutMode('interleaved')}
                    className={`btn text-xs py-2.5 px-2 flex flex-col gap-1 items-center justify-center ${layoutMode === 'interleaved' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    <i className="fa-solid fa-bars-staggered text-sm"></i>
                    <span className="font-bold">جملة ثم المقابلة</span>
                  </button>
                  <button
                    onClick={() => setLayoutMode('focus')}
                    className={`btn text-xs py-2.5 px-2 flex flex-col gap-1 items-center justify-center ${layoutMode === 'focus' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    <i className="fa-solid fa-eye text-sm"></i>
                    <span className="font-bold">نص منفرد</span>
                  </button>
                </div>
              </div>

              {/* Language Selection for Single Text Mode (Focus Mode) */}
              {layoutMode === 'focus' && (
                <div className="space-y-2 p-3 rounded-xl bg-amber-950/20 border border-amber-500/30">
                  <div className="flex items-center justify-between">
                    <label className="form-label text-sm font-semibold text-amber-200">لغة النص الظاهر (نمط النص المنفرد)</label>
                    <span className="text-xs text-amber-300 font-mono">
                      {focusLanguage === 'ar' ? 'العربية' : 'English'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFocusLanguage('ar')}
                      className={`btn text-xs py-2 px-3 flex items-center justify-center gap-1.5 transition-all ${
                        focusLanguage === 'ar' ? 'btn-primary font-bold' : 'btn-secondary text-slate-300'
                      }`}
                    >
                      <i className="fa-solid fa-font text-xs"></i>
                      <span>النص العربي فقط</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFocusLanguage('en')}
                      className={`btn text-xs py-2 px-3 flex items-center justify-center gap-1.5 transition-all ${
                        focusLanguage === 'en' ? 'btn-primary font-bold' : 'btn-secondary text-slate-300'
                      }`}
                    >
                      <i className="fa-solid fa-language text-xs"></i>
                      <span>English Text Only</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Word Underline Preference Toggle */}
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <div>
                  <div className="font-semibold text-sm text-white">الخط التمييزي تحت الكلمات</div>
                  <div className="text-[11px] text-slate-400">إظهار أو مسح الخط الموجود تحت كل كلمة في القارئ</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWordUnderline(!showWordUnderline)}
                  className={`btn py-1.5 px-3 text-xs flex items-center gap-1.5 ${showWordUnderline ? 'btn-primary font-bold' : 'btn-secondary text-slate-300'}`}
                >
                  <i className={`fa-solid ${showWordUnderline ? 'fa-underline' : 'fa-font'}`}></i>
                  <span>{showWordUnderline ? 'مفعّل (يوجد خط)' : 'ممسوح (بدون خط)'}</span>
                </button>
              </div>

              {/* Sync Scroll Toggle */}
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <div>
                  <div className="font-semibold text-sm text-white">تزامن التمرير</div>
                  <div className="text-[11px] text-slate-400">تحريك النصين معاً بالتوازي عند التمرير</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSyncScroll(!syncScroll)}
                  className={`btn py-1.5 px-3 text-xs ${syncScroll ? 'btn-primary' : 'btn-secondary'}`}
                >
                  <i className="fa-solid fa-arrows-up-down"></i>
                  <span>{syncScroll ? 'مفعّل' : 'معطّل'}</span>
                </button>
              </div>

            </div>

            <div className="modal-footer">
              <button onClick={() => setShowSettings(false)} className="btn btn-primary w-full">
                حفظ وإغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= EDIT BOOK METADATA MODAL ================= */}
      {showEditBookModal && editingBook && (
        <div className="modal-overlay active" onClick={() => setShowEditBookModal(false)}>
          <div className="modal-card max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-pen-to-square text-amber-400"></i>
                <h2 className="text-base font-bold font-serif text-[var(--editorial-ivory)]">تعديل معلومات الكتاب في السجل</h2>
              </div>
              <button onClick={() => setShowEditBookModal(false)} className="modal-close" title="إغلاق">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="modal-body space-y-4">
              <div>
                <label className="form-label">عنوان الكتاب</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="عنوان الكتاب..."
                  className="form-input w-full font-serif text-base"
                />
              </div>

              <div>
                <label className="form-label">اسم المؤلف أو المترجم</label>
                <input
                  type="text"
                  value={editAuthor}
                  onChange={(e) => setEditAuthor(e.target.value)}
                  placeholder="المؤلف..."
                  className="form-input w-full text-sm"
                />
              </div>

              <div>
                <label className="form-label">التصنيف / المجال الأدبي</label>
                <input
                  type="text"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  placeholder="مثال: أدب عالمي مترجم، فلسفة، روايات تاريخية..."
                  className="form-input w-full text-sm"
                />
              </div>

              <div>
                <label className="form-label">ملاحظات وملخص عن الكتاب</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="أضف وصفاً اختصارياً أو ملاحظاتك الشخصية..."
                  className="form-textarea w-full text-xs"
                />
              </div>

              {/* Cover Image Customization Section */}
              <div className="space-y-3 pt-2 border-t border-white/10">
                <label className="form-label text-amber-300 font-bold flex items-center justify-between">
                  <span>صورة غلاف الكتاب (جودة عالية)</span>
                  {editCoverImage && (
                    <button
                      type="button"
                      onClick={() => setEditCoverImage('')}
                      className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 font-normal"
                    >
                      <i className="fa-solid fa-trash text-[10px]"></i>
                      <span>إزالة الصورة</span>
                    </button>
                  )}
                </label>

                <div className="flex flex-col sm:flex-row items-center gap-4">
                  {/* Cover Preview Card */}
                  <div className="w-24 h-36 rounded-lg border border-white/20 overflow-hidden relative shadow-lg bg-slate-900 shrink-0 flex items-center justify-center">
                    {editCoverImage ? (
                      <img
                        src={editCoverImage}
                        alt="معاينة الغلاف"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-center p-2">
                        <i className="fa-solid fa-image text-slate-500 text-2xl mb-1"></i>
                        <span className="text-[10px] text-slate-400 block">بدون صورة</span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 space-y-2.5 w-full">
                    {/* File Upload Button */}
                    <div className="relative">
                      <label className="btn btn-secondary text-xs w-full cursor-pointer flex items-center justify-center gap-2 py-2.5 border-amber-500/30 hover:border-amber-400">
                        <i className="fa-solid fa-upload text-amber-400"></i>
                        <span>رفع صورة الغلاف</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleCoverImageUpload}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {/* Or URL input */}
                    <div>
                      <input
                        type="text"
                        value={editCoverImage}
                        onChange={(e) => setEditCoverImage(e.target.value)}
                        placeholder="رابط صورة الغلاف"
                        className="form-input w-full text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setShowEditBookModal(false)} className="btn btn-secondary text-xs">
                إلغاء
              </button>
              <button onClick={handleSaveBookEdits} className="btn btn-primary text-xs px-5">
                <i className="fa-solid fa-check ml-1"></i>
                <span>حفظ التغييرات</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= BOOK TEXT BATCHES MODAL ================= */}
      {showBatchesModal && selectedBookForBatches && (
        <div className="modal-overlay active" onClick={() => setShowBatchesModal(false)}>
          <div className="modal-card max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-layer-group text-amber-400"></i>
                  <h2 className="text-base sm:text-lg font-bold font-serif text-[var(--editorial-ivory)]">
                    فصول ودفعات الكتاب: {selectedBookForBatches.title}
                  </h2>
                </div>
                <p className="text-xs text-[var(--editorial-muted)] mt-0.5">
                  تصفح دفعات النصوص المترجمة لهذا الكتاب، يمكنك قراءة أي دفعة بمفردها أو تعديل عنوانها أو حذفها
                </p>
              </div>
              <button onClick={() => setShowBatchesModal(false)} className="modal-close" title="إغلاق">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="modal-body space-y-4">
              {/* Batches Overview Strip */}
              <div className="flex items-center justify-between gap-3 p-3 bg-[var(--editorial-surface-2)] rounded-xl border border-[var(--editorial-border)] flex-wrap">
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-[var(--text-secondary)]">
                    إجمالي الدفعات: <strong className="text-amber-300 font-mono text-sm">{getBookBatchesSorted(selectedBookForBatches).length}</strong>
                  </span>
                  <span className="text-[var(--editorial-muted)]">|</span>
                  <span className="text-[var(--text-secondary)]">
                    إجمالي الفقرات: <strong className="text-amber-300 font-mono text-sm">{getBookAllRowsSorted(selectedBookForBatches).length}</strong>
                  </span>
                </div>

                <button
                  onClick={() => handleOpenWorkspaceForBatchAppend(selectedBookForBatches)}
                  className="btn btn-primary text-xs py-2 px-3.5 flex items-center gap-1.5 shadow-sm"
                >
                  <i className="fa-solid fa-plus-circle text-xs"></i>
                  <span>إضافة دفعة نصوص جديدة</span>
                </button>
              </div>

              {/* Batches List (Newest First) */}
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                {getBookBatchesSorted(selectedBookForBatches).map((batch, idx) => {
                  const isEditingThisBatch = editingBatchId === batch.id;
                  const isFirst = idx === 0;
                  const firstRow = batch.alignedRows?.[0];

                  return (
                    <div
                      key={batch.id}
                      className={`batch-card-editorial ${isFirst ? 'is-newest' : ''}`}
                    >
                      {/* TIER 1: Batch Header Bar */}
                      <div className="flex items-center justify-between flex-wrap gap-2 pb-3 mb-3 border-b border-[var(--editorial-border)]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-bold px-3 py-1 rounded-lg flex items-center gap-1.5 border ${
                            isFirst
                              ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                              : 'bg-[var(--editorial-surface-2)] text-[var(--text-primary)] border-[var(--editorial-border)]'
                          }`}>
                            <i className="fa-solid fa-bookmark text-[10px]"></i>
                            <span>الدفعة #{getBookBatchesSorted(selectedBookForBatches).length - idx}</span>
                            {isFirst && (
                              <span className="text-[10px] bg-amber-400 text-black px-1.5 py-0.2 rounded font-bold mr-1">
                                الأحدث
                              </span>
                            )}
                          </span>

                          <span className="text-xs text-[var(--editorial-muted)] font-mono flex items-center gap-1.5">
                            <i className="fa-regular fa-calendar text-[11px] opacity-70"></i>
                            <span>{new Date(batch.createdAt).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-medium text-[var(--editorial-violet-light)] bg-[var(--editorial-surface-2)] border border-[var(--editorial-border)] px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                            <i className="fa-solid fa-align-left text-[10px]"></i>
                            <span>{batch.alignedRows?.length || 0} فقرة متوازية</span>
                          </span>
                        </div>
                      </div>

                      {/* TIER 2: Batch Title & Bilingual Excerpt */}
                      <div className="space-y-3">
                        {isEditingThisBatch ? (
                          <div className="p-3 bg-[var(--editorial-surface-2)] rounded-xl border border-amber-500/40 space-y-2">
                            <label className="text-xs text-amber-400 font-semibold block">تعديل اسم الدفعة:</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editBatchTitleInput}
                                onChange={(e) => setEditBatchTitleInput(e.target.value)}
                                placeholder="اكتب عنواناً للدفعة..."
                                className="form-input text-xs py-2 px-3 flex-1 font-serif bg-[var(--editorial-bg)] text-[var(--text-primary)]"
                                autoFocus
                              />
                              <button
                                onClick={() => handleSaveBatchRename(selectedBookForBatches.id, batch.id)}
                                className="btn btn-primary text-xs py-2 px-4 shrink-0"
                              >
                                حفظ
                              </button>
                              <button
                                onClick={() => setEditingBatchId(null)}
                                className="btn btn-secondary text-xs py-2 px-3 shrink-0"
                              >
                                إلغاء
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <h3 className="font-serif font-bold text-[var(--editorial-ivory)] text-base sm:text-lg leading-snug">
                              {batch.title || `الدفعة ${getBookBatchesSorted(selectedBookForBatches).length - idx}`}
                            </h3>
                          </div>
                        )}

                        {/* Dual Bilingual Excerpt (Spacious, Zero overlap, Clean clamp) */}
                        {firstRow && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                            {/* Arabic Preview */}
                            <div className="batch-excerpt-box ar" dir="rtl">
                              <div className="text-[10px] font-semibold text-amber-500 dark:text-amber-400 flex items-center gap-1.5 font-mono mb-1.5">
                                <i className="fa-solid fa-feather text-[10px]"></i>
                                <span>مقتطف النص العربي:</span>
                              </div>
                              <p className="text-xs sm:text-sm font-serif text-[var(--text-primary)] leading-relaxed line-clamp-2 text-right">
                                {firstRow.arabic ? `"${firstRow.arabic.trim()}"` : '—'}
                              </p>
                            </div>

                            {/* English Preview */}
                            <div className="batch-excerpt-box en" dir="ltr">
                              <div className="text-[10px] font-semibold text-amber-500 dark:text-amber-300 flex items-center gap-1.5 font-mono mb-1.5" dir="ltr">
                                <i className="fa-solid fa-quote-left text-[10px]"></i>
                                <span>Parallel English Excerpt:</span>
                              </div>
                              <p className="text-xs sm:text-sm font-serif text-[var(--text-secondary)] leading-relaxed line-clamp-2 text-left" dir="ltr">
                                {firstRow.english ? `"${firstRow.english.trim()}"` : '—'}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* TIER 3: Dedicated Action Footer Bar */}
                      <div className="mt-4 pt-3 border-t border-[var(--editorial-border)] flex items-center justify-between flex-wrap gap-2.5">
                        {/* Primary Read CTA */}
                        <button
                          onClick={() => {
                            setShowBatchesModal(false);
                            if (selectedBookForBatches) {
                              openBookForReading(selectedBookForBatches, batch.alignedRows?.[0]?.id, batch.id);
                            }
                          }}
                          className="btn btn-primary text-xs py-2 px-4 flex items-center gap-2 shadow-sm hover:shadow"
                          title="فتح وقراءة هذه الدفعة في القارئ"
                        >
                          <i className="fa-solid fa-book-open text-xs"></i>
                          <span className="font-bold">قراءة هذه الدفعة في القارئ</span>
                        </button>

                        {/* Secondary Actions */}
                        <div className="flex items-center gap-2">
                          {!isEditingThisBatch && (
                            <button
                              onClick={() => {
                                setEditingBatchId(batch.id);
                                setEditBatchTitleInput(batch.title || '');
                              }}
                              className="btn btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5"
                              title="تعديل اسم الدفعة"
                            >
                              <i className="fa-solid fa-pen text-[11px]"></i>
                              <span>تعديل الاسم</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleDeleteBatch(selectedBookForBatches.id, batch.id)}
                            className="btn btn-secondary text-red-400 hover:text-red-300 hover:border-red-500/40 py-1.5 px-3 text-xs flex items-center gap-1.5"
                            title="حذف هذه الدفعة"
                          >
                            <i className="fa-solid fa-trash-can text-[11px]"></i>
                            <span>حذف الدفعة</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setShowBatchesModal(false)} className="btn btn-secondary text-xs w-full">
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
