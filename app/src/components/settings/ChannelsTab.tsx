"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { sendJson } from "@/lib/api-client";
import { formatCount } from "@/lib/format";
import type { UserChannel } from "@/lib/db/app";
import { AddChannelModal } from "./AddChannelModal";
import { ChannelAvatar, ChannelSelect } from "./ChannelSelect";
import { ChannelEditor, type ChannelEditorHandle } from "./ChannelEditor";
import { SettingsCard } from "./ui";

// The sidebar loads the channel list once, so after adding, removing or activating a
// channel the page reloads (staying on this tab) to keep the sidebar switcher in sync.
function reloadOnChannelsTab() {
  window.history.replaceState(null, "", "/settings#channels");
  window.location.reload();
}

export function ChannelsTab({
  initialChannels,
  maxChannels,
  startAdding = false,
}: {
  initialChannels: UserChannel[];
  maxChannels: number;
  /** Open the Add Channel dialog on arrival (?tab=channels&add=1). */
  startAdding?: boolean;
}) {
  const channels = initialChannels;
  const [editingId, setEditingId] = useState<string | null>(() => (channels.find((c) => c.isActive) ?? channels[0])?.id ?? null);
  const [addOpen, setAddOpen] = useState(startAdding && initialChannels.length < maxChannels);
  const [busyId, setBusyId] = useState<string | null>(null);
  const editorRef = useRef<ChannelEditorHandle>(null);
  const editing = channels.find((c) => c.id === editingId) ?? null;
  const atLimit = channels.length >= maxChannels;

  const flushEditor = async () => {
    await editorRef.current?.flush().catch(() => false);
  };

  const setActive = async (channel: UserChannel) => {
    setBusyId(channel.id);
    try {
      await flushEditor();
      await sendJson("/api/me/channel", "POST", { userChannelId: channel.id });
      reloadOnChannelsTab();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't switch channels");
      setBusyId(null);
    }
  };

  const remove = async (channel: UserChannel) => {
    if (!window.confirm(`Remove ${channel.name ?? "this channel"}? This deletes its profile, style guide, chat preferences and synced videos.`)) {
      return;
    }
    setBusyId(channel.id);
    try {
      await sendJson(`/api/user/channels/${channel.id}`, "DELETE");
      reloadOnChannelsTab();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove the channel");
      setBusyId(null);
    }
  };

  const openAdd = () => {
    if (atLimit) return toast.error(`You've reached your channel limit (${maxChannels} of ${maxChannels}).`);
    setAddOpen(true);
  };

  const addModal = (
    <AddChannelModal
      open={addOpen}
      onClose={() => setAddOpen(false)}
      onAdded={async () => {
        await flushEditor();
        reloadOnChannelsTab();
      }}
    />
  );

  if (channels.length === 0) {
    return (
      <SettingsCard title="Channels" description="Add your first YouTube channel to get started.">
        <Button size="lg" className="px-6" onClick={openAdd}>
          Add Channel
        </Button>
        {addModal}
      </SettingsCard>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsCard title="Your Channels" description="Chat and My Channel work with your active channel.">
        <ul className="divide-y divide-stroke rounded-lg border border-stroke dark:divide-white/10 dark:border-white/15">
          {channels.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <ChannelAvatar name={c.name} avatar={c.avatar} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-dark dark:text-white">{c.name ?? "Untitled channel"}</span>
                  {c.isActive && (
                    <span className="brand-accent-blue-chip inline-flex rounded-full px-2 py-0.5 text-xs font-medium">Active</span>
                  )}
                </div>
                <p className="truncate text-sm text-dark-5">
                  {[c.handle, c.subscriberCount != null ? `${formatCount(c.subscriberCount)} subscribers` : null].filter(Boolean).join(" · ") ||
                    c.channelId}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {!c.isActive && (
                  <Button variant="soft" size="sm" disabled={busyId !== null} onClick={() => setActive(c)}>
                    {busyId === c.id ? "Switching…" : "Set active"}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId !== null}
                  onClick={() => {
                    setEditingId(c.id);
                    document.getElementById("channel-style-guide")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  Edit settings
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId !== null}
                  onClick={() => remove(c)}
                  className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {atLimit ? (
            <p className="text-sm text-dark-5">
              You&apos;ve reached your channel limit ({maxChannels} of {maxChannels}).{" "}
              <a href="/settings#billing" className="font-medium text-accent-blue-text hover:underline">
                Upgrade your plan
              </a>{" "}
              to add more.
            </p>
          ) : (
            <p className="text-sm text-dark-5">
              Add another channel ({channels.length} of {maxChannels} used)
            </p>
          )}
          <Button size="lg" className="px-6" onClick={openAdd} disabled={atLimit}>
            Add Channel
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard id="channel-style-guide" title="Channel & Style Guide" className="bg-[#fcfcfc] dark:bg-[#18191c]">
        <div className="mb-6">
          <p className="mb-2 text-sm font-medium text-dark dark:text-white">Select Channel</p>
          <ChannelSelect
            ariaLabel="Select channel to edit"
            channels={channels}
            value={editingId}
            onChange={(next) => next && setEditingId(next)}
            footer={(close) =>
              atLimit ? (
                <p className="px-2.5 py-2 text-sm text-dark-5">Channel limit reached</p>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    openAdd();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-primary transition hover:bg-gray-100 dark:text-sky-200 dark:hover:bg-white/10"
                >
                  <Plus className="size-5" /> Add channel
                </button>
              )
            }
          />
        </div>
        {editing && <ChannelEditor key={editing.id} ref={editorRef} channel={editing} onRemove={() => remove(editing)} />}
      </SettingsCard>
      {addModal}
    </div>
  );
}
