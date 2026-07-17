import { redirect } from "next/navigation";
import { getSetupStatus } from "@/lib/env";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function HomePage({ searchParams }: Props) {
  const setup = getSetupStatus();
  const { error } = await searchParams;

  let connected = false;
  if (setup.ready) {
    try {
      const session = await getSession();
      if (session.accessToken) {
        redirect("/dashboard");
      }
      connected = Boolean(session.accessToken);
    } catch {
      // Session/env issues surface via setup messaging below.
    }
  }

  return (
    <div className="min-h-full bg-[#f3efe6] text-stone-900">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top_left,_#c5ddd2_0%,_transparent_55%),radial-gradient(ellipse_at_top_right,_#e8d9b8_0%,_transparent_45%)]"
      />
      <main className="relative mx-auto flex min-h-full max-w-3xl flex-col justify-center px-6 py-20">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-teal-900">
          Square BI Light
        </p>
        <h1 className="mt-4 max-w-xl font-serif text-5xl leading-[1.05] tracking-tight text-stone-900 sm:text-6xl">
          Sales clarity for Square sellers
        </h1>
        <p className="mt-5 max-w-lg text-lg leading-relaxed text-stone-600">
          Connect a Square Sandbox account to pull the last 30 days of net sales
          from the Reporting API — the foundation for inventory and labor insights
          next.
        </p>

        {!setup.ready ? (
          <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Finish setup in{" "}
            <code className="rounded bg-amber-100 px-1">.env.local</code> before
            connecting. Still needed: {setup.missing.join(", ")}.
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
            Connection failed: {error}
          </div>
        ) : null}

        <div className="mt-10 flex flex-wrap items-center gap-4">
          {setup.ready && !connected ? (
            // Plain <a> — not next/link. OAuth must be a full browser navigation
            // so the API route can 307 to Square; Link's RSC fetch fails on that.
            <a
              href="/api/auth/login"
              className="inline-flex items-center rounded-md bg-teal-900 px-5 py-3 text-sm font-semibold text-[#f3efe6] transition hover:bg-teal-800"
            >
              Connect Square Sandbox
            </a>
          ) : (
            <span className="inline-flex cursor-not-allowed items-center rounded-md bg-stone-400 px-5 py-3 text-sm font-semibold text-white">
              Connect Square Sandbox
            </span>
          )}
          <a
            href="https://developer.squareup.com/docs/devtools/sandbox/overview"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-stone-600 underline-offset-4 hover:underline"
          >
            Square Sandbox docs
          </a>
        </div>

        <ol className="mt-14 space-y-3 text-sm text-stone-600">
          <li>
            1. In Developer Console → your app →{" "}
            <strong className="font-medium text-stone-800">Sandbox</strong> →
            OAuth, register redirect URL{" "}
            <code className="rounded bg-stone-900/5 px-1.5 py-0.5 text-stone-800">
              http://localhost:3000/api/auth/callback
            </code>{" "}
            (exact match, no trailing slash).
          </li>
          <li>
            2. Open{" "}
            <strong className="font-medium text-stone-800">
              Sandbox test account → Open
            </strong>{" "}
            so the Sandbox Seller Dashboard is logged in in another tab. Sandbox
            OAuth will not work without that session.
          </li>
          <li>
            3. Click Connect here. The authorize URL host must be{" "}
            <code className="rounded bg-stone-900/5 px-1.5 py-0.5 text-stone-800">
              connect.squareupsandbox.com
            </code>
            , not squareup.com. Reconnect after scope changes so Inventory and
            Catalog permissions are granted.
          </li>
        </ol>
      </main>
    </div>
  );
}
