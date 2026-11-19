import "next-auth";

declare module "next-auth" {
  interface Session {
    uid?: string;
    sv?: number;
  }
}
