"use client";

import { useRef, useState } from "react";
import { MAX_NAME_LENGTH, checkName } from "@/lib/name";

/**
 * Inline rename for a tournament's name, used on both /t/[id] (the matchup
 * screen) and /t/[id]/results -- the two places a name set once on /new is
 * otherwise stuck forever.
 *
 * Deliberately inline rather than a modal: renaming is a one-field, one-shot
 * edit with no other choices attached to it, so a whole dialog would be more
 * chrome than the task. Click the title (or the pencil next to it, for
 * anyone who wouldn't guess a heading is clickable) to edit; Enter or blur
 * commits, Escape restores whatever was there before the edit started.
 *
 * Validation reuses `checkName` from lib/name.ts -- the exact function the
 * PUT /api/tournaments/[id] route validates against (see lib/tournamentSave.ts)
 * -- so a name this component accepts is never rejected server-side and vice
 * versa. An empty (or otherwise invalid) commit falls back to the previous
 * name instead of saving blank; `onRename` is only ever called with a name
 * that's already known-good.
 *
 * `onRename` is fire-and-forget from this component's point of view: it's
 * `useTournamentLoader`'s `renameTournament`, which owns updating in-memory
 * state (and, for a signed-in visitor, persisting it) -- see that hook for
 * why a rename can't just ride the existing vote-driven autosave.
 */
export default function EditableTournamentName({
    name,
    onRename,
}: {
    name: string;
    onRename: (nextName: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    // Only ever read while `editing` is true -- the not-editing branch below
    // renders `name` directly, never `draft` -- so there is nothing to keep
    // in sync here: `startEditing` always seeds it fresh from the current
    // `name` prop, which is exactly what "open the editor" is supposed to
    // start from, a fresh load or a sync from another tab included.
    const [draft, setDraft] = useState(name);
    const inputRef = useRef<HTMLInputElement>(null);

    function startEditing() {
        setDraft(name);
        setEditing(true);
    }

    function commit() {
        const trimmed = draft.trim();
        const error = checkName(trimmed);
        // Invalid (empty, or -- can't actually happen past maxLength, but
        // checked anyway so this stays correct if that ever changes -- too
        // long) falls back to the previous name rather than saving blank or
        // truncated, per this component's contract.
        if (error) {
            setDraft(name);
            setEditing(false);
            return;
        }
        setEditing(false);
        if (trimmed !== name) onRename(trimmed);
    }

    function cancel() {
        setDraft(name);
        setEditing(false);
    }

    if (editing) {
        return (
            <div className="flex items-center gap-2">
                <label htmlFor="tournament-name-input" className="sr-only">
                    Ranking name
                </label>
                <input
                    ref={inputRef}
                    id="tournament-name-input"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            commit();
                        } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancel();
                        }
                    }}
                    maxLength={MAX_NAME_LENGTH}
                    className="input w-full text-xl font-bold sm:text-2xl"
                />
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={startEditing}
            aria-label={`Rename ranking, currently "${name}"`}
            className="group flex max-w-full items-center gap-2 rounded-lg text-left"
        >
            <h1 className="truncate text-xl font-bold sm:text-2xl">{name}</h1>
            <span
                aria-hidden="true"
                className="shrink-0 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            >
                ✎
            </span>
        </button>
    );
}
