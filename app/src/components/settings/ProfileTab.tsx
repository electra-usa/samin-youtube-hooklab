"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { sendJson } from "@/lib/api-client";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/format";
import type { UserChannel } from "@/lib/db/app";
import { CONTENT_LANGUAGES } from "./shared";
import { FieldLabel, MultiSelectDropdown, SettingsCard, inputClass } from "./ui";

const LABEL_BY_CODE = new Map(CONTENT_LANGUAGES.map((l) => [l.code, l.label]));
const CODE_BY_LABEL = new Map(CONTENT_LANGUAGES.map((l) => [l.label, l.code]));
const MAX_FEATURED = 4;

// Theme comes from the `dark` class on <html> (the sidebar toggles it too), so read it live.
const subscribeTheme = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
};
const readTheme = () => (document.documentElement.classList.contains("dark") ? "dark" : "light");

export function ProfileTab({
  user,
  contentLanguages,
  emailPreferences,
  channels,
}: {
  user: { name: string; email: string };
  contentLanguages: string[];
  emailPreferences: { weeklyIdeasEmailOptIn: boolean; featuredChannelIds: string[] };
  channels: UserChannel[];
}) {
  return (
    <div className="space-y-6">
      <ProfileInformation user={user} />
      <ContentLanguages initial={contentLanguages} />
      <EmailPreferences initial={emailPreferences} channels={channels} />
      <Appearance />
      <SettingsCard title="Password" description={`${APP_NAME} runs only on this Mac and has no sign-in, so there's no password to set.`} />
      <SettingsCard title="Log Out" description="There's no account session to end here: closing the app is all it takes." />
      <DangerZone />
    </div>
  );
}

