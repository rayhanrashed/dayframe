"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeCanvasLuminanceSignature,
  signatureSimilarity,
} from "@/lib/gemma-client";
import { captureSilentMacScreenshot } from "@/lib/calendar-connectors";
import { CaptureEngineMode } from "@/lib/types";

interface UseScreenCaptureOptions {
  mode: CaptureEngineMode;
  macPairingToken: string;
  macBridgeReady: boolean;
  intervalMinutes: number;
  skipDuplicateFrames: boolean;
  isPaused: boolean;
  onFrameCaptured: (payload: {
    imageDataUrl: string;
    appName: string;
    windowTitle: string;
  }) => void;
}

export function useScreenCapture({
  mode,
  macPairingToken,
  macBridgeReady,
  intervalMinutes,
  skipDuplicateFrames,
  isPaused,
  onFrameCaptured,
}: UseScreenCaptureOptions) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [secondsUntilNext, setSecondsUntilNext] = useState(
    Math.max(15, Math.round(intervalMinutes * 60))
  );
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [skippedStaticCount, setSkippedStaticCount] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSigRef = useRef<number[]>([]);

  const checkImageDataUrlDuplicate = useCallback(
    (dataUrl: string, force: boolean): Promise<boolean> => {
      if (force || !skipDuplicateFrames) return Promise.resolve(false);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 64;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(false);
          ctx.drawImage(img, 0, 0, 64, 64);
          const sig = computeCanvasLuminanceSignature(ctx, 64, 64);
          if (
            lastSigRef.current.length > 0 &&
            signatureSimilarity(sig, lastSigRef.current) >= 0.975
          ) {
            setSkippedStaticCount((c) => c + 1);
            resolve(true);
            return;
          }
          lastSigRef.current = sig;
          resolve(false);
        };
        img.onerror = () => resolve(false);
        img.src = dataUrl;
      });
    },
    [skipDuplicateFrames]
  );

  const grabFrameNow = useCallback(
    async (forceEvenIfDuplicate = false): Promise<boolean> => {
      if (mode === "macos-native" && macBridgeReady && macPairingToken) {
        const res = await captureSilentMacScreenshot(macPairingToken);
        if (!res.ok) {
          setCaptureError(
            res.error || "Native macOS screencapture failed — check Screen Recording permission."
          );
          return false;
        }
        if (res.skippedPrivateApp || !res.imageDataUrl) {
          return false;
        }
        const isDup = await checkImageDataUrlDuplicate(
          res.imageDataUrl,
          forceEvenIfDuplicate
        );
        if (isDup) return false;

        onFrameCaptured({
          imageDataUrl: res.imageDataUrl,
          appName: res.appName || "macOS",
          windowTitle: res.windowTitle || "Active Mac Window",
        });
        return true;
      }

      // Browser DisplayMedia fallback
      const video = videoRef.current;
      if (!video || video.readyState < 2) return false;

      const srcW = video.videoWidth || 1280;
      const srcH = video.videoHeight || 720;
      const scale = Math.min(1, 960 / srcW);
      const w = Math.max(320, Math.round(srcW * scale));
      const h = Math.max(180, Math.round(srcH * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.drawImage(video, 0, 0, w, h);

      const sig = computeCanvasLuminanceSignature(ctx, w, h);
      if (
        !forceEvenIfDuplicate &&
        skipDuplicateFrames &&
        lastSigRef.current.length > 0 &&
        signatureSimilarity(sig, lastSigRef.current) >= 0.975
      ) {
        setSkippedStaticCount((c) => c + 1);
        return false;
      }
      lastSigRef.current = sig;

      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      onFrameCaptured({
        imageDataUrl: dataUrl,
        appName: "Shared Window / Screen",
        windowTitle: "Browser Screen Capture",
      });
      return true;
    },
    [
      checkImageDataUrlDuplicate,
      macBridgeReady,
      macPairingToken,
      mode,
      onFrameCaptured,
      skipDuplicateFrames,
    ]
  );

  const stopCapture = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    setIsCapturing(false);
  }, []);

  const startCapture = useCallback(async () => {
    setCaptureError(null);

    if (mode === "macos-native") {
      if (!macBridgeReady || !macPairingToken) {
        setCaptureError(
          "Mac Bridge is not paired yet. Start `npm run mac` on your MacBook or switch capture engine to Browser Window Share."
        );
        return;
      }
      setIsCapturing(true);
      setSecondsUntilNext(Math.max(15, Math.round(intervalMinutes * 60)));
      await grabFrameNow(true);
      return;
    }

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getDisplayMedia
    ) {
      setCaptureError(
        "Screen capture is unavailable in this browser context. Run `npm run mac` on your MacBook for native background screencapture."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
      });
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();

      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        stopCapture();
      });

      streamRef.current = stream;
      videoRef.current = video;
      lastSigRef.current = [];
      setIsCapturing(true);
      setSecondsUntilNext(Math.max(15, Math.round(intervalMinutes * 60)));

      setTimeout(() => {
        void grabFrameNow(true);
      }, 450);
    } catch (err) {
      setCaptureError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Screen sharing permission was cancelled."
          : "Could not start browser screen capture."
      );
      stopCapture();
    }
  }, [
    grabFrameNow,
    intervalMinutes,
    macBridgeReady,
    macPairingToken,
    mode,
    stopCapture,
  ]);

  const maxCountdownSeconds = Math.max(15, Math.round(intervalMinutes * 60));

  useEffect(() => {
    if (!isCapturing || isPaused) return;

    const timer = setInterval(() => {
      setSecondsUntilNext((prev) => {
        const bounded = Math.min(prev, maxCountdownSeconds);
        if (bounded <= 1) {
          void grabFrameNow(false);
          return maxCountdownSeconds;
        }
        return bounded - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [grabFrameNow, isCapturing, isPaused, maxCountdownSeconds]);

  useEffect(() => {
    return () => stopCapture();
  }, [stopCapture]);

  return {
    isCapturing,
    secondsUntilNext: Math.min(secondsUntilNext, maxCountdownSeconds),
    captureError,
    skippedStaticCount,
    startCapture,
    stopCapture,
    grabFrameNow,
    clearCaptureError: () => setCaptureError(null),
  };
}
