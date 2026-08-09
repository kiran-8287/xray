/**
 * StorageService - IndexedDB wrapper for persisting combinations at scale.
 */

const DB_NAME = "xray-storage";
const DB_VERSION = 1;

type LightweightCombo = {
  id: string;
  bag: { id: string } | null;
  threats: { id: string }[];
  others: { id: string }[];
};

type FailureLog = {
  bagName: string;
  bagId: string;
  threatName: string;
  threatId: string;
  reason: string;
  expected: number;
  actual: number;
};

type GenerationProgress = {
  generated: number;
  total: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;
let dbInstance: IDBDatabase | null = null;
let isClosing = false;
let comboBatchBuffer: LightweightCombo[] = [];
let failureBatchBuffer: FailureLog[] = [];
let flushScheduled = false;
const BATCH_FLUSH_SIZE = 1000;
const BATCH_FLUSH_DELAY_MS = 100;

/**
 * Check if IndexedDB connection is available and not closing
 */
function isConnectionAvailable(): boolean {
  return !isClosing && dbInstance !== null;
}

/**
 * Close the database connection gracefully
 */
export function closeConnection(): void {
  if (dbInstance) {
    isClosing = true;
    try {
      dbInstance.close();
    } catch (err) {
      // Ignore close errors
    }
    dbInstance = null;
    dbPromise = null;
  }
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      dbPromise = null;
      reject(new Error(`Failed to open IndexedDB: ${request.error}`));
    };
    
    request.onsuccess = () => {
      const db = request.result;
      dbInstance = db;
      isClosing = false;
      
      // Listen for connection close events
      db.addEventListener('close', () => {
        isClosing = true;
        dbInstance = null;
        dbPromise = null;
      });
      
      // Listen for versionchange (happens when another tab upgrades)
      db.addEventListener('versionchange', () => {
        closeConnection();
      });
      
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("combinations")) {
        const comboStore = db.createObjectStore("combinations", { keyPath: "id" });
        comboStore.createIndex("bagId", "bag.id", { unique: false });
        comboStore.createIndex("generatedAt", "generatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("failures")) {
        db.createObjectStore("failures", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("progress")) {
        db.createObjectStore("progress", { keyPath: "key" });
      }
    };
  });
  
  return dbPromise;
}

async function flushBatchBuffer(): Promise<void> {
  if (flushScheduled) return;
  if (isClosing) {
    flushScheduled = false;
    return;
  }
  
  flushScheduled = true;
  try {
    await new Promise((resolve) => setTimeout(resolve, BATCH_FLUSH_DELAY_MS));
    
    // Check again after delay
    if (isClosing) {
      flushScheduled = false;
      return;
    }
    
    const db = await openDB();
    
    // Check after await
    if (isClosing) {
      flushScheduled = false;
      return;
    }
    
    if (comboBatchBuffer.length > 0) {
      const tx = db.transaction("combinations", "readwrite");
      const store = tx.objectStore("combinations");
      const now = Date.now();
      for (const combo of comboBatchBuffer) {
        store.put({ ...combo, generatedAt: now });
      }
      
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          if (isClosing) {
            resolve();
          } else {
            reject(tx.error);
          }
        };
      });
      
      // Only clear buffer if transaction completed
      if (!isClosing) {
        comboBatchBuffer = [];
      }
    }
    
    if (failureBatchBuffer.length > 0 && !isClosing) {
      const tx = db.transaction("failures", "readwrite");
      const store = tx.objectStore("failures");
      for (const failure of failureBatchBuffer) {
        store.put(failure);
      }
      
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          if (isClosing) {
            resolve();
          } else {
            reject(tx.error);
          }
        };
      });
      
      if (!isClosing) {
        failureBatchBuffer = [];
      }
    }
  } catch (err) {
    if (!(err instanceof Error && err.name === 'InvalidStateError')) {
      console.error("[StorageService] flush failed:", err);
    }
  } finally {
    flushScheduled = false;
  }
}

export function addCombos(combos: LightweightCombo[]): void {
  comboBatchBuffer.push(...combos);
  if (comboBatchBuffer.length >= BATCH_FLUSH_SIZE) {
    flushBatchBuffer();
  } else if (!flushScheduled) {
    flushScheduled = true;
    setTimeout(() => flushBatchBuffer(), BATCH_FLUSH_DELAY_MS);
  }
}

export function addFailures(failures: FailureLog[]): void {
  failureBatchBuffer.push(...failures);
  if (failureBatchBuffer.length >= BATCH_FLUSH_SIZE) {
    flushBatchBuffer();
  } else if (!flushScheduled) {
    flushScheduled = true;
    setTimeout(() => flushBatchBuffer(), BATCH_FLUSH_DELAY_MS);
  }
}

