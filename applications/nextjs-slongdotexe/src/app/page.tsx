import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import { cacheLife, cacheTag, refresh, updateTag } from "next/cache";
import { connection } from "next/server";

const demoTag = "cache-component-demo";

async function invalidateSnapshot() {
  "use server";

  updateTag(demoTag);
  refresh();
}

async function CachedSnapshot() {
  "use cache";

  cacheLife({ stale: 30, revalidate: 60, expire: 300 });
  cacheTag(demoTag);

  const snapshot = {
    id: randomUUID(),
    generatedAt: new Date().toISOString(),
  };

  return (
    <section className="border-t-2 border-emerald-600 py-6">
      <h2 className="text-lg font-semibold">Cached component</h2>
      <dl className="mt-6 space-y-5">
        <div>
          <dt className="text-sm text-zinc-500 dark:text-zinc-400">Render ID</dt>
          <dd className="mt-1 break-all font-mono text-sm">{snapshot.id}</dd>
        </div>
        <div>
          <dt className="text-sm text-zinc-500 dark:text-zinc-400">Generated at</dt>
          <dd className="mt-1 break-all font-mono text-sm">
            <time dateTime={snapshot.generatedAt}>{snapshot.generatedAt}</time>
          </dd>
        </div>
        <div>
          <dt className="text-sm text-zinc-500 dark:text-zinc-400">Cache tag</dt>
          <dd className="mt-1 font-mono text-sm">{demoTag}</dd>
        </div>
      </dl>
    </section>
  );
}

async function CacheDemo() {
  await connection();

  const requestedAt = new Date().toISOString();
  const requestId = randomUUID();

  return (
    <>
      <div className="grid gap-8 md:grid-cols-2">
        <section className="border-t-2 border-zinc-400 py-6">
          <h2 className="text-lg font-semibold">Current request</h2>
          <dl className="mt-6 space-y-5">
            <div>
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">Request ID</dt>
              <dd className="mt-1 break-all font-mono text-sm">{requestId}</dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">Requested at</dt>
              <dd className="mt-1 break-all font-mono text-sm">
                <time dateTime={requestedAt}>{requestedAt}</time>
              </dd>
            </div>
          </dl>
        </section>
        <CachedSnapshot />
      </div>
      <form action={invalidateSnapshot} className="mt-6">
        <button
          type="submit"
          className="min-h-11 rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600"
        >
          Invalidate cached component
        </button>
      </form>
    </>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16 font-sans sm:px-10">
      <header className="mb-10">
        <p className="mb-3 font-mono text-sm text-emerald-700 dark:text-emerald-400">
          slongdotexe / Next.js
        </p>
        <h1 className="text-3xl font-semibold">Cache Components</h1>
      </header>
      <Suspense fallback={<p role="status">Loading cache snapshot...</p>}>
        <CacheDemo />
      </Suspense>
    </main>
  );
}
