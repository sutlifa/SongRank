"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import AuthButton from "./AuthButton";

const LINKS = [
    { href: "/new", label: "Create New Ranking" },
    { href: "/history", label: "History" },
];

export default function SiteHeader({ authEnabled }: { authEnabled: boolean }) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);

    return (
        <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
                <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
                    <span
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm text-accent-fg"
                        aria-hidden="true"
                    >
                        ♫
                    </span>
                    SongRank
                </Link>

                <nav className="hidden items-center gap-1 sm:flex">
                    {LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                                pathname === link.href
                                    ? "bg-bg-soft-2 text-fg"
                                    : "text-fg-muted hover:bg-bg-soft-2 hover:text-fg"
                            }`}
                        >
                            {link.label}
                        </Link>
                    ))}
                    {authEnabled && <AuthButton />}
                </nav>

                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="btn-ghost !px-2 !py-2 sm:hidden"
                    aria-label={open ? "Close menu" : "Open menu"}
                    aria-expanded={open}
                >
                    {open ? "✕" : "☰"}
                </button>
            </div>

            {open && (
                <nav className="flex flex-col gap-1 border-t border-border px-4 py-3 sm:hidden">
                    {LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            onClick={() => setOpen(false)}
                            className={`rounded-lg px-3 py-2.5 text-sm font-medium ${
                                pathname === link.href ? "bg-bg-soft-2 text-fg" : "text-fg-muted hover:bg-bg-soft-2"
                            }`}
                        >
                            {link.label}
                        </Link>
                    ))}
                    {authEnabled && (
                        <div className="mt-1 border-t border-border pt-3">
                            <AuthButton />
                        </div>
                    )}
                </nav>
            )}
        </header>
    );
}
