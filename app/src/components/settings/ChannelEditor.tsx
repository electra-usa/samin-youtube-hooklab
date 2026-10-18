"use client";

import { useCallback, useEffect, useImperativeHandle, useState, type Ref } from "react";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { ApiError, getJson, sendJson } from "@/lib/api-client";
import { NICHES } from "@/lib/taxonomy";
import { cn } from "@/lib/format";
import type { UserChannel } from "@/lib/db/app";
import {
  BANNED_PUNCTUATION_OPTIONS,
  DEFAULT_STYLE_GUIDE,
  MAX_TOPICS,
  parseBannedPunctuation,
  type ChannelProfileBody,
  type ChatPreferences,
  type DataSources,
  type StyleGuide,
} from "./shared";
import { CheckSquare, FieldLabel, MultiSelectDropdown, PillListInput, RangeSlider, SectionHeading, SingleSlider } from "./ui";
import { useAutosave } from "./useAutosave";

export type ChannelEditorHandle = { flush: () => Promise<boolean> };

type Context = { primaryNiches: string[]; topics: string[] };
type ProfileText = { overview: string; aboutMyChannel: string };
type Prefs = {
  additionalInstructions: string;
  listIds: string[];
  tags: string[];
  listInstructions: Record<string, string>;
};

const textareaClass =
  "w-full rounded-lg border border-stroke bg-white px-4 py-2.5 text-sm leading-relaxed text-dark outline-none transition placeholder:text-dark-5 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-70 dark:border-white/15 dark:bg-transparent dark:text-white";

