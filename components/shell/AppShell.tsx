"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SignOutButton } from "@/components/SignOutButton";
import type { DashboardRailData } from "@/lib/dashboard";
import {
  CloseIcon,
  FlameIcon,
  HelpIcon,
  HomeIcon,
  MenuIcon,
  PathIcon,
  PlusIcon,
  SettingsIcon,
  ShieldIcon,
  TrophyIcon,
} from "./icons";
import { ColdStartGate } from "./ColdStartGate";

interface ShellUser {
  email: string;
  name: string | null;
  role: "learner" | "developer";
}

interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  icon: (props: { className?: string }) => React.JSX.Element;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Rail({
  rail,
  user,
}: {
  rail: DashboardRailData | null;
  user: ShellUser | null;
}) {
  if (!user) {
    return (
      <section className="rail-card">
        <p className="eyebrow">Your progress</p>
        <h2 className="rail-title">Sign in to start a quest</h2>
        <p className="small muted">
          Streaks, daily quests, and the leaderboard appear here once you have a
          profile.
        </p>
        <Link className="btn btn-primary btn-sm" href="/login">
          Sign in
        </Link>
      </section>
    );
  }

  return (
    <>
      <section className="rail-card rail-streak">
        <div className="rail-card-head">
          <span className="rail-icon">
            <FlameIcon />
          </span>
          <span className="small muted">Current streak</span>
        </div>
        <div className="rail-big">
          {rail?.streak.current ?? 0}
          <span>days</span>
        </div>
        <p className="small muted">
          Longest {rail?.streak.longest ?? 0} ·{" "}
          {rail?.streak.activeToday ? "active today" : "not active yet"}
        </p>
      </section>

      <section className="rail-card">
        <div className="rail-card-head">
          <span className="rail-icon rail-icon-blue">
            <PathIcon />
          </span>
          <span className="small muted">Daily quest</span>
        </div>
        <h2 className="rail-title">{rail?.dailyQuest.title}</h2>
        <p className="small muted">{rail?.dailyQuest.detail}</p>
        <div className="rail-progress" aria-hidden="true">
          <span style={{ width: `${(rail?.dailyQuest.progress ?? 0) * 100}%` }} />
        </div>
        <p className="small muted">
          {rail?.dailyQuest.done ? "Complete" : "0 of 1"} · resets at midnight
          UTC
        </p>
      </section>

      <section className="rail-card">
        <div className="rail-card-head">
          <span className="rail-icon rail-icon-gold">
            <TrophyIcon />
          </span>
          <span className="small muted">Streak leaderboard</span>
        </div>
        <ol className="leaderboard">
          {(rail?.leaderboard ?? []).map((entry, index) => (
            <li
              key={entry.id}
              className={entry.isCurrentUser ? "leaderboard-you" : undefined}
            >
              <span className="leaderboard-rank">{index + 1}</span>
              <span className="leaderboard-name">
                {entry.name}
                {entry.isCurrentUser ? (
                  <span className="leaderboard-tag">you</span>
                ) : null}
              </span>
              <span className="leaderboard-streak">{entry.streak}d</span>
            </li>
          ))}
        </ol>
        {(rail?.leaderboard.length ?? 0) === 0 ? (
          <p className="small muted">
            The board is empty. Run a test to put the first point on it.
          </p>
        ) : null}
      </section>
    </>
  );
}

