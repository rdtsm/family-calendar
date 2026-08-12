export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center px-4 text-center">
      <div className="text-5xl" aria-hidden>
        🔍
      </div>
      <h1 className="mt-4 text-[24px] font-bold">Link not found</h1>
      <p className="mt-1 text-[17px] text-fg-2">Ask your family manager for a new link.</p>
    </main>
  );
}
