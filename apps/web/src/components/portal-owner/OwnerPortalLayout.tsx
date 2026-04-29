import OwnerTopNav from "./OwnerTopNav";

export default function OwnerPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <OwnerTopNav />
      <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {children}
      </main>
    </div>
  );
}
