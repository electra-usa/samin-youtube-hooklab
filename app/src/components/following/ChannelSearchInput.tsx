"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/format";

export type ChannelPick = {
  channelId: string;
  channelName: string;
  channelAvatar: string | null;
  subscriberCount: number | null;
  handle?: string | null;
};

type ApiChannel = { channelId: string; name: string; handle: string | null; avatar: string | null; subscriberCount: number | null };

const toPick = (c: ApiChannel): ChannelPick => ({
  channelId: c.channelId,
  channelName: c.name,
  channelAvatar: c.avatar,
  subscriberCount: c.subscriberCount,
  handle: c.handle,
});

const looksLikeUrlOrId = (v: string) => /^UC[\w-]{22}$/.test(v) || /youtube\.com|youtu\.be/i.test(v) || /^@[\w.-]{2,}$/.test(v);

export function ChannelAvatar({ name, src, size = "md" }: { name: string; src: string | null; size?: "md" | "lg" }) {
  const cls = size === "lg" ? "size-12 text-base" : "size-10 text-sm";
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={cn(cls, "flex-shrink-0 rounded-full object-cover")} referrerPolicy="no-referrer" />
  ) : (
    <span className={cn(cls, "flex flex-shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary dark:bg-primary/25 dark:text-white")}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Search by channel name, or paste a channel URL / @handle / channel id
 * (original CompetitorInputField: 400 ms debounce, 3+ characters, arrow-key navigation).
 */
export function ChannelSearchInput({
  onSelect,
  placeholder = "Search by channel name, username, or paste a URL",
  autoFocus,
}: {
  onSelect: (channel: ChannelPick) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const [results, setResults] = useState<ChannelPick[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  const pick = (c: ChannelPick) => {
    onSelect(c);
    setValue("");
    setResults([]);
    setOpen(false);
    setActive(-1);
    setError(null);
  };
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  });

  useEffect(() => {
    const q = value.trim();
    if (q.length < 3 && !looksLikeUrlOrId(q)) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        if (looksLikeUrlOrId(q)) {
          const res = await fetch(`/api/youtube/resolve-channel?url=${encodeURIComponent(q)}`);
          const body = (await res.json()) as { channel?: ApiChannel; error?: string };
          if (cancelled) return;
          if (res.ok && body.channel) pickRef.current(toPick(body.channel));
          else setError(body.error ?? "Channel not found. Make sure the URL is correct, or try searching by name.");
        } else {
          const res = await fetch(`/api/youtube/search-channels?q=${encodeURIComponent(q)}&maxResults=6`);
          const body = (await res.json()) as { channels?: ApiChannel[]; error?: string };
          if (cancelled) return;
          const list = (body.channels ?? []).map(toPick);
          setResults(list);
          setOpen(list.length > 0);
          setActive(-1);
          if (!res.ok) setError(body.error ? `Search failed: ${body.error}` : "Failed to search channels.");
          else if (!list.length) setError("No channels found. Try a different name or paste the channel URL.");
        }
      } catch {
        if (!cancelled) setError(looksLikeUrlOrId(q) ? "Failed to resolve URL. Try searching by channel name instead." : "Failed to search channels.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
          if (e.target.value.trim().length < 3) {
            setResults([]);
            setOpen(false);
          }
        }}
        onKeyDown={(e) => {
          if (!open || !results.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(results.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(-1, i - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
            setActive(-1);
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-lg border border-stroke bg-white px-4 py-3 text-dark placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10 dark:bg-[#18191c] dark:text-white"
      />
      {busy && (
        <span className="absolute right-3 top-[1.4rem] -translate-y-1/2">
          <span className="block size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </span>
      )}
      {open && results.length > 0 && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-lg border border-stroke bg-white shadow-lg dark:border-white/10 dark:bg-[#1b1c1f]">
          {results.map((c, i) => (
            <button
              key={c.channelId}
              type="button"
              onClick={() => pick(c)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-stroke p-3 text-left transition last:border-b-0 dark:border-white/10",
                i === active ? "bg-gray-100 dark:bg-white/10" : "hover:bg-gray-50 dark:hover:bg-white/5",
              )}
            >
              <ChannelAvatar name={c.channelName} src={c.channelAvatar} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-dark dark:text-white">{c.channelName}</span>
                <span className="block truncate text-sm text-dark-5">
                  {[c.handle, c.subscriberCount != null ? `${c.subscriberCount.toLocaleString("en-US")} subscribers` : null].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
