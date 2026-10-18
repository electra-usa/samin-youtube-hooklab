"use client";

import dynamic from "next/dynamic";
import type { StudioProps } from "./StudioView";

// Studio restores this tab's draft from sessionStorage on first render, so it only
// renders in the browser.
const StudioView = dynamic(() => import("./StudioView").then((m) => m.StudioView), {
  ssr: false,
  loading: () => (
    <div className="mb-4 flex items-center justify-between gap-3 border-b border-stroke pb-3 dark:border-white/10">
      <h1 className="text-lg font-semibold text-dark dark:text-white">Studio</h1>
    </div>
  ),
});

export function StudioClient(props: StudioProps) {
  return <StudioView key={props.initialWorkspace?.id ?? "draft"} {...props} />;
}
