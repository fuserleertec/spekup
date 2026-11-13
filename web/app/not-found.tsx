export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <h1 className="font-serif text-4xl font-semibold">Page not found</h1>
        <p className="mt-2 text-forest/70">This path is not part of Spekup.</p>
        <a href="/" className="mt-6 inline-block rounded-full bg-forest px-6 py-3 font-semibold text-ivory">Back to the feed</a>
      </div>
    </main>
  );
}