function ProfileInformation({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const [saved, setSaved] = useState(user);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [busy, setBusy] = useState(false);
  const dirty = name !== saved.name || email !== saved.email;

  const save = async () => {
    if (!name.trim()) return toast.error("Name is required");
    if (!email.trim()) return toast.error("Email is required");
    setBusy(true);
    try {
      const res = await sendJson<{ user: { name: string; email: string } }>("/api/user/update", "POST", { name, email });
      setSaved(res.user);
      setName(res.user.name);
      setEmail(res.user.email);
      toast.success("Profile updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update profile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard title="Profile Information">
      <div className="space-y-4">
        <div>
          <FieldLabel htmlFor="profile-name">Name</FieldLabel>
          <input id="profile-name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor="profile-email">Email</FieldLabel>
          <input
            id="profile-email"
            type="email"
            value={email}
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <Button size="lg" className="px-6" onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </SettingsCard>
  );
}

function ContentLanguages({ initial }: { initial: string[] }) {
  const [saved, setSaved] = useState(initial);
  const [selected, setSelected] = useState(() => initial.map((c) => LABEL_BY_CODE.get(c)).filter((l): l is string => !!l));
  const [busy, setBusy] = useState(false);
  const codes = selected.map((l) => CODE_BY_LABEL.get(l)!).filter(Boolean);
  const dirty = codes.length !== saved.length || codes.some((c) => !saved.includes(c));

  const save = async () => {
    setBusy(true);
    try {
      const res = await sendJson<{ selectedContentLanguages: string[] }>("/api/user/content-languages", "PATCH", {
        selectedContentLanguages: codes,
      });
      setSaved(res.selectedContentLanguages);
      toast.success("Content languages updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update content languages");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      title="Content Languages"
      description="Use this to strictly filter AI recommendations and Outliers to the languages you want to see. Leave it empty to allow all languages."
    >
      <div className="max-w-[440px] space-y-4">
        <MultiSelectDropdown
          label="Allowed content languages"
          placeholder="Select one or more languages"
          options={CONTENT_LANGUAGES.map((l) => l.label)}
          selected={selected}
          onChange={setSelected}
          disabled={busy}
        />
        <Button size="lg" className="px-6" onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving..." : "Save Content Languages"}
        </Button>
      </div>
    </SettingsCard>
  );
}

function EmailPreferences({
  initial,
  channels,
}: {
  initial: { weeklyIdeasEmailOptIn: boolean; featuredChannelIds: string[] };
  channels: UserChannel[];
}) {
  const [optIn, setOptIn] = useState(initial.weeklyIdeasEmailOptIn);
  const [featured, setFeatured] = useState(initial.featuredChannelIds);
  const [busy, setBusy] = useState(false);

  // With nothing picked, the email features the active channel plus the biggest other one.
  const defaultFeatured = useMemo(
    () =>
      [...channels.filter((c) => c.isActive), ...channels.filter((c) => !c.isActive).sort((a, b) => (b.subscriberCount ?? 0) - (a.subscriberCount ?? 0))]
        .slice(0, 2)
        .map((c) => c.channelId),
    [channels],
  );
  const shown = featured.length ? featured : defaultFeatured;

  const toggleOptIn = async () => {
    const next = !optIn;
    setOptIn(next);
    setBusy(true);
    try {
      await sendJson("/api/user/email-preferences", "PATCH", { weeklyIdeasEmailOptIn: next });
      toast.success(next ? "Weekly ideas email turned on" : "Weekly ideas email turned off");
    } catch (err) {
      setOptIn(!next);
      toast.error(err instanceof Error ? err.message : "Couldn't update email preference");
    } finally {
      setBusy(false);
    }
  };

  const toggleChannel = async (channelId: string) => {
    const on = shown.includes(channelId);
    if (!on && shown.length >= MAX_FEATURED) return toast.error(`You can select up to ${MAX_FEATURED} channels`);
    const previous = featured;
    const next = on ? shown.filter((id) => id !== channelId) : [...shown, channelId];
    setFeatured(next);
    try {
      await sendJson("/api/user/email-preferences", "PATCH", { featuredChannelIds: next });
      toast.success("Selected channels updated");
    } catch (err) {
      setFeatured(previous);
      toast.error(err instanceof Error ? err.message : "Couldn't update selected channels");
    }
  };

  return (
    <SettingsCard
      id="email-preferences"
      title="Email Preferences"
      description="A personalized weekly email with video ideas and performance highlights for your channel."
    >
      <label className="flex cursor-pointer select-none items-center">
        <input type="checkbox" checked={optIn} disabled={busy} onChange={toggleOptIn} className="size-4 rounded accent-primary" />
        <span className="ml-2.5 text-sm font-medium text-dark dark:text-white">Send me the weekly video ideas email</span>
      </label>
      <p className="mt-2 text-xs text-dark-5">Saved on this Mac only. {APP_NAME} doesn&apos;t send email.</p>
      {channels.length > 1 && (
        <div className="mt-5 border-t border-stroke pt-4 dark:border-white/10">
          <p className="mb-1 text-sm font-medium text-dark dark:text-white">Selected channels</p>
          <p className="mb-3 text-sm text-dark-5">Choose up to {MAX_FEATURED} channels to feature in your weekly email.</p>
          <div className="space-y-2.5">
            {channels.map((c) => (
              <label key={c.id} className="flex cursor-pointer select-none items-center">
                <input
                  type="checkbox"
                  checked={shown.includes(c.channelId)}
                  onChange={() => toggleChannel(c.channelId)}
                  className="size-4 rounded accent-primary"
                />
                <span className="ml-2.5 text-sm text-dark dark:text-white">{c.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </SettingsCard>
  );
}

function Appearance() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => null);
  const [busy, setBusy] = useState(false);

  const choose = async (next: "light" | "dark") => {
    if (next === theme) return;
    document.documentElement.classList.toggle("dark", next === "dark");
    setBusy(true);
    try {
      await sendJson("/api/me/theme", "POST", { theme: next });
    } catch (err) {
      document.documentElement.classList.toggle("dark", next !== "dark");
      toast.error(err instanceof Error ? err.message : "Couldn't save theme");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard title="Appearance" description={`Customize how ${APP_NAME} looks on your device.`}>
      <p className="mb-2 text-sm font-medium text-dark dark:text-white">Theme</p>
      <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-lg border border-stroke p-1 dark:border-white/15">
        {(["light", "dark"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={theme === t}
            disabled={theme === null || busy}
            onClick={() => choose(t)}
            className={cn(
              "rounded-md px-4 py-2 text-sm font-medium capitalize transition-colors",
              theme === t
                ? "bg-white text-dark shadow-sm ring-1 ring-black/5 dark:bg-white/15 dark:text-white dark:ring-0"
                : "text-dark-5 hover:text-dark dark:hover:text-white",
            )}
          >
            {t}
          </button>
        ))}
      </div>
    </SettingsCard>
  );
}

function DangerZone() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setConfirm("");
  };

  const reset = async () => {
    setBusy(true);
    try {
      await sendJson("/api/user/reset", "POST", { confirm: "RESET" });
      toast.success("Local data reset");
      // Full reload so every client component (sidebar included) starts from the fresh data.
      window.location.replace(new URL("/chat", window.location.href).toString());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reset local data");
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-dark p-6 dark:border-red-400/40">
      <h2 className="mb-2 text-lg font-semibold text-red-600 dark:text-red-400">Danger Zone</h2>
      <p className="mb-4 text-sm text-red-600/80 dark:text-red-300/80">
        Reset {APP_NAME} to a fresh start. This erases the chats, projects, bookmarks, follows, Studio work and settings stored on this
        Mac, then re-imports your account export. The Outliers library stays as it is.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-red-600 px-6 py-[11px] text-sm font-medium text-white transition hover:bg-red-700"
      >
        Reset local data
      </button>

      <Modal
        open={open}
        onClose={close}
        size="sm"
        title="Reset local data"
        footer={
          <>
            <Button variant="soft" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={reset} disabled={busy || confirm !== "RESET"}>
              {busy ? "Resetting..." : "Reset local data"}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-dark-5">
          This can&apos;t be undone. Everything you created in {APP_NAME} is deleted and the app restarts from your account export.
        </p>
        <label htmlFor="confirm-reset" className="mb-2 block text-sm font-medium text-dark dark:text-white">
          Type <span className="font-bold">RESET</span> to confirm
        </label>
        <input
          id="confirm-reset"
          value={confirm}
          disabled={busy}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="RESET"
          autoComplete="off"
          className={inputClass}
        />
      </Modal>
    </section>
  );
}
