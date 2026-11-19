"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeCanvasLuminanceSignature,
  signatureSimilarity,
} from "@/lib/ollama-vlm";

interface UseScreenCaptureOptions {
  intervalMinutes: number;
  skipDuplicateFrames: boolean;
  isPaused: boolean;
  onFrameCaptured: (imageDataUrl: string) => void;
  onStaticFrameSkipped?: () => void;
}

export function useScreenCapture({
  intervalMinutes,
  skipDuplicateFrames,
  isPaused,
  onFrameCaptured,
  onStaticFrameSkipped,
}: UseScreenCaptureOptions) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [secondsUntilNext, setSecondsUntilNext] = useState(
    Math.round(intervalMinutes * 60)
  );
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [skippedStaticCount, setSkippedStaticCount] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSignatureRef = useRef<number[]>([]);

  const grabFrameNow = useCallback(
    (forceEvenIfDuplicate = false) => {
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
        lastSignatureRef.current.length > 0
      ) {
        const sim = signatureSimilarity(sig, lastSignatureRef.current);
        if (sim >= 0.975) {
          setSkippedStaticCount((c) => c + 1);
          onStaticFrameSkipped?.();
          return false;
        }
      }

      lastSignatureRef.current = sig;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.78);
      onFrameCaptured(dataUrl);
      return true;
    },
    [onFrameCaptured, onStaticFrameSkipped, skipDuplicateFrames]
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
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getDisplayMedia
    ) {
      setCaptureError(
        "Live screen capture requires a desktop browser (Safari, Chrome, or Arc on macOS). You can still upload/paste screenshots or simulate captures below."
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

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.addEventListener("ended", () => {
          stopCapture();
        });
      }

      streamRef.current = stream;
      videoRef.current = video;
      lastSignatureRef.current = [];
      setIsCapturing(true);
      setSecondsUntilNext(Math.max(15, Math.round(intervalMinutes * 60)));

      // Take the initial screenshot immediately once stream stabilizes
      setTimeout(() => {
        grabFrameNow(true);
      }, 450);
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Screen sharing permission was dismissed — click Start Live Capture anytime to pick your Mac screen, Mail, or Slack window."
          : "Could not start live screen capture in this window.";
      setCaptureError(msg);
      stopCapture();
    }
  }, [grabFrameNow, intervalMinutes, stopCapture]);

  const maxCountdownSeconds = Math.max(15, Math.round(intervalMinutes * 60));

  // Countdown tick for periodic capture
  useEffect(() => {
    if (!isCapturing || isPaused) return;

    const timer = setInterval(() => {
      setSecondsUntilNext((prev) => {
        const bounded = Math.min(prev, maxCountdownSeconds);
        if (bounded <= 1) {
          grabFrameNow(false);
          return maxCountdownSeconds;
        }
        return bounded - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [grabFrameNow, isCapturing, isPaused, maxCountdownSeconds]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCapture();
    };
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