const failMessage = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// Per-channel settings: style guide, channel context (profile, niches, topics) and the chat
// data sources. Every section autosaves; "Save" flushes them all at once.
export function ChannelEditor({
  channel,
  onRemove,
  ref,
}: {
  channel: UserChannel;
  onRemove: () => void;
  ref?: Ref<ChannelEditorHandle>;
}) {
  const id = channel.id;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sources, setSources] = useState<DataSources>({ lists: [], bookmarkTags: [] });
  const [hasOverview, setHasOverview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [openInstructions, setOpenInstructions] = useState<string[]>([]);

  const style = useAutosave<StyleGuide>(
    DEFAULT_STYLE_GUIDE,
    useCallback(
      async (v: StyleGuide) => {
        try {
          await sendJson("/api/user/style-guide", "PATCH", { userChannelId: id, ...v });
        } catch (err) {
          toast.error(failMessage(err, "Couldn't save the style guide"));
          throw err;
        }
      },
      [id],
    ),
  );

  const context = useAutosave<Context>(
    { primaryNiches: [], topics: [] },
    useCallback(
      async (v: Context) => {
        try {
          await sendJson("/api/user/channel-profile", "PATCH", { userChannelId: id, primaryNiches: v.primaryNiches, topics: v.topics });
        } catch (err) {
          toast.error(failMessage(err, "Couldn't save your niche and topics"));
          throw err;
        }
      },
      [id],
    ),
  );

  const profileText = useAutosave<ProfileText>(
    { overview: "", aboutMyChannel: "" },
    useCallback(
      async (v: ProfileText) => {
        try {
          const body: Record<string, string> = { userChannelId: id, aboutMyChannel: v.aboutMyChannel };
          if (v.overview.trim()) body.overview = v.overview;
          await sendJson("/api/user/channel-profile", "PATCH", body);
        } catch (err) {
          toast.error(failMessage(err, "Couldn't save the channel profile"));
          throw err;
        }
      },
      [id],
    ),
    900,
  );

  const prefs = useAutosave<Prefs>(
    { additionalInstructions: "", listIds: [], tags: [], listInstructions: {} },
    useCallback(
      async (v: Prefs) => {
        try {
          // Everything selected is saved as null ("all"), so lists and tags added later are included too.
          await sendJson("/api/user/chat-preferences", "PATCH", {
            userChannelId: id,
            additionalInstructions: v.additionalInstructions,
            listIdsToUse: sources.lists.every((l) => v.listIds.includes(l.id)) ? null : v.listIds,
            bookmarkTagsToUse: sources.bookmarkTags.every((t) => v.tags.includes(t)) ? null : v.tags,
            listInstructions: v.listInstructions,
          });
        } catch (err) {
          toast.error(failMessage(err, "Couldn't save chat preferences"));
          throw err;
        }
      },
      [id, sources],
    ),
    900,
  );

  const { load: loadStyle } = style;
  const { load: loadContext } = context;
  const { load: loadProfileText } = profileText;
  const { load: loadPrefs } = prefs;

  const loadProfile = useCallback(
    (body: ChannelProfileBody) => {
      loadContext({ primaryNiches: body.primaryNiches, topics: body.topics });
      loadProfileText({ overview: body.profile?.overview ?? "", aboutMyChannel: body.profile?.aboutMyChannel ?? "" });
      setHasOverview(!!body.profile?.overview?.trim());
    },
    [loadContext, loadProfileText],
  );

  useEffect(() => {
    let alive = true;
    Promise.all([
      getJson<{ styleGuide: StyleGuide | null }>(`/api/user/style-guide?userChannelId=${id}`),
      getJson<ChannelProfileBody>(`/api/user/channel-profile?userChannelId=${id}`),
      getJson<{ chatPreferences: ChatPreferences | null; dataSources: DataSources }>(`/api/user/chat-preferences?userChannelId=${id}`),
    ])
      .then(([sg, profile, cp]) => {
        if (!alive) return;
        const p = cp.chatPreferences;
        const ds = cp.dataSources;
        loadStyle(sg.styleGuide ?? DEFAULT_STYLE_GUIDE);
        loadProfile(profile);
        setSources(ds);
        loadPrefs({
          additionalInstructions: p?.additionalInstructions ?? "",
          // null means "all" (the original's default).
          listIds: p?.listIdsToUse ?? ds.lists.map((l) => l.id),
          tags: p?.bookmarkTagsToUse ?? ds.bookmarkTags,
          listInstructions: p?.listInstructions ?? {},
        });
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setLoadError(failMessage(err, "Couldn't load this channel's settings"));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, loadStyle, loadProfile, loadPrefs]);

  const sections = [style, context, profileText, prefs];
  const dirty = sections.some((s) => s.status === "dirty" || s.status === "error");
  const saving = sections.some((s) => s.status === "saving");

  const flushAll = useCallback(async () => {
    const pending = [style, context, profileText, prefs].filter((s) => s.status === "dirty" || s.status === "error");
    const results = await Promise.all(pending.map((s) => s.flush()));
    return results.every(Boolean);
  }, [style, context, profileText, prefs]);

  useImperativeHandle(ref, () => ({ flush: flushAll }), [flushAll]);

  const saveAll = async () => {
    if (await flushAll()) toast.success("Channel settings saved");
  };

  const generateProfile = async () => {
    setGenerating(true);
    try {
      await sendJson("/api/chat/channel-profile", "POST", { userChannelId: id });
      loadProfile(await getJson<ChannelProfileBody>(`/api/user/channel-profile?userChannelId=${id}`));
      toast.success("Channel profile generated");
    } catch (err) {
      const missing = err instanceof ApiError && (err.status === 404 || err.status === 405);
      toast.error(missing ? "Profile generation isn't available yet. Write the summary yourself for now." : failMessage(err, "Couldn't generate the profile"));
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <p className="pt-6 text-sm text-dark-5">Loading channel settings…</p>;
  if (loadError) return <p className="pt-6 text-sm text-red-600">{loadError}</p>;

  const sg = style.value;
  const banned = parseBannedPunctuation(sg.bannedPunctuation);
  const pv = prefs.value;
  const allLists = sources.lists.length > 0 && sources.lists.every((l) => pv.listIds.includes(l.id));
  const allTags = sources.bookmarkTags.length > 0 && sources.bookmarkTags.every((t) => pv.tags.includes(t));

  return (
    <>
      <div className="mb-4 pt-6">
        <SectionHeading>Title &amp; Thumbnail Text Preferences</SectionHeading>
        <div className="space-y-4">
          <div className="max-w-[400px]">
            <FieldLabel htmlFor="max-title-length">Max title length (characters)</FieldLabel>
            <SingleSlider
              id="max-title-length"
              ariaLabel="Max title length"
              min={0}
              max={100}
              value={sg.maxTitleLength}
              onChange={(v) => style.update({ maxTitleLength: v })}
            />
          </div>
          <div className="max-w-[400px]">
            <FieldLabel>Thumbnail text word count</FieldLabel>
            <RangeSlider
              ariaLabel="Thumbnail text word count"
              min={0}
              max={10}
              low={sg.minThumbnailWords}
              high={sg.maxThumbnailWords}
              onChange={(lo, hi) => style.update({ minThumbnailWords: lo, maxThumbnailWords: hi })}
            />
          </div>
          <div className="max-w-[520px]">
            <MultiSelectDropdown
              label="Banned punctuation"
              placeholder="Select punctuation to ban"
              options={BANNED_PUNCTUATION_OPTIONS}
              selected={banned}
              onChange={(next) => style.update({ bannedPunctuation: next.length ? JSON.stringify(next) : "" })}
            />
          </div>
          <div className="max-w-[520px]">
            <FieldLabel htmlFor="banned-words">Banned words &amp; phrases</FieldLabel>
            <PillListInput
              id="banned-words"
              values={sg.bannedWordsPhrases}
              onChange={(next) => style.update({ bannedWordsPhrases: next })}
              placeholder="Type a word or phrase"
            />
          </div>
          <div className="max-w-[520px]">
            <FieldLabel htmlFor="additional-instructions" hint={'Custom instructions for the AI (e.g., "Start every title with “I”")'}>
              Additional instructions
            </FieldLabel>
            <textarea
              id="additional-instructions"
              rows={3}
              value={pv.additionalInstructions}
              onChange={(e) => prefs.update({ additionalInstructions: e.target.value })}
              placeholder="Enter special instructions"
              className={cn(textareaClass, "mt-1")}
            />
          </div>
        </div>
      </div>

      <div className="pt-6">
        <SectionHeading>Script &amp; Intro Preferences</SectionHeading>
        <div className="max-w-[520px]">
          <FieldLabel htmlFor="writing-rules">Writing rules</FieldLabel>
          <textarea
            id="writing-rules"
            rows={4}
            value={sg.scriptWritingRules}
            onChange={(e) => style.update({ scriptWritingRules: e.target.value })}
            placeholder="Enter writing rules"
            className={textareaClass}
          />
        </div>
      </div>

      <div className="pt-6">
        <SectionHeading>Channel Context</SectionHeading>
        <div className="space-y-3">
          <div className="max-w-[520px]">
            <MultiSelectDropdown
              label="Your niche"
              placeholder="Select one or more niches"
              options={NICHES}
              selected={context.value.primaryNiches}
              onChange={(next) => context.update({ primaryNiches: next })}
            />
          </div>
          <div className="max-w-[520px]">
            <FieldLabel htmlFor="channel-topics">Topics</FieldLabel>
            <PillListInput
              id="channel-topics"
              values={context.value.topics}
              onChange={(next) => context.update({ topics: next })}
              normalize={(v) => v.trim().toLowerCase()}
              max={MAX_TOPICS}
              placeholder="Type a topic..."
            />
            {context.value.topics.length === 0 && (
              <p className="mt-2 text-xs text-dark-5">No topics yet. Add at least 3 to improve in-niche recommendations.</p>
            )}
          </div>
          {hasOverview ? (
            <>
              <div className="max-w-[520px]">
                <FieldLabel htmlFor="channel-overview">Short summary of your audience and niche.</FieldLabel>
                <textarea
                  id="channel-overview"
                  rows={5}
                  value={profileText.value.overview}
                  onChange={(e) => profileText.update({ overview: e.target.value })}
                  placeholder="Edit the channel profile…"
                  className={textareaClass}
                />
              </div>
              <Button variant="ghost" size="sm" onClick={generateProfile} disabled={generating} className="text-dark-5">
                {generating ? "Regenerating…" : "Regenerate"}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={generateProfile} disabled={generating}>
              {generating ? "Generating…" : "Generate profile"}
            </Button>
          )}
          <div className="max-w-[520px] pt-2">
            <FieldLabel htmlFor="about-channel" hint="Add recurring characters, formats, host details, or context the AI should know.">
              About my channel
            </FieldLabel>
            <textarea
              id="about-channel"
              rows={4}
              value={profileText.value.aboutMyChannel}
              onChange={(e) => profileText.update({ aboutMyChannel: e.target.value })}
              placeholder="Type your channel context"
              className={cn(textareaClass, "mt-1")}
            />
          </div>
        </div>
      </div>

      <div className="pt-6">
        <SectionHeading>Data sources</SectionHeading>
        <div className="space-y-6">
          <div>
            <FieldLabel hint="Select which lists the AI can reference for inspiration">Following Lists</FieldLabel>
            {sources.lists.length ? (
              <div className="mt-2 max-w-lg overflow-hidden rounded-lg border border-stroke bg-white dark:border-white/15 dark:bg-transparent">
                <button
                  type="button"
                  onClick={() => prefs.update({ listIds: allLists ? [] : sources.lists.map((l) => l.id) })}
                  className="flex w-full items-center gap-3 border-b border-stroke px-3 py-2.5 text-left transition hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"
                >
                  <CheckSquare checked={allLists} />
                  <span className="text-sm font-medium text-dark dark:text-white">All lists</span>
                </button>
                {sources.lists.map((list) => {
                  const on = pv.listIds.includes(list.id);
                  const open = openInstructions.includes(list.id);
                  const text = pv.listInstructions[list.id] ?? "";
                  return (
                    <div key={list.id}>
                      <div className="flex items-center gap-2 px-3 py-2.5 transition hover:bg-gray-50 dark:hover:bg-white/5">
                        <button
                          type="button"
                          onClick={() => prefs.update({ listIds: on ? pv.listIds.filter((x) => x !== list.id) : [...pv.listIds, list.id] })}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <CheckSquare checked={on} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-dark dark:text-white">{list.name}</span>
                        </button>
                        {on && (
                          <button
                            type="button"
                            onClick={() =>
                              setOpenInstructions((ids) => (ids.includes(list.id) ? ids.filter((x) => x !== list.id) : [...ids, list.id]))
                            }
                            className="flex-shrink-0 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-dark-5 transition hover:bg-gray-200 hover:text-dark dark:bg-white/10 dark:hover:bg-white/15 dark:hover:text-white"
                          >
                            {open ? (text.trim() ? "Save instructions" : "Hide instructions") : text.trim() ? "See instructions" : "Add instructions"}
                          </button>
                        )}
                        <Link
                          href="/following"
                          title="Manage list"
                          aria-label={`Manage list ${list.name}`}
                          className="flex-shrink-0 rounded p-1 text-dark-5 transition hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10 dark:hover:text-white"
                        >
                          <Settings2 className="size-4" />
                        </Link>
                      </div>
                      {on && open && (
                        <div className="border-t border-stroke bg-gray-50 px-3 py-3 dark:border-white/10 dark:bg-white/5">
                          <input
                            value={text}
                            autoFocus
                            onChange={(e) => prefs.update({ listInstructions: { ...pv.listInstructions, [list.id]: e.target.value } })}
                            onKeyDown={(e) => e.key === "Enter" && setOpenInstructions((ids) => ids.filter((x) => x !== list.id))}
                            placeholder="e.g., Focus on their hooks and opening lines"
                            aria-label={`Instructions for ${list.name}`}
                            className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition placeholder:text-dark-5 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-white/15 dark:bg-transparent dark:text-white"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-dark-5">No lists found. Create a list in the Following page to add competitors.</p>
            )}
          </div>
          <div>
            <FieldLabel hint="Select which bookmark tags the AI can reference">Bookmark Tags</FieldLabel>
            {sources.bookmarkTags.length ? (
              <div className="mt-2 max-w-lg overflow-hidden rounded-lg border border-stroke bg-white dark:border-white/15 dark:bg-transparent">
                <button
                  type="button"
                  onClick={() => prefs.update({ tags: allTags ? [] : [...sources.bookmarkTags] })}
                  className="flex w-full items-center gap-3 border-b border-stroke px-3 py-2.5 text-left transition hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"
                >
                  <CheckSquare checked={allTags} />
                  <span className="text-sm font-medium text-dark dark:text-white">All bookmark tags</span>
                </button>
                {sources.bookmarkTags.map((tag) => {
                  const on = pv.tags.includes(tag);
                  return (
                    <div key={tag} className="flex items-center gap-2 px-3 py-2.5 transition hover:bg-gray-50 dark:hover:bg-white/5">
                      <button
                        type="button"
                        onClick={() => prefs.update({ tags: on ? pv.tags.filter((t) => t !== tag) : [...pv.tags, tag] })}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <CheckSquare checked={on} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-dark dark:text-white">{tag}</span>
                      </button>
                      <Link
                        href="/bookmarks"
                        title="Manage tag"
                        aria-label={`Manage tag ${tag}`}
                        className="flex-shrink-0 rounded p-1 text-dark-5 transition hover:bg-gray-100 hover:text-dark dark:hover:bg-white/10 dark:hover:text-white"
                      >
                        <Settings2 className="size-4" />
                      </Link>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-dark-5">No bookmark tags found. Tag bookmarks to organize them.</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg bg-gray-100 px-6 py-[11px] text-sm font-medium text-red-600 transition hover:bg-gray-200 dark:bg-white/10 dark:text-red-400 dark:hover:bg-white/15"
        >
          Remove Channel
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-dark-5" aria-live="polite">
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <Button size="lg" className="px-6" onClick={saveAll} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </>
  );
}
