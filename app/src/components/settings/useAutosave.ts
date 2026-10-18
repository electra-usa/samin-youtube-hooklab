"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "dirty" | "saving" | "error";

/**
 * One autosaving settings section (as in the original Channels tab): edits mark it dirty,
 * and it saves itself `delay` ms after the last change. `flush` saves immediately.
 */
export function useAutosave<T extends object>(initial: T, save: (value: T) => Promise<void>, delay = 700) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const latest = useRef(initial);
  const version = useRef(0);
  const saveRef = useRef(save);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const flush = useCallback(async () => {
    const started = version.current;
    setStatus("saving");
    try {
      await saveRef.current(latest.current);
      // Edits made while saving keep the section dirty so they save next.
      setStatus(version.current === started ? "idle" : "dirty");
      return true;
    } catch {
      setStatus("error");
      return false;
    }
  }, []);

  const update = useCallback((patch: Partial<T>) => {
    latest.current = { ...latest.current, ...patch };
    version.current += 1;
    setValue(latest.current);
    setStatus("dirty");
  }, []);

  /** Replace the value with server data without saving it back. */
  const load = useCallback((next: T) => {
    latest.current = next;
    setValue(next);
  }, []);

  useEffect(() => {
    if (status !== "dirty") return;
    const timer = setTimeout(() => void flush(), delay);
    return () => clearTimeout(timer);
  }, [status, value, flush, delay]);

  return { value, status, update, load, flush };
}
