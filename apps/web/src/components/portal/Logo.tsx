export default function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-xl">🐾</span>
      <span className="font-display text-lg font-bold tracking-tight">Snout</span>
    </div>
  );
}
