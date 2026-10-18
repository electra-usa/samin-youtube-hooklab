"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { getJson, sendJson } from "@/lib/api-client";
import { cn } from "@/lib/format";
import { useDismiss } from "@/components/outliers/controls";
import { ChannelAvatar, ChannelSearchInput, type ChannelPick } from "./ChannelSearchInput";

type ManagedChannel = {
  channelId: string;
  channelName: string;
  channelAvatar: string | null;
  subscriberCount: number | null;
  listMemberships: { id: string; name: string }[];
};
type Data = { channels: ManagedChannel[]; lists: { id: string; name: string }[] };
export type ManageScope = { mode: "all" | "unlisted" | "list"; listId: string | null };
type Confirm = { type: "unfollow" | "remove"; channel: ManagedChannel; listId?: string; listName?: string; alsoUnfollow: boolean };

/** "Manage channels" (original ManageListModal): rename/delete a list, add, remove and unfollow channels. */
export function ManageChannelsModal({ open, scope, onClose, onUpdated }: { open: boolean; scope: ManageScope; onClose: () => void; onUpdated: () => void }) {
  if (!open) return null;
  return <ManageChannelsDialog scope={scope} onClose={onClose} onUpdated={onUpdated} />;
}

function ManageChannelsDialog({ scope, onClose, onUpdated }: { scope: ManageScope; onClose: () => void; onUpdated: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [mode, setMode] = useState(scope.mode);
  const [listId, setListId] = useState<string | null>(scope.listId);
  const [listName, setListName] = useState("");
  const [nameFor, setNameFor] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const menuRef = useDismiss<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

  const load = useCallback(() => getJson<Data>("/api/following/channels").then(setData).catch(() => toast.error("Failed to load channels")), []);
  useEffect(() => {
    void load();
  }, [load]);

  const lists = useMemo(() => [...(data?.lists ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [data]);
  const effectiveListId = mode === "list" ? listId ?? lists[0]?.id ?? null : null;
  const currentList = lists.find((l) => l.id === effectiveListId) ?? null;
  // Keep the rename field in step with the selected list (adjusted during render, not in an effect).
  if (currentList && nameFor !== currentList.id) {
    setNameFor(currentList.id);
    setListName(currentList.name);
  }
  const label = mode === "all" ? "All channels" : mode === "unlisted" ? "Not in any list" : currentList?.name ?? "Select a list";
  const channels = (data?.channels ?? []).filter((c) =>
    mode === "all" ? true : mode === "unlisted" ? c.listMemberships.length === 0 : c.listMemberships.some((m) => m.id === effectiveListId),
  );
  const emptyText = mode === "unlisted" ? "Every followed channel is already in a list." : mode === "list" ? "No followed channels in this list yet." : "No followed channels yet.";

  const rename = async () => {
    if (!currentList) return;
    const clean = listName.trim();
    if (!clean || clean === currentList.name) return;
    setSavingName(true);
    try {
      await sendJson(`/api/following/lists/${currentList.id}`, "PATCH", { name: clean });
      toast.success("List renamed");
      await load();
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename list");
      setListName(currentList.name);
    } finally {
      setSavingName(false);
    }
  };

  const deleteList = async () => {
    if (!currentList || !window.confirm(`Delete "${currentList.name}" and remove its channel memberships?`)) return;
    setDeleting(true);
    try {
      await sendJson(`/api/following/lists/${currentList.id}`, "DELETE");
      toast.success(`Deleted "${currentList.name}"`);
      onUpdated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete list");
      setDeleting(false);
    }
  };

  const addChannel = async (c: ChannelPick) => {
    if (!currentList) return;
    try {
      await sendJson(`/api/following/lists/${currentList.id}/channels`, "POST", {
        channelId: c.channelId,
        channelName: c.channelName,
        channelAvatar: c.channelAvatar,
        subscriberCount: c.subscriberCount,
        handle: c.handle,
      });
      toast.success(`Added ${c.channelName}`);
      await load();
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add channel");
    }
  };

  const addToList = async (c: ManagedChannel, list: { id: string; name: string }) => {
    setWorking(`${c.channelId}:${list.id}`);
    try {
      await sendJson(`/api/following/lists/${list.id}/channels`, "POST", { channelId: c.channelId, channelName: c.channelName });
      toast.success(`Added ${c.channelName} to ${list.name}`);
      setAddingFor(null);
      await load();
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add channel");
    } finally {
      setWorking(null);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const { channel } = confirm;
    setWorking(channel.channelId);
    try {
      if (confirm.type === "unfollow" || confirm.alsoUnfollow) {
        await sendJson(`/api/following/channels?channelId=${encodeURIComponent(channel.channelId)}`, "DELETE");
        toast.success(`Unfollowed ${channel.channelName}`);
      } else if (confirm.listId) {
        await sendJson(`/api/following/lists/${confirm.listId}/channels?channelId=${encodeURIComponent(channel.channelId)}`, "DELETE");
        toast.success(`Removed ${channel.channelName} from ${confirm.listName}`);
      }
      setConfirm(null);
      await load();
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setWorking(null);
    }
  };

  const scopeOption = (key: string, text: string, on: boolean, select: () => void) => (
    <button
      key={key}
      type="button"
      role="option"
      aria-selected={on}
      onClick={() => {
        select();
        setMenuOpen(false);
        setConfirm(null);
      }}
      className="flex w-full items-center gap-3 border-b border-stroke px-4 py-3 text-left text-sm transition last:border-b-0 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"
    >
      <span className={cn("flex size-5 flex-shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-white" : "border-stroke dark:border-white/20")}>
        {on && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1 truncate text-dark dark:text-white">{text}</span>
    </button>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <div>
          <div>Manage channels</div>
          <p className="mt-1 text-sm font-normal text-dark-5">Choose which followed channels to manage.</p>
        </div>
      }
      footer={
        <div className="flex w-full items-center justify-between">
          {currentList ? (
            <button type="button" onClick={deleteList} disabled={deleting} className="text-sm font-medium text-red-600 transition hover:text-red-700 disabled:opacity-50 dark:text-red-400">
              {deleting ? "Deleting..." : "Delete list"}
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90">
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="relative inline-block" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-lg border border-stroke bg-white px-4 py-2 text-sm font-medium text-dark transition hover:bg-gray-100 dark:border-white/10 dark:bg-transparent dark:text-white dark:hover:bg-white/5"
          >
            {label}
            <ChevronDown className={cn("size-4 transition", menuOpen && "rotate-180")} />
          </button>
          {menuOpen && (
            <div role="listbox" className="absolute left-0 top-full z-50 mt-2 max-h-[60vh] w-72 overflow-y-auto rounded-lg border border-stroke bg-white shadow-lg dark:border-white/10 dark:bg-[#1b1c1f]">
              {scopeOption("all", "All channels", mode === "all", () => setMode("all"))}
              {scopeOption("unlisted", "Not in any list", mode === "unlisted", () => setMode("unlisted"))}
              {lists.map((l) =>
                scopeOption(l.id, l.name, mode === "list" && effectiveListId === l.id, () => {
                  setMode("list");
                  setListId(l.id);
                }),
              )}
            </div>
          )}
        </div>

        {currentList && (
          <>
            <div>
              <label className="mb-2 block text-sm font-medium text-dark dark:text-white">List name</label>
              <div className="flex items-center gap-2">
                <input
                  value={listName}
                  maxLength={50}
                  onChange={(e) => setListName(e.target.value)}
                  onBlur={() => void rename()}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  placeholder="List name"
                  className="flex-1 rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:ring-2 focus:ring-primary dark:border-white/10 dark:bg-transparent dark:text-white"
                />
                {savingName && <span className="text-xs text-dark-5">Saving...</span>}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-dark dark:text-white">Add channel</label>
              <ChannelSearchInput onSelect={(c) => void addChannel(c)} />
            </div>
          </>
        )}

        <div>
          <p className="mb-3 text-sm font-medium text-dark dark:text-white">Channels ({channels.length})</p>
          {!data ? (
            <div className="flex items-center justify-center py-10">
              <span className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="ml-3 text-sm text-dark-5">Loading channels...</span>
            </div>
          ) : channels.length === 0 ? (
            <p className="py-8 text-center text-sm text-dark-5">{emptyText}</p>
          ) : (
            <div className="space-y-3">
              {channels.map((c) => {
                const member = new Set(c.listMemberships.map((m) => m.id));
                const addable = lists.filter((l) => !member.has(l.id));
                const confirming = confirm?.channel.channelId === c.channelId ? confirm : null;
                return (
                  <div key={c.channelId} className="rounded-lg border border-stroke bg-white p-3 dark:border-white/10 dark:bg-transparent">
                    <div className="flex items-center gap-3">
                      <ChannelAvatar name={c.channelName} src={c.channelAvatar} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-dark dark:text-white">{c.channelName}</p>
                        <p className="truncate text-sm text-dark-5">
                          {c.subscriberCount != null ? `${c.subscriberCount.toLocaleString("en-US")} subscribers` : "Followed channel"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {c.listMemberships.length > 0 ? (
                            c.listMemberships.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                title={`Remove from ${m.name}`}
                                onClick={() => setConfirm({ type: "remove", channel: c, listId: m.id, listName: m.name, alsoUnfollow: false })}
                                className="inline-flex max-w-full items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-dark transition hover:bg-gray-200 dark:bg-white/10 dark:text-white"
                              >
                                <span className="truncate">{m.name}</span>
                                <X className="size-3" />
                              </button>
                            ))
                          ) : (
                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-dark-5 dark:bg-white/10">Not in a list</span>
                          )}
                          <button
                            type="button"
                            disabled={!addable.length}
                            title={addable.length ? "Add to a list" : "This channel is already in every list"}
                            aria-label={`Add ${c.channelName} to a list`}
                            onClick={() => {
                              setConfirm(null);
                              setAddingFor((id) => (id === c.channelId ? null : c.channelId));
                            }}
                            className="inline-flex items-center gap-1 rounded-full border border-dashed border-stroke bg-white px-2.5 py-1 text-xs font-medium text-dark transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-transparent dark:text-white"
                          >
                            <Plus className="size-3" />
                            Add to list
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirm({ type: "unfollow", channel: c, alsoUnfollow: true })}
                        className="flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                      >
                        Unfollow
                      </button>
                    </div>
                    {addingFor === c.channelId && (
                      <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/5">
                        <p className="font-medium text-dark dark:text-white">Add {c.channelName} to a list</p>
                        {addable.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {addable.map((l) => (
                              <button
                                key={l.id}
                                type="button"
                                disabled={working === `${c.channelId}:${l.id}`}
                                onClick={() => void addToList(c, l)}
                                className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-dark transition hover:bg-primary hover:text-white disabled:opacity-50 dark:bg-white/10 dark:text-white"
                              >
                                {working === `${c.channelId}:${l.id}` ? "Adding..." : l.name}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 text-dark-5">This channel is already in every list.</p>
                        )}
                        <div className="mt-3 flex justify-end">
                          <button type="button" onClick={() => setAddingFor(null)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-dark-5 hover:bg-gray-100 dark:hover:bg-white/10">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {confirming && (
                      <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/5">
                        <p className="font-medium text-dark dark:text-white">
                          {confirming.type === "unfollow" ? `Unfollow ${c.channelName}?` : `Remove ${c.channelName} from ${confirming.listName}?`}
                        </p>
                        <p className="mt-1 text-dark-5">
                          {confirming.type === "unfollow"
                            ? "This removes the channel from Following and all lists."
                            : "The channel will stay followed, so its videos can still appear in Following."}
                        </p>
                        {confirming.type === "remove" && (
                          <label className="mt-3 flex items-start gap-2 text-sm text-dark dark:text-white">
                            <input
                              type="checkbox"
                              checked={confirming.alsoUnfollow}
                              onChange={(e) => setConfirm({ ...confirming, alsoUnfollow: e.target.checked })}
                              className="mt-0.5 size-4 accent-[#164466]"
                            />
                            <span>Also unfollow this channel and remove it from all lists</span>
                          </label>
                        )}
                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirm(null)}
                            disabled={working === c.channelId}
                            className="rounded-lg px-3 py-1.5 text-xs font-medium text-dark-5 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-white/10"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void runConfirm()}
                            disabled={working === c.channelId}
                            className={cn(
                              "rounded-lg px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-50",
                              confirming.type === "unfollow" || confirming.alsoUnfollow ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary/90",
                            )}
                          >
                            {working === c.channelId ? "Working..." : confirming.type === "unfollow" || confirming.alsoUnfollow ? "Unfollow" : "Remove"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