export async function setProgress(progress: GenerationProgress): Promise<void> {
  // Skip if connection is closing
  if (isClosing || !dbInstance) {
    return;
  }
  
  try {
    const db = await openDB();
    
    if (isClosing) {
      return;
    }
    
    const tx = db.transaction("progress", "readwrite");
    const store = tx.objectStore("progress");
    store.put({ key: "current", value: progress });
    
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        if (isClosing) {
          resolve();
        } else {
          reject(tx.error);
        }
      };
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'InvalidStateError') {
      return;
    }
    console.error("[StorageService] setProgress failed:", err);
  }
}

export async function getAllCombos(): Promise<LightweightCombo[]> {
  // Skip if connection is closing
  if (isClosing || !dbInstance) {
    return [];
  }
  
  try {
    const db = await openDB();
    
    // Double-check after await (connection might have closed)
    if (isClosing) {
      return [];
    }
    
    const tx = db.transaction("combinations", "readonly");
    const store = tx.objectStore("combinations");
    const request = store.getAll();
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => {
        // If connection is closing, return empty array instead of error
        if (isClosing) {
          resolve([]);
        } else {
          reject(request.error);
        }
      };
    });
  } catch (err) {
    // Gracefully handle connection closing errors
    if (err instanceof Error && err.name === 'InvalidStateError') {
      return [];
    }
    console.error("[StorageService] getAllCombos failed:", err);
    return [];
  }
}

export async function getAllFailures(): Promise<FailureLog[]> {
  // Skip if connection is closing
  if (isClosing || !dbInstance) {
    return [];
  }
  
  try {
    const db = await openDB();
    
    // Double-check after await (connection might have closed)
    if (isClosing) {
      return [];
    }
    
    const tx = db.transaction("failures", "readonly");
    const store = tx.objectStore("failures");
    const request = store.getAll();
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => {
        // If connection is closing, return empty array instead of error
        if (isClosing) {
          resolve([]);
        } else {
          reject(request.error);
        }
      };
    });
  } catch (err) {
    // Gracefully handle connection closing errors
    if (err instanceof Error && err.name === 'InvalidStateError') {
      return [];
    }
    console.error("[StorageService] getAllFailures failed:", err);
    return [];
  }
}

export async function getProgress(): Promise<GenerationProgress | null> {
  // Skip if connection is closing
  if (isClosing || !dbInstance) {
    return null;
  }
  
  try {
    const db = await openDB();
    
    if (isClosing) {
      return null;
    }
    
    const tx = db.transaction("progress", "readonly");
    const store = tx.objectStore("progress");
    const request = store.get("current");
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result?.value || null);
      request.onerror = () => {
        if (isClosing) {
          resolve(null);
        } else {
          reject(request.error);
        }
      };
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'InvalidStateError') {
      return null;
    }
    console.error("[StorageService] getProgress failed:", err);
    return null;
  }
}

export async function clearAll(): Promise<void> {
  // Skip if connection is closing
  if (isClosing || !dbInstance) {
    comboBatchBuffer = [];
    failureBatchBuffer = [];
    return;
  }
  
  try {
    const db = await openDB();
    
    if (isClosing) {
      comboBatchBuffer = [];
      failureBatchBuffer = [];
      return;
    }
    
    const stores = ["combinations", "failures", "progress"];
    const tx = db.transaction(stores, "readwrite");
    for (const storeName of stores) {
      tx.objectStore(storeName).clear();
    }
    
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        if (isClosing) {
          resolve();
        } else {
          reject(tx.error);
        }
      };
    });
    
    comboBatchBuffer = [];
    failureBatchBuffer = [];
  } catch (err) {
    if (err instanceof Error && err.name === 'InvalidStateError') {
      // Connection closed, just clear buffers
      comboBatchBuffer = [];
      failureBatchBuffer = [];
      return;
    }
    console.error("[StorageService] clearAll failed:", err);
  }
}

export async function flush(): Promise<void> {
  await flushBatchBuffer();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    // Close IndexedDB connection gracefully
    closeConnection();
    
    // Fallback: save to sessionStorage
    if (comboBatchBuffer.length > 0 || failureBatchBuffer.length > 0) {
      try {
        const combos = sessionStorage.getItem("collageCombinations");
        if (combos) {
          const existing = JSON.parse(combos);
          const merged = [...existing, ...comboBatchBuffer];
          sessionStorage.setItem("collageCombinations", JSON.stringify(merged));
        }
      } catch (_) {
        // Ignore
      }
    }
  });
  
  // Also close on page hide (mobile browsers, tab switches)
  window.addEventListener("pagehide", () => {
    closeConnection();
  });
  
  // Close on visibility change (optional, for extra safety)
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // Don't close here, just mark as potentially closing
      // The beforeunload/pagehide handlers will do the actual close
    }
  });
}
