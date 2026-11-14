declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    XINZHONG_PUBLIC_ORIGIN?: string;
  }
}
