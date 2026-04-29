import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type SignaturePayload =
  | { method: "type"; value: string }
  | { method: "draw"; value: string };

interface Props {
  onChange: (payload: SignaturePayload | null) => void;
}

export default function SignaturePad({ onChange }: Props) {
  const [method, setMethod] = useState<"type" | "draw">("type");
  const [typed, setTyped] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);

  // Notify parent when value changes
  useEffect(() => {
    if (method === "type") {
      onChange(typed.trim() ? { method: "type", value: typed.trim() } : null);
    }
  }, [method, typed, onChange]);

  // Setup canvas DPI on mount + when switching to draw
  useEffect(() => {
    if (method !== "draw") return;
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#362C26";
  }, [method]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const c = canvasRef.current!;
    c.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const ctx = c.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInkRef.current) hasInkRef.current = true;
  };
  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (hasInkRef.current && canvasRef.current) {
      onChange({ method: "draw", value: canvasRef.current.toDataURL("image/png") });
    }
  };

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    hasInkRef.current = false;
    onChange(null);
  };

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-border bg-background p-1">
        <button
          type="button"
          onClick={() => {
            setMethod("type");
          }}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            method === "type"
              ? "bg-primary text-primary-foreground"
              : "text-text-secondary hover:text-foreground"
          }`}
        >
          Type
        </button>
        <button
          type="button"
          onClick={() => {
            setTyped("");
            setMethod("draw");
            onChange(null);
          }}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
            method === "draw"
              ? "bg-primary text-primary-foreground"
              : "text-text-secondary hover:text-foreground"
          }`}
        >
          Draw
        </button>
      </div>

      {method === "type" ? (
        <div className="space-y-2">
          <Label htmlFor="sig-type">Type your full legal name</Label>
          <Input
            id="sig-type"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Jane Smith"
            autoComplete="off"
          />
          {typed.trim() && (
            <div className="rounded-lg border border-border bg-card-alt px-4 py-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Preview</p>
              <p
                className="mt-1 text-3xl text-foreground"
                style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}
              >
                {typed}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Label>Draw your signature</Label>
          <div className="rounded-lg border border-border bg-card-alt p-2">
            <canvas
              ref={canvasRef}
              className="block w-full touch-none rounded bg-background"
              style={{ height: 150 }}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerLeave={end}
              onPointerCancel={end}
            />
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={clear}>
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
