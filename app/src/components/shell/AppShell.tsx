"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Toaster } from "@/components/ui/Toaster";

const KEY = "hooklab.sidebarCollapsed";
const CHANGE = "hooklab:sidebar-collapsed";

// Collapsed state lives in localStorage; the server render always starts expanded.
const subscribe = (onChange: () => void) => {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("storage", onChange);
  };
};

export function AppShell({ children }: { children: ReactNode }) {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(KEY) === "1",
    () => false,
  );

  const toggle = () => {
    localStorage.setItem(KEY, collapsed ? "0" : "1");
    window.dispatchEvent(new Event(CHANGE));
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main className="relative min-w-0 flex-1 overflow-y-auto bg-white dark:bg-[#111214]">{children}</main>
      <Toaster />
    </div>
  );
}

/** Standard page frame: title row plus padded content, as on Outliers/Settings. */
export function PageFrame({
  title,
  subtitle,
  actions,
  children,
  wide = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "px-6 pb-16 pt-6 lg:px-6" : "mx-auto max-w-5xl px-12 pb-16 pt-6"}>
      {(title || actions) && (
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            {title && <h1 className="text-[26px] font-bold leading-tight text-dark dark:text-white">{title}</h1>}
            {subtitle && <p className="mt-1 text-sm text-dark-5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
