import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface StagedItem {
  file: File;
  category: string;
  subcategory: string;
  name: string;
  valid_region_points?: any | null;
}

interface UploadContextValue {
  files: File[];
  staged: StagedItem[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  setStaged: React.Dispatch<React.SetStateAction<StagedItem[]>>;
  clearAll: () => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<File[]>([]);
  const [staged, setStaged] = useState<StagedItem[]>([]);

  const clearAll = useCallback(() => {
    setFiles([]);
    setStaged([]);
  }, []);

  return (
    <UploadContext.Provider value={{ files, staged, setFiles, setStaged, clearAll }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUploadContext() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUploadContext must be used within UploadProvider");
  return ctx;
}