import Link from "next/link";
import { auth } from "@/auth";
import { hasDatabase } from "@/lib/db";
import { isAuthConfigured } from "@/lib/authConfig";
import NotificationList from "@/components/NotificationList";
import SharingUnavailable from "@/components/SharingUnavailable";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
    if (!hasDatabase || !isAuthConfigured()) return <SharingUnavailable what="Notifications" />;

    const session = await auth();
    if (!session?.user) {
        return (
            <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
                <h1 className="mb-2 text-xl font-bold">Sign in to see your notifications</h1>
                <p className="mb-6 text-sm text-fg-muted">
                    We&apos;ll tell you when someone follows you or uses one of your public lists.
                </p>
                <Link href="/signin?callbackUrl=/notifications" className="btn-primary">
                    Sign in
                </Link>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
            <h1 className="mb-2 text-2xl font-bold sm:text-3xl">Notifications</h1>
            <p className="mb-8 text-sm leading-relaxed text-fg-muted">
                Follows and list copies. Both are things anyone could already see on your profile —
                this just saves you looking. We never email you.
            </p>
            <NotificationList />
        </div>
    );
}
