// Bindings declared in wrangler.jsonc. ALLOWED_ORIGINS is a dashboard variable
// (not in the config file), so it is typed here by hand.
declare namespace Cloudflare {
  interface Env {
    ROOM: DurableObjectNamespace<import('./Room').Room>;
    CODE_PTR: DurableObjectNamespace<import('./CodePtr').CodePtr>;
    IP_LIMITER: DurableObjectNamespace<import('./IpLimiter').IpLimiter>;
    ALLOWED_ORIGINS?: string;
  }
  interface GlobalProps {
    mainModule: typeof import('./index');
  }
}

interface Env extends Cloudflare.Env {}