export function AppShell({
  user,
  brandName,
  logoMark,
  rail,
  footer,
  children,
}: {
  user: ShellUser | null;
  brandName: string;
  logoMark: string;
  rail: DashboardRailData | null;
  footer: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [railOpen, setRailOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const navItems: NavItem[] = [
    { href: "/", label: "Dashboard", shortLabel: "Home", icon: HomeIcon },
    { href: "/new", label: "Build a lesson", shortLabel: "Build", icon: PlusIcon },
  ];
  if (user) {
    navItems.push({
      href: "/settings",
      label: "Settings",
      shortLabel: "Settings",
      icon: SettingsIcon,
    });
  }
  if (user?.role === "developer") {
    navItems.push({
      href: "/admin",
      label: "Admin console",
      shortLabel: "Admin",
      icon: ShieldIcon,
    });
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(
        target?.closest(
          "input, textarea, select, [contenteditable='true'], .cm-editor",
        ),
      );
      if (event.key === "?" && !typing) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
      if (event.key === "Escape") {
        setShortcutsOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className={railOpen ? "app-frame rail-open" : "app-frame"}>
        <aside className="app-sidebar">
          <div className="sidebar-head">
            <Link
              href="/"
              className="brand"
              aria-label={`${brandName} home`}
              onClick={() => setRailOpen(false)}
            >
              <span className="brand-mark" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoMark} alt="" />
              </span>
              <span className="brand-text">{brandName}</span>
            </Link>
            <button
              type="button"
              className="rail-toggle"
              onClick={() => setRailOpen((value) => !value)}
              aria-expanded={railOpen}
              aria-label={railOpen ? "Collapse navigation" : "Expand navigation"}
            >
              {railOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>

          <nav className="side-nav" aria-label="Primary">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? "side-link active" : "side-link"}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setRailOpen(false)}
                  title={item.label}
                >
                  <Icon />
                  <span className="side-label">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="sidebar-foot">
            {user ? (
              <>
                <span className="account-email" title={user.email}>
                  {user.email}
                </span>
                <SignOutButton />
              </>
            ) : (
              <Link className="btn btn-primary btn-sm" href="/login">
                Sign in
              </Link>
            )}
          </div>
        </aside>

        <div className="app-body">
          <header className="app-topbar">
            <Link href="/" className="topbar-brand">
              <span className="brand-mark" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoMark} alt="" />
              </span>
              <span>{brandName}</span>
            </Link>
            <div className="topbar-actions">
              <button
                type="button"
                className="icon-btn help-btn"
                onClick={() => setShortcutsOpen(true)}
                aria-label="Keyboard shortcuts"
                title="Keyboard shortcuts (?)"
              >
                <HelpIcon />
              </button>
              {user ? (
                <Link className="btn btn-primary btn-sm topbar-new" href="/new">
                  <PlusIcon />
                  <span>New lesson</span>
                </Link>
              ) : (
                <Link className="nav-signin" href="/login">
                  Sign in
                </Link>
              )}
            </div>
          </header>

          <main className="page" id="main">
            {children}
          </main>
          <footer className="footer">{footer}</footer>
        </div>

        <aside className="app-rail" aria-label="Progress and leaderboard">
          <Rail rail={rail} user={user} />
        </aside>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "mobile-link active" : "mobile-link"}
              aria-current={active ? "page" : undefined}
            >
              <Icon />
              <span>{item.shortLabel}</span>
            </Link>
          );
        })}
      </nav>

      <ColdStartGate />

      {shortcutsOpen ? (
        <div
          className="shortcut-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcut-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShortcutsOpen(false);
          }}
        >
          <div className="shortcut-card">
            <div className="shortcut-head">
              <h2 id="shortcut-title">Keyboard shortcuts</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShortcutsOpen(false)}
                aria-label="Close shortcuts"
                autoFocus
              >
                <CloseIcon />
              </button>
            </div>
            <dl className="shortcut-list">
              <div>
                <dt>
                  <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd>
                </dt>
                <dd>Run the current code challenge</dd>
              </div>
              <div>
                <dt>
                  <kbd>1</kbd>–<kbd>4</kbd>
                </dt>
                <dd>Jump to a lesson step (outside the editor)</dd>
              </div>
              <div>
                <dt>
                  <kbd>Enter</kbd>
                </dt>
                <dd>Check or continue a focused form control</dd>
              </div>
              <div>
                <dt>
                  <kbd>?</kbd>
                </dt>
                <dd>Open this shortcut sheet</dd>
              </div>
              <div>
                <dt>
                  <kbd>Esc</kbd>
                </dt>
                <dd>Close dialogs</dd>
              </div>
            </dl>
            <p className="small muted">
              Shortcuts are desktop conveniences. Every action also has a
              visible button, so touch users never need a keyboard.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
