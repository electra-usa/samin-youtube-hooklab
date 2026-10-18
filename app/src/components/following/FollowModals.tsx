"use client";

import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { sendJson } from "@/lib/api-client";
import { cn } from "@/lib/format";
import { useDismiss } from "@/components/outliers/controls";
import { ChannelAvatar, ChannelSearchInput, type ChannelPick } from "./ChannelSearchInput";

const secondary =
  "rounded-lg px-4 py-2 text-sm font-medium text-dark-5 transition hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10 dark:hover:text-white";
const primary = "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";

function ChannelCard({ channel, onRemove, large }: { channel: ChannelPick; onRemove: () => void; large?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-stroke p-3 dark:border-white/10", large ? "bg-gray-50 p-4 dark:bg-white/5" : "bg-white dark:bg-transparent")}>
      <ChannelAvatar name={channel.channelName} src={channel.channelAvatar} size={large ? "lg" : "md"} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-dark dark:text-white">{channel.channelName}</p>
        {channel.subscriberCount != null && <p className="truncate text-sm text-dark-5">{channel.subscriberCount.toLocaleString("en-US")} subscribers</p>}
      </div>
      <button type="button" onClick={onRemove} aria-label="Remove channel" title="Search again" className="flex-shrink-0 rounded-lg p-2 text-dark-5 transition hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10">
        <X className="size-5" />
      </button>
    </div>
  );
}

/** "Follow a channel": search or paste a URL, optionally pick a list, then Follow. */
export function FollowChannelModal({
  open,
  onClose,
  lists,
  onFollowed,
}: {
  open: boolean;
  onClose: () => void;
  lists: { id: string; name: string }[];
  onFollowed: () => void;
}) {
  if (!open) return null;
  return <FollowChannelDialog onClose={onClose} lists={lists} onFollowed={onFollowed} />;
}

function FollowChannelDialog({ onClose, lists, onFollowed }: { onClose: () => void; lists: { id: string; name: string }[]; onFollowed: () => void }) {
  const [channel, setChannel] = useState<ChannelPick | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useDismiss<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  const listName = listId ? lists.find((l) => l.id === listId)?.name : null;

  const follow = async () => {
    if (!channel || busy) return;
    setBusy(true);
    try {
      await sendJson("/api/following/channels", "POST", {
        channelId: channel.channelId,
        channelName: channel.channelName,
        channelAvatar: channel.channelAvatar,
        subscriberCount: channel.subscriberCount,
        handle: channel.handle,
        listId: listId ?? undefined,
      });
      toast.success(`Following ${channel.channelName}`);
      onFollowed();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to follow channel");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Follow a channel">
      {busy ? (
        <div className="flex items-center justify-center py-8">
          <span className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="ml-3 text-sm text-dark-5">Following...</span>
        </div>
      ) : channel ? (
        <div>
          <ChannelCard channel={channel} onRemove={() => setChannel(null)} large />
          {lists.length > 0 && (
            <div className="mt-4" ref={menuRef}>
              <label className="mb-1.5 block text-sm font-medium text-dark dark:text-white">Add to list</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  className="flex w-full items-center justify-between rounded-lg border border-stroke bg-white px-4 py-2.5 text-sm transition hover:bg-gray-50 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/5"
                >
                  <span className={listName ? "text-dark dark:text-white" : "text-dark-5"}>{listName ?? "None"}</span>
                  <ChevronDown className={cn("size-4 text-dark-5 transition", menuOpen && "rotate-180")} />
                </button>
                {menuOpen && (
                  <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-stroke bg-white shadow-lg dark:border-white/10 dark:bg-[#1b1c1f]">
                    {[{ id: null as string | null, name: "None" }, ...lists].map((l) => {
                      const on = listId === l.id;
                      return (
                        <button
                          key={l.id ?? "none"}
                          type="button"
                          onClick={() => {
                            setListId(l.id);
                            setMenuOpen(false);
                          }}
                          className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-gray-50 dark:hover:bg-white/5", on && "bg-primary/5 font-medium")}
                        >
                          <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border-2", on ? "border-primary bg-primary text-white" : "border-stroke dark:border-white/20")}>
                            {on && <Check className="size-3" strokeWidth={3} />}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-dark dark:text-white">{l.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="mt-6 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setChannel(null)} className={secondary}>
              Back
            </button>
            <button type="button" onClick={follow} className={cn(primary, "px-5")}>
              Follow
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-dark-5">Search by channel name, username, or paste a YouTube URL.</p>
          <ChannelSearchInput onSelect={setChannel} autoFocus placeholder="Search by channel name or paste URL" />
          <div className="mt-6 flex justify-end">
            <button type="button" onClick={onClose} className={secondary}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** "New list": name plus any channels to follow into it. */
export function NewListModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  if (!open) return null;
  return <NewListDialog onClose={onClose} onCreated={onCreated} />;
}

function NewListDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [channels, setChannels] = useState<ChannelPick[]>([]);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      const res = await sendJson<{ failed: string[] }>("/api/following/lists", "POST", { name: clean, channels });
      for (const f of res.failed ?? []) toast.error(`Could not add ${f}`);
      toast.success(`Created "${clean}"${channels.length ? ` with ${channels.length} channel(s)` : ""}`);
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create list");
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="New list"
      footer={
        <>
          <button type="button" onClick={onClose} className={secondary}>
            Cancel
          </button>
          <button type="button" onClick={create} disabled={!name.trim() || busy} className={primary}>
            {busy ? "Creating..." : "Create list"}
          </button>
        </>
      }
    >
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div>
          <label htmlFor="list-name" className="mb-2 block text-sm font-medium text-dark dark:text-white">
            List name
          </label>
          <input
            id="list-name"
            autoFocus
            maxLength={50}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Similars, Inspiration, Tech channels"
            className="w-full rounded-lg border border-stroke bg-white px-4 py-3 text-dark placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10 dark:bg-transparent dark:text-white"
          />
        </div>
        <div>
          <p className="mb-3 block text-sm font-medium text-dark dark:text-white">Channels ({channels.length})</p>
          {channels.length > 0 && (
            <div className="mb-3 space-y-3">
              {channels.map((c) => (
                <ChannelCard key={c.channelId} channel={c} onRemove={() => setChannels((cs) => cs.filter((x) => x.channelId !== c.channelId))} />
              ))}
            </div>
          )}
          <ChannelSearchInput onSelect={(c) => setChannels((cs) => (cs.some((x) => x.channelId === c.channelId) ? cs : [c, ...cs]))} />
        </div>
      </form>
    </Modal>
  );
}
