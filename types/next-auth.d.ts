import type { DefaultSession } from "next-auth";

declare module "next-auth" {
    interface Session {
        user: DefaultSession["user"] & {
            id: number;
        };
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        userId?: number;
    }
}
