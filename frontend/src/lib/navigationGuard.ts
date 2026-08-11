import { useRef, useCallback } from "react";

const uploadUnsavedRef = { current: false };
const loadUnsavedRef = { current: false };

export function setUploadUnsaved(unsaved: boolean) {
  uploadUnsavedRef.current = unsaved;
}

export function useUploadNavigationGuard() {
  const unregister = useCallback(() => {
    uploadUnsavedRef.current = false;
  }, []);

  const register = useCallback((unsaved: boolean) => {
    uploadUnsavedRef.current = unsaved;
    return unregister;
  }, [unregister]);

  return { register, unregister };
}

export function isUploadUnsaved() {
  return uploadUnsavedRef.current;
}

export function setLoadUnsaved(unsaved: boolean) {
  loadUnsavedRef.current = unsaved;
}

export function isLoadUnsaved() {
  return loadUnsavedRef.current;
}
