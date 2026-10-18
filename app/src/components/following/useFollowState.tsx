"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { actionToast } from "@/components/outliers/ActionToast";
import { sendJson } from "@/lib/api-client";
import { cn } from "@/lib/format";
import type { FollowingListSummary } from "@/lib/research/types";

type ChannelRef = { channelId: string; channelName: string; subscriberCount?: number | null };

/** "Add to lists" picker shown after following a channel (original FollowingVideoCard popover). */
export function AddToListsModal({
  channel,
  lists,
  onClose,
  onDone,
}: {
  channel: ChannelRef | null;
  lists: FollowingListSummary[];
  onClose: () => void;
  onDone: (channel: ChannelRef, listIds: string[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const close = () => {
    setPicked(new Set());
    onClose();
  };
  return (
    <Modal
      open={!!channel}
      onClose={close}
      size="sm"
      title={
        <div>
          <div className="text-base font-semibold">Add to lists</div>
          <p className="mt-0.5 text-xs font-normal text-dark-5">Choose one or more lists.</p>
        </div>
      }
      footer={
        <button
          type="button"
          disabled={!picked.size || busy}
          onClick={async () => {
            if (!channel) return;
            setBusy(true);
            await onDone(channel, [...picked]);
            setBusy(false);
            close();
          }}
          className={cn(
            "w-full rounded-lg py-2 text-sm font-medium transition",
            picked.size && !busy ? "bg-primary text-white hover:bg-primary/90" : "cursor-not-allowed bg-gray-100 text-dark-5 dark:bg-white/10",
          )}
        >
          {busy ? "Adding..." : "Done"}
        </button>
      }
    >
      <div className="-mx-2 space-y-0.5">
        {lists.map((l) => {
          const added = !!channel && l.channelIds.includes(channel.channelId);
          const on = added || picked.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              disabled={added}
              onClick={() =>
                setPicked((p) => {
                  const next = new Set(p);
                  if (next.has(l.id)) next.delete(l.id);
                  else next.add(l.id);
                  return next;
                })
              }
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition",
                added ? "cursor-default opacity-70" : "hover:bg-gray-100 dark:hover:bg-white/5",
              )}
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border",
                  on ? "border-primary bg-primary text-white" : "border-stroke dark:border-white/20",
                )}
              >
                {on && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className={cn("min-w-0 flex-1 truncate", on ? "text-dark dark:text-white" : "text-dark-5")}>{l.name}</span>
              {added && <span className="shrink-0 text-xs text-dark-5">Added</span>}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/**
 * Follow / unfollow from video cards plus the list memberships needed for "Add to a list".
 * `onChange` lets a page react (Following drops an unfollowed channel's videos).
 */
export function useFollowState({
  initialFollowed,
  initialLists,
  onChange,
}: {
  initialFollowed: string[];
  initialLists: FollowingListSummary[];
  onChange?: (channelId: string, followed: boolean) => void;
}) {
  const [followed, setFollowed] = useState(() => new Set(initialFollowed));
  const [lists, setLists] = useState(initialLists);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [listTarget, setListTarget] = useState<ChannelRef | null>(null);

  const setFollowedFlag = (channelId: string, on: boolean) =>
    setFollowed((s) => {
      const next = new Set(s);
      if (on) next.add(channelId);
      else next.delete(channelId);
      return next;
    });

  const toggleFollow = async (channel: { channelId: string | null; channelName: string | null; subscriberCount?: number | null }) => {
    const id = channel.channelId;
    if (!id || pending.has(id)) return;
    const name = channel.channelName ?? "channel";
    const wasFollowed = followed.has(id);
    setPending((p) => new Set(p).add(id));
    setFollowedFlag(id, !wasFollowed);
    try {
      if (wasFollowed) {
        await sendJson(`/api/following/channels?channelId=${encodeURIComponent(id)}`, "DELETE");
        setLists((ls) => ls.map((l) => ({ ...l, channelIds: l.channelIds.filter((c) => c !== id) })));
        toast.success(`Unfollowed ${name}`);
      } else {
        await sendJson("/api/following/channels", "POST", { channelId: id, channelName: name, subscriberCount: channel.subscriberCount ?? null });
        if (lists.length) actionToast(`Following ${name}`, "Add to a list", () => setListTarget({ channelId: id, channelName: name }));
        else toast.success(`Following ${name}`);
      }
      onChange?.(id, !wasFollowed);
    } catch (err) {
      setFollowedFlag(id, wasFollowed);
      toast.error(err instanceof Error ? err.message : "Couldn't update follow");
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(id);
        return next;
      });
    }
  };

  const addToLists = async (channel: ChannelRef, listIds: string[]) => {
    const targets = listIds.filter((lid) => !lists.find((l) => l.id === lid)?.channelIds.includes(channel.channelId));
    const results = await Promise.allSettled(
      targets.map((lid) =>
        sendJson(`/api/following/lists/${lid}/channels`, "POST", { channelId: channel.channelId, channelName: channel.channelName }),
      ),
    );
    const ok = targets.filter((_, i) => results[i].status === "fulfilled");
    if (ok.length) {
      setLists((ls) => ls.map((l) => (ok.includes(l.id) && !l.channelIds.includes(channel.channelId) ? { ...l, channelIds: [...l.channelIds, channel.channelId] } : l)));
      setFollowedFlag(channel.channelId, true);
      const first = lists.find((l) => l.id === ok[0])?.name ?? "list";
      toast.success(ok.length === 1 ? `Added ${channel.channelName} to ${first}` : `Added ${channel.channelName} to ${ok.length} lists`);
    }
    if (ok.length < targets.length) toast.error("Some lists couldn't be updated");
  };

  const modals = <AddToListsModal channel={listTarget} lists={lists} onClose={() => setListTarget(null)} onDone={addToLists} />;

  return { followed, lists, setLists, setFollowed, toggleFollow, isPending: (id: string | null) => !!id && pending.has(id), modals };
}
