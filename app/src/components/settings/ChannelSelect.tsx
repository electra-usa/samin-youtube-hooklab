"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import { cn } from "@/lib/format";

export type ChannelOption = { id: string; name: string | null; avatar: string | null };

/** Round channel avatar with an initials fallback (also used on project cards). */
export function ChannelAvatar({ name, avatar, size = 32 }: { name: string | null; avatar: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initials = (name ?? "").trim().slice(0, 2).toUpperCase() || "?";
  const style = { width: size, height: size };
  if (avatar && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatar} alt="" style={style} onError={() => setFailed(true)} className="flex-shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span
      style={{ ...style, fontSize: Math.max(10, size / 3) }}
      className="flex flex-shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-white"
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** Dropdown of the user's channels (original UserChannelSelect). */
export function ChannelSelect({
  id,
  channels,
  value,
  onChange,
  placeholder = "Select a channel",
  noneLabel,
  footer,
  disabled,
  ariaLabel,
}: {
  id?: string;
  channels: ChannelOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  /** Adds a "no channel" option with this label. */
  noneLabel?: string;
  footer?: (close: () => void) => ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const selected = channels.find((c) => c.id === value) ?? null;
  return (
    <Popover
      className="w-full"
      panelClassName="w-full max-h-80 overflow-y-auto"
      trigger={({ open, toggle }) => (
        <button
          id={id}
          type="button"
          disabled={disabled}
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn(
            "flex min-h-12 w-full items-center gap-3 rounded-lg border border-stroke bg-white px-3 py-2 text-left text-sm text-dark transition hover:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:bg-transparent dark:text-white",
            open && "border-primary",
          )}
        >
          {selected ? (
            <>
              <ChannelAvatar name={selected.name} avatar={selected.avatar} size={32} />
              <span className="min-w-0 flex-1 truncate font-medium">{selected.name ?? "Untitled channel"}</span>
            </>
          ) : (
            <span className="flex-1 text-dark-5">{noneLabel && value === null ? noneLabel : placeholder}</span>
          )}
          <ChevronDown className={cn("size-5 flex-shrink-0 transition-transform", open && "rotate-180")} />
        </button>
      )}
    >
      {(close) => (
        <div role="listbox" aria-label={ariaLabel ?? "Channels"}>
          {noneLabel && (
            <Option
              active={value === null}
              onClick={() => {
                close();
                onChange(null);
              }}
            >
              <span className="flex-1 text-dark-5">{noneLabel}</span>
            </Option>
          )}
          {channels.map((c) => (
            <Option
              key={c.id}
              active={c.id === value}
              onClick={() => {
                close();
                onChange(c.id);
              }}
            >
              <ChannelAvatar name={c.name} avatar={c.avatar} size={32} />
              <span className="min-w-0 flex-1 truncate">{c.name ?? "Untitled channel"}</span>
            </Option>
          ))}
          {footer && <div className="mt-1 border-t border-stroke pt-1 dark:border-white/10">{footer(close)}</div>}
        </div>
      )}
    </Popover>
  );
}

function Option({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-dark transition hover:bg-gray-100 dark:text-white dark:hover:bg-white/10",
        active && "bg-gray-100 dark:bg-white/10",
      )}
    >
      {children}
      {active && <Check className="size-4 text-primary dark:text-sky-300" />}
    </button>
  );
}
