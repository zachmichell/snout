import { useNavigate } from "react-router-dom";
import { Clock } from "lucide-react";

interface Props {
  daysRemaining: number;
}

export default function TrialBanner({ daysRemaining }: Props) {
  const navigate = useNavigate();
  const isCritical = daysRemaining <= 1;
  const bg = isCritical ? "bg-destructive/10 border-destructive/30" : "bg-[#FFF8E7] border-amber-300/50";
  const textColor = isCritical ? "text-destructive" : "text-amber-900";

  return (
    <div className={`${bg} border-b px-6 py-3 flex items-center gap-3`}>
      <Clock className={`h-5 w-5 ${textColor} flex-shrink-0`} />
      <p className={`text-sm flex-1 ${textColor}`}>
        {daysRemaining === 0
          ? "Your trial ends today."
          : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left in your trial.`}{" "}
        Add billing to continue without interruption.
      </p>
      <button
        onClick={() => navigate("/settings?tab=billing")}
        className="text-sm font-semibold text-primary hover:underline"
      >
        Add Billing
      </button>
    </div>
  );
}
