import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { listUserChannels } from "@/lib/db/app";
import { getProjectDetail, getProjectSummary } from "@/lib/projects/store";
import { ProjectDetailView } from "@/components/projects/ProjectDetailView";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  await connection();
  const { id } = await params;
  return { title: getProjectSummary(id)?.name ?? "Project" };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const detail = getProjectDetail(id);
  if (!detail) notFound();
  return (
    <ProjectDetailView
      key={detail.project.id}
      initial={detail}
      channels={listUserChannels().map((c) => ({ id: c.id, name: c.name, avatar: c.avatar }))}
    />
  );
}
