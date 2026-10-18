"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Folder, FolderPlus, Pencil, Plus } from "lucide-react";
import { AddToProjectModal } from "@/components/projects/AddToProjectModal";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { sendJson } from "@/lib/api-client";
import { cn } from "@/lib/format";
import {
  DEFAULT_STATE,
  STUDIO_TABS,
  buildCombos,
  defaultWorkspaceName,
  hasContent,
  isBlank,
  normalizeState,
  realCombos,
  toSnapshot,
  withoutLocalThumbnails,
  type StudioState,
  type StudioView as View,
  type StyleSettings,
} from "./model";
import { preloadStudioFonts } from "./fonts";
import { importVideoThumbnail, uploadThumbnail } from "./uploads";
import { StudioLanding } from "./StudioLanding";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { StyleToolbar } from "./StyleToolbar";
import { ComboCard } from "./ComboCard";
import { BlurTestView, DevicesView, TinyTestView } from "./StudioViews";
import { YouTubePreview } from "./YouTubePreview";
import { ShareView } from "./ShareView";

export type StudioWorkspaceRecord = {
  id: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  state: unknown;
  updatedAt: string;
};

type Meta = { id: string | null; name: string | null; projectId: string | null; projectName: string | null };
const NO_WORKSPACE: Meta = { id: null, name: null, projectId: null, projectName: null };
const DRAFT_KEY = "hooklab.studio-draft";
const AUTOSAVE_MS = 1_200;

export type StudioProps = {
  channelName: string;
  channelAvatar: string | null;
  initialWorkspace: StudioWorkspaceRecord | null;
  workspaceMissing: boolean;
  prefillTitle: string | null;
  prefillVideoId: string | null;
  projectName: string | null;
};

type Draft = { state: StudioState; workspace: Meta };

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { state?: unknown; workspace?: Partial<Meta> };
    return { state: normalizeState(d.state), workspace: { ...NO_WORKSPACE, ...(d.workspace ?? {}) } };
  } catch {
    return null;
  }
}

const fromRecord = (r: StudioWorkspaceRecord): Meta => ({ id: r.id, name: r.name, projectId: r.projectId, projectName: r.projectName });
const snapshotKey = (s: StudioState) => JSON.stringify(toSnapshot(withoutLocalThumbnails(s)));

