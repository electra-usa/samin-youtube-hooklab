"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Bookmark,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Folder,
  Globe,
  ChartColumn,
  PlayCircle,
  Plus,
  Rocket,
  Settings,
  SquarePen,
  Check,
  Moon,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/format";
import { getJson, sendJson } from "@/lib/api-client";
import { CHANNEL_SWITCHED, CHANNELS_UPDATED, CHATS_UPDATED, emit } from "@/lib/client-events";
import { Logo, LogoMark } from "./Logo";
import { Popover, MenuItem } from "@/components/ui/Popover";

type Me = {
  user: { name: string | null; email: string | null; image: string | null };
  channels: { id: string; channelId: string; name: string | null; avatar: string | null; isActive: boolean; subscriberCount: number | null }[];
  activeChannelId: string | null;
  theme: "light" | "dark";
};

type RecentChat = { id: string; title: string; updatedAt: string };

const RESEARCH = [
  { href: "/outliers", label: "Outliers", icon: Rocket },
  { href: "/following", label: "Following", icon: Globe },
  { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
  { href: "/my-channel", label: "My Channel", icon: PlayCircle },
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [recent, setRecent] = useState<RecentChat[]>([]);
  const [recentOpen, setRecentOpen] = useState(true);

  const loadMe = useCallback(() => getJson<Me>("/api/me").then(setMe).catch(() => {}), []);
  const loadRecent = useCallback(
    () =>
      getJson<{ chats: RecentChat[] }>("/api/chats?limit=8")
        .then((r) => setRecent(r.chats))
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    loadMe();
    loadRecent();
    const onChats = () => loadRecent();
    const onChannels = () => loadMe();
    window.addEventListener(CHATS_UPDATED, onChats);
    window.addEventListener(CHANNEL_SWITCHED, onChannels);
    window.addEventListener(CHANNELS_UPDATED, onChannels);
    return () => {
      window.removeEventListener(CHATS_UPDATED, onChats);
      window.removeEventListener(CHANNEL_SWITCHED, onChannels);
      window.removeEventListener(CHANNELS_UPDATED, onChannels);
    };
  }, [loadMe, loadRecent]);

  useEffect(() => {
    if (me) document.documentElement.classList.toggle("dark", me.theme === "dark");
  }, [me]);

  // Settings can switch the theme directly on <html>; keep the menu label in step.
  useEffect(() => {
    const html = document.documentElement;
    const observer = new MutationObserver(() => {
      const theme = html.classList.contains("dark") ? "dark" : "light";
      setMe((m) => (m && m.theme !== theme ? { ...m, theme } : m));
    });
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const active = me?.channels.find((c) => c.id === me.activeChannelId) ?? me?.channels[0];
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const switchChannel = async (id: string) => {
    await sendJson("/api/me/channel", "POST", { userChannelId: id });
    await loadMe();
    emit(CHANNEL_SWITCHED, { userChannelId: id });
    router.refresh();
  };

  const toggleTheme = async () => {
    const theme = me?.theme === "dark" ? "light" : "dark";
    await sendJson("/api/me/theme", "POST", { theme });
    setMe((m) => (m ? { ...m, theme } : m));
  };

  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        "flex h-full flex-shrink-0 flex-col border-r border-stroke bg-sidebar transition-[width] duration-200 dark:border-white/10 dark:bg-[#161719]",
        collapsed ? "w-[72px]" : "w-[260px]",
      )}
    >
      <div className={cn("flex items-center justify-between px-4 pb-3 pt-4", collapsed && "flex-col gap-3 px-0")}>
        <Link href="/chat" aria-label="Home">
          {collapsed ? <LogoMark /> : <Logo />}
        </Link>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-md p-1.5 text-dark-5 hover:bg-sidebar-active dark:hover:bg-white/10"
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
      </div>

      <div className={cn("px-3 pb-2", collapsed && "px-2")}>
        <Popover
          className="w-full"
          panelClassName="w-[236px]"
          trigger={({ toggle }) => (
            <button
              type="button"
              onClick={toggle}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left hover:bg-sidebar-active dark:hover:bg-white/10",
                collapsed && "justify-center",
              )}
            >
              {active?.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={active.avatar} alt="" className="size-10 flex-shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex size-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-blue/20 text-sm font-bold text-primary">
                  {(active?.name ?? me?.user.name ?? "?").slice(0, 1)}
                </span>
              )}
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-dark dark:text-white">
                    {active?.name ?? me?.user.name ?? "Select your channel"}
                  </span>
                  <ChevronDown className="size-4 text-dark-5" />
                </>
              )}
            </button>
          )}
        >
          {(close) => (
            <div>
              <div className="px-2.5 pb-1 pt-1.5 text-xs font-medium uppercase tracking-wide text-dark-5">Channels</div>
              {me?.channels.map((c) => (
                <MenuItem
                  key={c.id}
                  onClick={() => {
                    close();
                    if (c.id !== me.activeChannelId) switchChannel(c.id);
                  }}
                  icon={
                    c.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.avatar} alt="" className="size-6 rounded-full" />
                    ) : undefined
                  }
                >
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.id === me.activeChannelId && <Check className="size-4 text-primary" />}
                </MenuItem>
              ))}
              <MenuItem
                icon={<Plus className="size-4" />}
                onClick={() => {
                  close();
                  router.push("/settings?tab=channels&add=1");
                }}
              >
                Add channel
              </MenuItem>
              <div className="my-1 border-t border-stroke dark:border-white/10" />
              <MenuItem icon={me?.theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />} onClick={toggleTheme}>
                {me?.theme === "dark" ? "Light mode" : "Dark mode"}
              </MenuItem>
              <MenuItem
                icon={<Settings className="size-4" />}
                onClick={() => {
                  close();
                  router.push("/settings");
                }}
              >
                Settings
              </MenuItem>
            </div>
          )}
        </Popover>
      </div>

      <nav aria-label="Main navigation" className={cn("flex-1 overflow-y-auto px-3 scrollbar-thin", collapsed && "px-2")}>
        <ul className="space-y-0.5">
          <li>
            <NavLink href="/chat" label="New chat" icon={SquarePen} collapsed={collapsed} active={isActive("/chat")} />
            {!collapsed && (
              <>
                <button
                  type="button"
                  onClick={() => setRecentOpen((v) => !v)}
                  aria-expanded={recentOpen}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[15px] text-dark-5 hover:bg-sidebar-active dark:hover:bg-white/10"
                >
                  Recent chats
                  <ChevronDown className={cn("size-4 transition-transform", recentOpen && "rotate-180")} />
                </button>
                {recentOpen && (
                  <div className="mb-1 space-y-0.5">
                    {recent.map((c) => (
                      <Link
                        key={c.id}
                        href={`/chat/${c.id}`}
                        title={c.title}
                        className={cn(
                          "block truncate rounded-lg px-3 py-1.5 text-sm text-dark hover:bg-sidebar-active dark:text-gray-200 dark:hover:bg-white/10",
                          pathname === `/chat/${c.id}` && "bg-sidebar-active font-medium dark:bg-white/10",
                        )}
                      >
                        {c.title}
                      </Link>
                    ))}
                    <Link href="/chats" className="block rounded-lg px-4 py-1.5 text-sm text-dark-5 hover:bg-sidebar-active dark:hover:bg-white/10">
                      View all
                    </Link>
                  </div>
                )}
              </>
            )}
          </li>
          <li>
            <NavLink href="/projects" label="Projects" icon={Folder} collapsed={collapsed} active={isActive("/projects")} />
          </li>
        </ul>

        {!collapsed && <div className="mt-6 px-3 pb-1 text-xs font-medium uppercase tracking-wide text-dark-5">Research</div>}
        {collapsed && <div className="my-3 border-t border-stroke dark:border-white/10" />}
        <ul className="space-y-0.5">
          {RESEARCH.map((item) => (
            <li key={item.href}>
              <NavLink {...item} collapsed={collapsed} active={isActive(item.href)} />
            </li>
          ))}
        </ul>

        {!collapsed && <div className="mt-6 px-3 pb-1 text-xs font-medium uppercase tracking-wide text-dark-5">Review</div>}
        {collapsed && <div className="my-3 border-t border-stroke dark:border-white/10" />}
        <ul className="space-y-0.5">
          <li>
            <NavLink href="/studio" label="Studio" icon={ChartColumn} collapsed={collapsed} active={isActive("/studio")} />
          </li>
        </ul>
      </nav>

      <div className={cn("mx-3 mb-3 border-t border-stroke pt-3 dark:border-white/10", collapsed && "mx-2")}>
        <NavLink href="/settings" label="Settings" icon={Settings} collapsed={collapsed} active={isActive("/settings")} />
      </div>
    </aside>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  collapsed,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Rocket;
  collapsed: boolean;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] text-dark transition-colors hover:bg-sidebar-active dark:text-gray-200 dark:hover:bg-white/10",
        active && "bg-sidebar-active font-medium dark:bg-white/10",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className="size-5 flex-shrink-0 stroke-[1.6]" />
      {!collapsed && label}
    </Link>
  );
}
