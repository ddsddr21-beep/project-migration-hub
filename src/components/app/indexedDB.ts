// @ts-nocheck
export interface AlignedUnit {
  id: string;
  arabic: string;
  english: string;
  batchId?: string;
}

export interface TextBatch {
  id: string;
  title?: string;
  arabicText: string;
  englishText: string;
  alignedRows: AlignedUnit[];
  createdAt: number;
  notes?: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  category?: string;
  notes?: string;
  arabicText: string;
  englishText: string;
  alignedRows: AlignedUnit[];
  createdAt: number;
  lastReadAt?: number;
  lastReadRowId?: string;
  coverColor?: string;
  coverImage?: string;
  batches?: TextBatch[];
}

export function getBookBatchesSorted(book: Book): TextBatch[] {
  if (book.batches && book.batches.length > 0) {
    return [...book.batches].sort((a, b) => b.createdAt - a.createdAt);
  }
  return [{
    id: `batch-initial-${book.id}`,
    title: 'الدفعة الأولى',
    arabicText: book.arabicText || '',
    englishText: book.englishText || '',
    alignedRows: book.alignedRows || [],
    createdAt: book.createdAt
  }];
}

export function getBookAllRowsSorted(book: Book): AlignedUnit[] {
  const batches = getBookBatchesSorted(book);
  return batches.flatMap(b => (b.alignedRows || []).map(row => ({ ...row, batchId: b.id })));
}

export interface SavedWord {
  id: string;
  word: string;
  normalized?: string;
  meanings: string[];
  direction: 'ar-en' | 'en-ar';
  bookTitle?: string;
  contextSentence?: string;
  notes?: string;
  savedAt: number;
  mastered?: boolean;
  level?: number; // 0: New, 1: Learning, 2: Familiar, 3: Mastered
  streak?: number; // Consecutive correct reviews
  reviewCount?: number; // Total review count
  lastReviewedAt?: number; // Timestamp of last review
  nextReviewAt?: number; // Timestamp when next review is due
  intervalDays?: number; // Current spaced interval in days
  easinessFactor?: number; // SM-2 Easiness Factor (default 2.5)
}

const DB_NAME = 'ParallelReaderDB';
const DB_VERSION = 2;
const BOOKS_STORE = 'books';
const VOCAB_STORE = 'vocabulary';

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(VOCAB_STORE)) {
        const vocabStore = db.createObjectStore(VOCAB_STORE, { keyPath: 'id' });
        vocabStore.createIndex('word', 'word', { unique: false });
        vocabStore.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function initDB(): Promise<void> {
  await openDB();
}

export const STORAGE_KEYS = {
  BOOKS_SNAPSHOT: 'pr_books_snapshot_v2',
  VOCAB_SNAPSHOT: 'pr_vocab_snapshot_v2',
  WORKSPACE_DRAFT: 'pr_workspace_draft_v2',
  LAST_BACKUP_TIME: 'pr_last_backup_time'
};

export interface WorkspaceDraft {
  mode: 'new_book' | 'append_batch';
  targetBookId: string;
  batchTitle: string;
  title: string;
  author: string;
  arabicText: string;
  englishText: string;
  customDelimiter: string;
  lastSavedAt: number;
}

export function getWorkspaceDraft(): WorkspaceDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.WORKSPACE_DRAFT);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveWorkspaceDraft(draft: WorkspaceDraft): void {
  try {
    localStorage.setItem(STORAGE_KEYS.WORKSPACE_DRAFT, JSON.stringify(draft));
  } catch (err) {
    console.warn('Could not save workspace draft to localStorage:', err);
  }
}

export function clearWorkspaceDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.WORKSPACE_DRAFT);
  } catch (err) {
    console.warn('Could not clear workspace draft:', err);
  }
}

// Sync current books to localStorage snapshot for emergency fallback
function syncBooksSnapshot(books: Book[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.BOOKS_SNAPSHOT, JSON.stringify(books));
  } catch (err) {
    try {
      // If quota exceeded due to large base64 images, strip heavy coverImages in localStorage snapshot
      const lightweightBooks = books.map(b => ({
        ...b,
        coverImage: b.coverImage && b.coverImage.startsWith('data:image') && b.coverImage.length > 5000 ? undefined : b.coverImage
      }));
      localStorage.setItem(STORAGE_KEYS.BOOKS_SNAPSHOT, JSON.stringify(lightweightBooks));
    } catch (e2) {
      console.warn('Could not update books localStorage snapshot even after stripping images:', e2);
    }
  }
}

// Sync current vocab to localStorage snapshot
function syncVocabSnapshot(words: SavedWord[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.VOCAB_SNAPSHOT, JSON.stringify(words));
  } catch (err) {
    console.warn('Could not update vocab localStorage snapshot:', err);
  }
}