function setUrl(params: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

/** Work out the starting workspace from the URL, the server record and this tab's draft. */
function initialStudio(p: StudioProps): { state: StudioState; meta: Meta; replace: StudioWorkspaceRecord | null; saved: string | null } {
  const draft = readDraft();
  let state = draft?.state ?? DEFAULT_STATE;
  let meta = draft?.workspace ?? NO_WORKSPACE;
  let replace: StudioWorkspaceRecord | null = null;
  let saved: string | null = null;
  const ws = p.initialWorkspace;
  if (ws) {
    if (draft?.workspace.id === ws.id) {
      meta = fromRecord(ws); // keep this tab's draft state; it may hold edits not yet autosaved
    } else if (draft && hasContent(draft.state) && !draft.workspace.id) {
      replace = ws; // don't silently drop an unsaved draft
    } else {
      state = normalizeState(ws.state);
      meta = fromRecord(ws);
      saved = snapshotKey(state);
    }
  }
  if (!ws && p.prefillTitle?.trim()) {
    const title = p.prefillTitle.trim();
    const titles = state.titles.filter((t) => t.trim());
    const at = titles.findIndex((t) => t.trim().toLowerCase() === title.toLowerCase());
    state =
      at >= 0
        ? { ...state, titles, selectedTitleIndices: [at] }
        : { ...state, titles: [...titles, title], selectedTitleIndices: [titles.length], activeView: "workspace" };
  }
  return { state, meta, replace, saved };
}

export function StudioView(props: StudioProps) {
  const [init] = useState(() => initialStudio(props));
  const [state, setState] = useState<StudioState>(init.state);
  const [ws, setWs] = useState<Meta>(init.meta);
  const [replaceWith, setReplaceWith] = useState<StudioWorkspaceRecord | null>(init.replace);
  const [confirmNew, setConfirmNew] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const lastSaved = useRef<string | null>(init.saved);
  const saveErrorShown = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);

  const { titles, thumbnailTexts, thumbnails, styleSettings, activeView } = state;
  const update = useCallback((fn: (s: StudioState) => StudioState) => setState(fn), []);

  // One-time effects of the URL: missing workspace, prefill image from a video.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    preloadStudioFonts();
    if (props.workspaceMissing) {
      toast.error("Couldn't load the saved workspace");
      setUrl({ workspaceId: null });
    }
    if (props.prefillTitle || props.prefillVideoId) setUrl({ prefillTitle: null, title: null, videoTitle: null, videoId: null });
    if (props.prefillVideoId && !props.initialWorkspace) {
      importVideoThumbnail(props.prefillVideoId)
        .then(({ publicUrl }) =>
          setState((s) =>
            s.thumbnails.includes(publicUrl)
              ? s
              : { ...s, thumbnails: [...s.thumbnails, publicUrl], selectedThumbnailIndices: [s.thumbnails.length] },
          ),
        )
        .catch(() => toast.error("Couldn't load that video's thumbnail"));
    }
  }, [props.workspaceMissing, props.prefillTitle, props.prefillVideoId, props.initialWorkspace]);

  // Keep this tab's draft (as the original does with sessionStorage).
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ state: withoutLocalThumbnails(state), workspace: ws }));
    } catch {
      // storage full or disabled
    }
  }, [state, ws]);

  // Autosave a saved workspace 1.2 s after the last change (skipped while uploads are in flight).
  const key = useMemo(() => snapshotKey(state), [state]);
  const uploading = thumbnails.some((t) => t.startsWith("blob:"));
  useEffect(() => {
    if (!ws.id || uploading || key === lastSaved.current) return;
    const id = ws.id;
    const timer = setTimeout(() => {
      sendJson(`/api/studio/workspaces/${id}`, "PATCH", { state: JSON.parse(key) })
        .then(() => {
          lastSaved.current = key;
          saveErrorShown.current = false;
        })
        .catch(() => {
          if (!saveErrorShown.current) toast.error("Couldn't auto-save workspace updates");
          saveErrorShown.current = true;
        });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [key, ws.id, uploading]);

  // ---- list editing (selection follows the original: new items get selected) ----
  const setTitles = (next: string[]) =>
    update((s) => ({
      ...s,
      titles: next,
      selectedTitleIndices:
        next.length > s.titles.length ? [...new Set([...s.selectedTitleIndices, next.length - 1])].sort((a, b) => a - b) : s.selectedTitleIndices,
    }));
  const setTexts = (next: string[]) =>
    update((s) => ({
      ...s,
      thumbnailTexts: next,
      selectedThumbnailTextIndices:
        next.length > s.thumbnailTexts.length
          ? [...new Set([...s.selectedThumbnailTextIndices, next.length - 1])].sort((a, b) => a - b)
          : s.selectedThumbnailTextIndices,
    }));
  const toggle = (key: "selectedTitleIndices" | "selectedThumbnailTextIndices" | "selectedThumbnailIndices", i: number) =>
    update((s) => ({ ...s, [key]: s[key].includes(i) ? s[key].filter((x) => x !== i) : [...s[key], i].sort((a, b) => a - b) }));
  const shift = (list: number[], removed: number) => list.filter((x) => x !== removed).map((x) => (x > removed ? x - 1 : x));
  const removeTitle = (i: number) =>
    update((s) => ({ ...s, titles: s.titles.filter((_, j) => j !== i), selectedTitleIndices: shift(s.selectedTitleIndices, i) }));
  const removeText = (i: number) =>
    update((s) => ({
      ...s,
      thumbnailTexts: s.thumbnailTexts.filter((_, j) => j !== i),
      selectedThumbnailTextIndices: shift(s.selectedThumbnailTextIndices, i),
    }));
  const removeThumbnail = (i: number) =>
    update((s) => {
      const url = s.thumbnails[i];
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
      return { ...s, thumbnails: s.thumbnails.filter((_, j) => j !== i), selectedThumbnailIndices: shift(s.selectedThumbnailIndices, i) };
    });

  /** Show local previews right away, then swap in the uploaded URLs. */
  const addFiles = (files: File[]) => {
    const locals = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    update((s) => ({
      ...s,
      thumbnails: [...s.thumbnails, ...locals.map((l) => l.url)],
      selectedThumbnailIndices: [...s.selectedThumbnailIndices, ...locals.map((_, k) => s.thumbnails.length + k)],
    }));
    for (const local of locals) {
      uploadThumbnail(local.file)
        .then(({ publicUrl }) => update((s) => ({ ...s, thumbnails: s.thumbnails.map((t) => (t === local.url ? publicUrl : t)) })))
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : "Couldn't upload the Studio thumbnail");
          update((s) => {
            const i = s.thumbnails.indexOf(local.url);
            if (i < 0) return s;
            return { ...s, thumbnails: s.thumbnails.filter((_, j) => j !== i), selectedThumbnailIndices: shift(s.selectedThumbnailIndices, i) };
          });
        })
        .finally(() => setTimeout(() => URL.revokeObjectURL(local.url), 5_000));
    }
  };

  const combos = useMemo(() => buildCombos(state), [state]);
  const styled = useMemo(() => realCombos(state).map((c) => ({ ...c, style: { ...styleSettings } })), [state, styleSettings]);
  const setStyle = (s: StyleSettings) => update((st) => ({ ...st, styleSettings: s }));
  const setView = (v: View) => update((s) => ({ ...s, activeView: v }));
  const content = hasContent(state);
  const blank = isBlank(state);

  // ---- workspace actions ----
  const ensureSaved = async (): Promise<string | null> => {
    if (ws.id) return ws.id;
    if (uploading) {
      toast.info("Wait for your thumbnails to finish uploading");
      return null;
    }
    const name = defaultWorkspaceName(state);
    const res = await sendJson<{ data: { workspace: StudioWorkspaceRecord } }>("/api/studio/workspaces", "POST", {
      name,
      state: JSON.parse(key),
    });
    const record = res.data.workspace;
    lastSaved.current = key;
    setWs(fromRecord(record));
    setUrl({ workspaceId: record.id });
    return record.id;
  };

  const openProjects = async () => {
    setSaving(true);
    try {
      if (await ensureSaved()) setProjectOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save workspace");
    } finally {
      setSaving(false);
    }
  };

  const startNew = () => {
    thumbnails.filter((t) => t.startsWith("blob:")).forEach((t) => URL.revokeObjectURL(t));
    setState(DEFAULT_STATE);
    setWs(NO_WORKSPACE);
    lastSaved.current = null;
    setConfirmNew(false);
    setReplaceWith(null);
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
    setUrl({ workspaceId: null, projectId: null, projectName: null });
  };

  const commitRename = async () => {
    const name = nameDraft.trim();
    setRenaming(false);
    if (!ws.id || !name || name === ws.name) return;
    try {
      await sendJson(`/api/studio/workspaces/${ws.id}`, "PATCH", { name });
      setWs((w) => ({ ...w, name }));
      toast.success("Workspace renamed");
    } catch {
      toast.error("Couldn't rename workspace");
    }
  };

  useEffect(() => {
    if (renaming) {
      nameInput.current?.focus();
      nameInput.current?.select();
    }
  }, [renaming]);

  const projectLabel = ws.projectName ?? props.projectName ?? null;
  const assigned = !!ws.projectId || !!props.projectName;
  const goWorkspace = () => setView("workspace");

  return (
    <div className="relative mx-auto w-full max-w-[1880px]">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-stroke pb-3 dark:border-white/10">
        <div className="group/workspace flex min-w-0 flex-1 items-center gap-2">
          <h1 className="shrink-0 text-lg font-semibold text-dark dark:text-white">Studio</h1>
          {ws.id && ws.name && (
            <>
              <span className="shrink-0 text-dark-5">/</span>
              {renaming ? (
                <input
                  ref={nameInput}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitRename();
                    }
                    if (e.key === "Escape") setRenaming(false);
                  }}
                  aria-label="Edit workspace name"
                  className="w-full max-w-[280px] truncate rounded bg-transparent px-1 py-0.5 text-sm font-medium text-dark-5 outline-none ring-1 ring-primary dark:text-gray-300"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNameDraft(ws.name ?? "");
                    setRenaming(true);
                  }}
                  aria-label="Edit workspace name"
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-left text-sm font-medium text-dark-5 dark:text-gray-400"
                >
                  <span className="min-w-0 truncate">{ws.name}</span>
                  <Pencil className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/workspace:opacity-70" aria-hidden />
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => (content ? setConfirmNew(true) : startNew())}
            disabled={!content}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-stroke px-3 py-1.5 text-xs font-medium text-dark-5 transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:text-gray-400 dark:hover:border-white dark:hover:text-white"
          >
            <Plus className="size-4" aria-hidden />
            <span className="sm:hidden">New</span>
            <span className="hidden sm:inline">New workspace</span>
          </button>
          <button
            type="button"
            onClick={() => void openProjects()}
            disabled={!content || saving}
            title={projectLabel ? `Saved to project: ${projectLabel}` : "Add to project"}
            aria-label={projectLabel ?? "Add to project"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-stroke px-3 py-1.5 text-xs font-medium text-dark-5 transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:text-gray-400 dark:hover:border-white dark:hover:text-white"
          >
            {assigned ? <Folder className="size-4 fill-current" aria-hidden /> : <FolderPlus className="size-4" aria-hidden />}
            <span className="hidden max-w-[180px] truncate sm:inline">{saving ? "Saving…" : (projectLabel ?? "Add to project")}</span>
          </button>
        </div>
      </div>

      {!blank && (
        <div className="mb-6 border-b border-stroke dark:border-white/10">
          <nav className="flex flex-wrap items-center gap-1" aria-label="Studio tabs">
            {STUDIO_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setView(t.id)}
                aria-current={activeView === t.id ? "page" : undefined}
                className={cn(
                  "-mb-px border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                  activeView === t.id
                    ? "border-primary text-primary dark:border-white dark:text-white"
                    : "border-transparent text-dark-5 hover:text-dark dark:text-gray-400 dark:hover:text-white",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      )}

      {activeView === "workspace" && blank ? (
        <StudioLanding
          onAddTitle={(t) =>
            update((s) => {
              const kept = s.titles.filter((x) => x.trim());
              return { ...s, titles: [...kept, t], selectedTitleIndices: [...new Set([...s.selectedTitleIndices.filter((i) => i < kept.length), kept.length])] };
            })
          }
          onAddFiles={addFiles}
        />
      ) : activeView === "workspace" ? (
        <div className="flex flex-col gap-6 lg:min-h-[calc(100vh-8rem)] lg:flex-row">
          <WorkspaceSidebar
            titles={titles}
            thumbnailTexts={thumbnailTexts}
            thumbnails={thumbnails}
            selectedTitles={state.selectedTitleIndices}
            selectedTexts={state.selectedThumbnailTextIndices}
            selectedThumbnails={state.selectedThumbnailIndices}
            onTitlesChange={setTitles}
            onTextsChange={setTexts}
            onAddFiles={addFiles}
            onToggleTitle={(i) => toggle("selectedTitleIndices", i)}
            onToggleText={(i) => toggle("selectedThumbnailTextIndices", i)}
            onToggleThumbnail={(i) => toggle("selectedThumbnailIndices", i)}
            onRemoveTitle={removeTitle}
            onRemoveText={removeText}
            onRemoveThumbnail={removeThumbnail}
          />
          <div className="min-w-0 flex-1 space-y-6">
            <div className="flex justify-center">
              <StyleToolbar settings={styleSettings} onChange={setStyle} disabled={!thumbnailTexts.some((t) => t.trim())} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,340px)] sm:justify-center">
              {combos.map((c) => (
                <ComboCard
                  key={c.id}
                  title={c.title}
                  thumbnailText={c.thumbnailText}
                  imageUrl={c.imageUrl || null}
                  channelName={props.channelName}
                  channelAvatarUrl={props.channelAvatar}
                  className="max-w-[380px]"
                  style={styleSettings}
                  onStyleChange={setStyle}
                  interactive
                />
              ))}
            </div>
          </div>
        </div>
      ) : activeView === "devices" ? (
        <DevicesView combos={styled} channelName={props.channelName} channelAvatarUrl={props.channelAvatar} onGoToWorkspace={goWorkspace} />
      ) : activeView === "preview-youtube" ? (
        <YouTubePreview combos={styled} channelName={props.channelName} channelAvatarUrl={props.channelAvatar} onGoToWorkspace={goWorkspace} />
      ) : activeView === "tiny" ? (
        <TinyTestView combos={styled} channelAvatarUrl={props.channelAvatar} onGoToWorkspace={goWorkspace} />
      ) : activeView === "share" ? (
        <ShareView combos={styled} channelName={props.channelName} channelAvatarUrl={props.channelAvatar} onGoToWorkspace={goWorkspace} />
      ) : (
        <BlurTestView combos={styled} channelName={props.channelName} channelAvatarUrl={props.channelAvatar} onGoToWorkspace={goWorkspace} />
      )}

      <Modal
        open={confirmNew}
        onClose={() => setConfirmNew(false)}
        title="Start a new workspace?"
        size="sm"
        footer={
          <>
            <Button variant="soft" size="sm" onClick={() => setConfirmNew(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={startNew}>
              New workspace
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-muted)]">
          {ws.id
            ? "Your current workspace is already saved. Starting a new one opens a blank Studio workspace."
            : "Starting a new workspace will replace your current draft. Save to a project first if you want to keep it."}
        </p>
      </Modal>

      <Modal
        open={!!replaceWith}
        onClose={() => {
          setReplaceWith(null);
          setUrl({ workspaceId: null });
        }}
        title="Replace current workspace?"
        size="sm"
        footer={
          <>
            <Button
              variant="soft"
              size="sm"
              onClick={() => {
                setReplaceWith(null);
                setUrl({ workspaceId: null });
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!replaceWith) return;
                const next = normalizeState(replaceWith.state);
                lastSaved.current = snapshotKey(next);
                setState(next);
                setWs(fromRecord(replaceWith));
                setReplaceWith(null);
                toast.success("Workspace loaded");
              }}
            >
              Replace current workspace
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-muted)]">Opening this saved workspace will replace the current Studio draft.</p>
      </Modal>

      {ws.id && (
        <AddToProjectModal
          open={projectOpen}
          onClose={() => setProjectOpen(false)}
          item={{
            kind: "studio",
            refId: ws.id,
            label: ws.name ?? "Studio workspace",
            payload: {
              workspaceId: ws.id,
              name: ws.name,
              href: `/studio?workspaceId=${ws.id}`,
              thumbnail: thumbnails.find((t) => !t.startsWith("blob:")) ?? null,
              titles: titles.filter((t) => t.trim()).slice(0, 5),
            },
          }}
          onAdded={async (projectId) => {
            try {
              const res = await sendJson<{ data: { workspace: StudioWorkspaceRecord } }>(`/api/studio/workspaces/${ws.id}`, "PATCH", { projectId });
              setWs(fromRecord(res.data.workspace));
            } catch {
              setWs((w) => ({ ...w, projectId }));
            }
          }}
        />
      )}
    </div>
  );
}
