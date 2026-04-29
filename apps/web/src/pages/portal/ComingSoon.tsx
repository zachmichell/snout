import PortalLayout from "@/components/portal/PortalLayout";

export default function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <header className="mb-6">
          <h1 className="font-display text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
        </header>
        <div className="rounded-lg border border-dashed border-border bg-surface p-12 text-center shadow-card">
          <div className="font-display text-lg text-foreground">Coming soon</div>
          <p className="mt-1 text-sm text-text-secondary">
            We're building this out. Check back shortly.
          </p>
        </div>
      </div>
    </PortalLayout>
  );
}
