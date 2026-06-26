"use client";

// Camera QR scanner for the pickup desk. Decodes the student's pickup QR with
// @zxing/browser (works on iOS Safari — the phone-first officer desk) and emits
// the validated 8-char token to the parent, which feeds the SAME verify POST as
// manual entry. Owns the full camera lifecycle and tears the stream down on
// unmount / mode-switch (the most common scanner bug). zxing is lazy-imported
// so it stays out of the main bundle until an officer taps 扫码.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { extractPickupToken } from "@/lib/shipping/extract-pickup-token";

// Minimal shape of the zxing controls we use for teardown.
type ScannerControls = { stop: () => void };

interface PickupScannerProps {
  /** Called with a validated 8-char token when a QR decodes successfully. */
  onToken: (token: string) => void;
  /** True while a verify request is in flight (pauses the "再次扫码" button). */
  busy?: boolean;
}

export function PickupScanner({ onToken, busy }: PickupScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  // Keep the latest onToken without re-subscribing the camera effect.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  const [scanning, setScanning] = useState(false);
  const [decoded, setDecoded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teardown = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setDecoded(false);

    if (typeof window === "undefined" || !window.isSecureContext) {
      setError("需在 HTTPS 下使用相机，请改用手输。");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("此浏览器不支持相机，请改用手输。");
      return;
    }

    setScanning(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const video = videoRef.current;
      if (!video) return;

      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: "environment" } },
        video,
        (result) => {
          if (!result) return; // no QR in this frame — keep scanning
          const token = extractPickupToken(result.getText());
          if (!token) {
            // A QR decoded but it isn't a pickup token. Surface and keep scanning.
            setError("二维码无法识别，请重试或手输。");
            return;
          }
          setError(null);
          setDecoded(true);
          teardown();
          onTokenRef.current(token);
        },
      );
      controlsRef.current = controls;
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("相机权限被拒绝，请在浏览器设置中允许，或改用手输。");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError("未检测到相机，请改用手输。");
      } else {
        setError("相机启动失败，请改用手输。");
      }
      toast.error("相机不可用");
      teardown();
      setScanning(false);
    }
  }, [teardown]);

  // Auto-start on mount (parent renders this only in scan mode); stop on unmount.
  // Camera init is legitimate external-system setup, so the setState start()
  // performs inside this effect is expected (start/teardown are stable).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start();
    return () => teardown();
  }, [start, teardown]);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-md border bg-black">
        <video
          ref={videoRef}
          className="aspect-square w-full object-cover"
          autoPlay
          muted
          playsInline
          aria-label="取件二维码扫描相机预览"
        />
        {scanning && !decoded && !error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-2/3 w-2/3 rounded-lg border-2 border-white/80" />
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-rose-600" role="alert">
          {error}
        </p>
      )}

      {decoded ? (
        <Button variant="outline" onClick={() => void start()} disabled={busy}>
          再次扫码
        </Button>
      ) : (
        error && (
          <Button variant="outline" onClick={() => void start()}>
            重试相机
          </Button>
        )
      )}

      <p className="text-xs text-muted-foreground">
        对准学生出示的取件二维码即可自动核销；也可切到「手输」。
      </p>
    </div>
  );
}
