import type { Metadata } from "next";
import { connection } from "next/server";
import { listUserChannels } from "@/lib/db/app";
import { listProjects } from "@/lib/projects/store";
import { normalizeStatus } from "@/lib/projects/status";
import { ProjectsView } from "@/components/projects/ProjectsView";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { status, q } = await searchParams;
  return (
    <ProjectsView
      initialProjects={listProjects()}
      status={typeof status === "string" ? normalizeStatus(status) : null}
      initialQuery={typeof q === "string" ? q : ""}
      channels={listUserChannels().map((c) => ({ id: c.id, name: c.name, avatar: c.avatar }))}
    />
  );
}