export async function getAllBooks(): Promise<Book[]> {
  try {
    const db = await openDB();
    const books = await new Promise<Book[]>((resolve, reject) => {
      const tx = db.transaction(BOOKS_STORE, 'readonly');
      const store = tx.objectStore(BOOKS_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    if (books.length > 0) {
      syncBooksSnapshot(books);
      return books;
    }

    // Fallback: If IndexedDB is empty (e.g. browser cleared or sandboxed context), check snapshot
    const snapshotRaw = localStorage.getItem(STORAGE_KEYS.BOOKS_SNAPSHOT);
    if (snapshotRaw) {
      try {
        const fallbackBooks: Book[] = JSON.parse(snapshotRaw);
        if (Array.isArray(fallbackBooks) && fallbackBooks.length > 0) {
          console.info('Restoring books from localStorage snapshot to IndexedDB...');
          for (const b of fallbackBooks) {
            await saveBook(b);
          }
          return fallbackBooks;
        }
      } catch {
        // ignore parse error
      }
    }

    return [];
  } catch (err) {
    console.error('getAllBooks error, attempting fallback to localStorage snapshot:', err);
    try {
      const snapshotRaw = localStorage.getItem(STORAGE_KEYS.BOOKS_SNAPSHOT);
      if (snapshotRaw) return JSON.parse(snapshotRaw);
    } catch {}
    return [];
  }
}

export async function saveBook(book: Book): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readwrite');
    const store = tx.objectStore(BOOKS_STORE);
    const request = store.put(book);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  // Update snapshot asynchronously
  try {
    const all = await new Promise<Book[]>((resolve) => {
      const tx = db.transaction(BOOKS_STORE, 'readonly');
      const store = tx.objectStore(BOOKS_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    if (all.length > 0) {
      syncBooksSnapshot(all);
    }
  } catch {}
}

export async function deleteBook(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readwrite');
    const store = tx.objectStore(BOOKS_STORE);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  try {
    const all = await new Promise<Book[]>((resolve) => {
      const tx = db.transaction(BOOKS_STORE, 'readonly');
      const store = tx.objectStore(BOOKS_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    syncBooksSnapshot(all);
  } catch {}
}

export async function getAllSavedWords(): Promise<SavedWord[]> {
  try {
    const db = await openDB();
    const words = await new Promise<SavedWord[]>((resolve, reject) => {
      const tx = db.transaction(VOCAB_STORE, 'readonly');
      const store = tx.objectStore(VOCAB_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    if (words.length > 0) {
      syncVocabSnapshot(words);
      return words;
    }

    // Fallback if IndexedDB was purged
    const snapshotRaw = localStorage.getItem(STORAGE_KEYS.VOCAB_SNAPSHOT);
    if (snapshotRaw) {
      try {
        const fallbackWords: SavedWord[] = JSON.parse(snapshotRaw);
        if (Array.isArray(fallbackWords) && fallbackWords.length > 0) {
          for (const w of fallbackWords) {
            await saveWordEntry(w);
          }
          return fallbackWords;
        }
      } catch {}
    }

    return [];
  } catch (err) {
    console.error('getAllSavedWords error, attempting fallback to localStorage snapshot:', err);
    try {
      const snapshotRaw = localStorage.getItem(STORAGE_KEYS.VOCAB_SNAPSHOT);
      if (snapshotRaw) return JSON.parse(snapshotRaw);
    } catch {}
    return [];
  }
}

export async function saveWordEntry(entry: SavedWord): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(VOCAB_STORE, 'readwrite');
    const store = tx.objectStore(VOCAB_STORE);
    const request = store.put(entry);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  try {
    const all = await new Promise<SavedWord[]>((resolve) => {
      const tx = db.transaction(VOCAB_STORE, 'readonly');
      const store = tx.objectStore(VOCAB_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    if (all.length > 0) syncVocabSnapshot(all);
  } catch {}
}

export async function deleteWordEntry(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(VOCAB_STORE, 'readwrite');
    const store = tx.objectStore(VOCAB_STORE);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  try {
    const all = await new Promise<SavedWord[]>((resolve) => {
      const tx = db.transaction(VOCAB_STORE, 'readonly');
      const store = tx.objectStore(VOCAB_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    syncVocabSnapshot(all);
  } catch {}
}

export interface CompleteBackupData {
  app: 'ParallelReader';
  version: 2;
  exportedAt: number;
  books: Book[];
  vocabulary: SavedWord[];
  draft?: WorkspaceDraft | null;
}

export async function exportCompleteBackup(): Promise<string> {
  const books = await getAllBooks();
  const vocabulary = await getAllSavedWords();
  const draft = getWorkspaceDraft();

  const backup: CompleteBackupData = {
    app: 'ParallelReader',
    version: 2,
    exportedAt: Date.now(),
    books,
    vocabulary,
    draft
  };

  localStorage.setItem(STORAGE_KEYS.LAST_BACKUP_TIME, Date.now().toString());
  return JSON.stringify(backup, null, 2);
}

export async function importCompleteBackup(rawJson: string): Promise<{ booksCount: number; wordsCount: number }> {
  const parsed = JSON.parse(rawJson);
  let importedBooksCount = 0;
  let importedWordsCount = 0;

  // Handle standard CompleteBackupData or legacy book/vocab arrays
  if (parsed && typeof parsed === 'object') {
    // 1. Restore Books
    const booksToImport: Book[] = Array.isArray(parsed.books) 
      ? parsed.books 
      : Array.isArray(parsed) && parsed.length > 0 && parsed[0].alignedRows 
        ? parsed 
        : [];

    for (const b of booksToImport) {
      if (b.id && b.title && (b.alignedRows || b.batches)) {
        await saveBook(b);
        importedBooksCount++;
      }
    }

    // 2. Restore Vocabulary
    const vocabToImport: SavedWord[] = Array.isArray(parsed.vocabulary)
      ? parsed.vocabulary
      : Array.isArray(parsed) && parsed.length > 0 && parsed[0].word && parsed[0].meanings
        ? parsed
        : [];

    for (const w of vocabToImport) {
      if (w.word && Array.isArray(w.meanings)) {
        await saveWordEntry({
          ...w,
          id: w.id || `word-imp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
        });
        importedWordsCount++;
      }
    }

    // 3. Restore Draft if available
    if (parsed.draft && typeof parsed.draft === 'object' && (parsed.draft.arabicText || parsed.draft.englishText)) {
      saveWorkspaceDraft(parsed.draft);
    }
  }

  return { booksCount: importedBooksCount, wordsCount: importedWordsCount };
}

