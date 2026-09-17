import { redirect } from "next/navigation";

/**
 * /history is where saved rankings lived before the page became "My
 * Rankings", so it stays as a redirect rather than a 404.
 *
 * Kept for the sake of links that already exist and this app cannot edit: a
 * bookmark, a tab somebody left open, the address bar's autocomplete. The
 * cost is one file; the cost of dropping it is a dead link for exactly the
 * people who used the page most.
 */
export default function HistoryRedirect() {
    redirect("/my-rankings");
}
