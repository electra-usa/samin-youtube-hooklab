"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { PageFrame } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import type { ChannelOption } from "@/components/settings/ChannelSelect";
import { getJson, sendJson } from "@/lib/api-client";
import { PROJECTS_UPDATED, emit } from "@/lib/client-events";
import { PROJECT_STATUSES, statusOption, type ProjectStatus } from "@/lib/projects/status";
import type { ProjectSummary } from "@/lib/projects/types";
import { ProjectCard } from "./ProjectCard";
import { DeleteProjectModal, ProjectFormModal } from "./ProjectModals";

export function ProjectsView({
  initialProjects,
  status,
  initialQuery,
  channels,
}: {
  initialProjects: ProjectSummary[];
  /** From ?status= (null = all statuses). */
  status: ProjectStatus | null;
  initialQuery: string;
  channels: ChannelOption[];
}) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [query, setQuery] = useState(initialQuery);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);

  // Refresh on arrival (back/forward can replay an older server render) and whenever a
  // project changes elsewhere, e.g. "Add to project" in Chat, Outliers or Studio.
  useEffect(() => {
    let alive = true;
    const reload = () =>
      getJson<{ projects: ProjectSummary[] }>("/api/projects")
        .then((r) => alive && setProjects(r.projects))
        .catch(() => {});
    void reload();
    window.addEventListener(PROJECTS_UPDATED, reload);
    return () => {
      alive = false;
      window.removeEventListener(PROJECTS_UPDATED, reload);
    };
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter(
      (p) =>
        (!status || p.status === status) &&
        (!q || [p.name, p.description ?? "", p.primaryChannelName ?? ""].join(" ").toLowerCase().includes(q)),
    );
  }, [projects, query, status]);

  const setFilter = (value: string) => {
    router.push(value === "all" ? "/projects" : `/projects?status=${value}`, { scroll: false });
  };

  const changeStatus = async (project: ProjectSummary, next: ProjectStatus) => {
    setStatusBusy(project.id);
    setProjects((list) => list.map((p) => (p.id === project.id ? { ...p, status: next } : p)));
    try {
      const res = await sendJson<{ project: ProjectSummary }>(`/api/projects/${project.id}`, "PATCH", { status: next });
      setProjects((list) => list.map((p) => (p.id === project.id ? res.project : p)));
      emit(PROJECTS_UPDATED);
    } catch {
      setProjects((list) => list.map((p) => (p.id === project.id ? project : p)));
      toast.error("Couldn't update project status");
    } finally {
      setStatusBusy(null);
    }
  };

  const emptyMessage = query.trim()
    ? "No projects match your search."
    : status
      ? `No ${statusOption(status).label.toLowerCase()} projects yet.`
      : "No projects yet. Create one to start organizing chats and saved work.";

  return (
    <div className="mx-auto w-full max-w-[1248px]">
      <PageFrame
        title="Projects"
        subtitle="Shared workspaces for chats, bookmarks, and saved ideas."
        actions={
          <Button size="lg" className="px-10" onClick={() => setCreating(true)}>
            + New project
          </Button>
        }
      >
        <div className="mb-6 flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-dark-5" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects..."
              aria-label="Search projects"
              className="w-full rounded-lg border border-stroke bg-transparent py-3 pl-10 pr-4 text-dark outline-none transition placeholder:text-dark-5 focus:border-primary dark:border-white/15 dark:text-white dark:focus:border-sky-300"
            />
          </div>
          <label htmlFor="project-status-filter" className="sr-only">
            Filter projects by status
          </label>
          <select
            id="project-status-filter"
            value={status ?? "all"}
            onChange={(e) => setFilter(e.target.value)}
            className="min-h-12 rounded-lg border border-stroke bg-white px-4 text-sm font-medium text-dark outline-none transition focus:border-primary sm:w-44 dark:border-white/15 dark:bg-[#18191c] dark:text-white"
          >
            <option value="all">All statuses</option>
            {PROJECT_STATUSES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {visible.length === 0 ? (
          <div className="rounded-xl border border-stroke bg-gray-100 py-12 text-center dark:border-white/10 dark:bg-white/5">
            <p className="text-dark-5">{emptyMessage}</p>
            {!query.trim() && !status && (
              <div className="mt-4 flex justify-center">
                <Button size="lg" className="px-10" onClick={() => setCreating(true)}>
                  Create your first project
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                statusBusy={statusBusy === p.id}
                onEdit={() => setEditing(p)}
                onDelete={() => setDeleting(p)}
                onStatusChange={(next) => changeStatus(p, next)}
              />
            ))}
          </div>
        )}
      </PageFrame>

      <ProjectFormModal
        open={creating}
        onClose={() => setCreating(false)}
        channels={channels}
        onSaved={(project) => {
          setCreating(false);
          setProjects((list) => [project, ...list]);
          router.push(`/projects/${project.id}`);
        }}
      />
      <ProjectFormModal
        open={!!editing}
        project={editing}
        onClose={() => setEditing(null)}
        channels={channels}
        onSaved={(project) => {
          setEditing(null);
          setProjects((list) => [project, ...list.filter((p) => p.id !== project.id)]);
        }}
      />
      <DeleteProjectModal
        project={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(id) => {
          setDeleting(null);
          setProjects((list) => list.filter((p) => p.id !== id));
        }}
      />
    </div>
  );
}
