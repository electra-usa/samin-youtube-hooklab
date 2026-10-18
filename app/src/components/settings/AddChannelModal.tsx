"use client";

import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { sendJson } from "@/lib/api-client";
import { formatCount } from "@/lib/format";
import { ChannelAvatar } from "./ChannelSelect";
import { inputClass } from "./ui";

type Resolved = { channelId: string; name: string; handle: string | null; avatar: string | null; subscriberCount: number | null };

// Resolves a URL / @handle / channel id with Research's /api/youtube/resolve-channel,
// accepting either its field names or the original's (channelName, channelAvatar).
async function resolveChannel(query: string): Promise<Resolved> {
  let res: Response;
  try {
    res = await fetch(`/api/youtube/resolve-channel?url=${encodeURIComponent(query)}`);
  } catch {
    throw new Error("Couldn't reach the channel lookup. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as { channel?: Record<string, unknown>; error?: string } | null;
  if (res.status === 404 && !body) throw new Error("Channel lookup isn't available yet in this build. Try again later.");
  const c = body?.channel;
  if (!res.ok || !c) throw new Error(body?.error ?? "Channel not found. Check the URL or @handle and try again.");
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const channelId = text(c.channelId) ?? text(c.id);
  const name = text(c.name) ?? text(c.channelName) ?? text(c.title);
  if (!channelId || !name) throw new Error("The lookup didn't return a channel id and name.");
  return {
    channelId,
    name,
    handle: text(c.handle) ?? text(c.customUrl),
    avatar: text(c.avatar) ?? text(c.channelAvatar) ?? text(c.thumbnail),
    subscriberCount: typeof c.subscriberCount === "number" ? c.subscriberCount : Number(c.subscriberCount) || null,
  };
}

export function AddChannelModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Resolved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"resolve" | "add" | null>(null);

  const close = () => {
    if (busy) return;
    setQuery("");
    setFound(null);
    setError(null);
    onClose();
  };

  const find = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy("resolve");
    setError(null);
    setFound(null);
    try {
      setFound(await resolveChannel(query.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Channel not found");
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (!found) return;
    setBusy("add");
    setError(null);
    try {
      await sendJson("/api/user/channels", "POST", found);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the channel");
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a channel"
      footer={
        <>
          <Button variant="soft" onClick={close} disabled={!!busy}>
            Cancel
          </Button>
          <Button onClick={add} disabled={!found || !!busy}>
            {busy === "add" ? "Adding..." : "Add channel"}
          </Button>
        </>
      }
    >
      <form onSubmit={find} className="space-y-3">
        <label htmlFor="add-channel-query" className="block text-sm font-medium text-dark dark:text-white">
          YouTube channel URL or @handle
        </label>
        <div className="flex gap-2">
          <input
            id="add-channel-query"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder="https://youtube.com/@channel or @channel"
            className={inputClass}
          />
          <Button type="submit" variant="outline" disabled={!query.trim() || !!busy} className="flex-shrink-0">
            <Search className="size-4" />
            {busy === "resolve" ? "Finding..." : "Find"}
          </Button>
        </div>
      </form>

      {found && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-primary bg-primary/5 p-3 dark:border-sky-400/50 dark:bg-sky-400/10">
          <ChannelAvatar name={found.name} avatar={found.avatar} size={48} />
          <div className="min-w-0">
            <p className="truncate font-medium text-dark dark:text-white">{found.name}</p>
            <p className="truncate text-sm text-dark-5">
              {[found.handle, found.subscriberCount != null ? `${formatCount(found.subscriberCount)} subscribers` : null].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </Modal>
  );
}
