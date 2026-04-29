export default function OwnerComingSoon({ title }: { title: string }) {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold text-foreground">{title}</h1>
      <div className="mt-8 rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
        <p className="text-lg font-medium text-foreground">Coming soon</p>
        <p className="mt-2 text-sm text-muted-foreground">
          We're putting the finishing touches on this page.
        </p>
      </div>
    </div>
  );
}
