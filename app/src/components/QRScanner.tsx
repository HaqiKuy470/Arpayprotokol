"use client";

/**
 * QRScanner.tsx
 * Camera-based QRIS scanner using jsQR (pure JS, no native deps).
 * Falls back to a manual NMID entry if camera is unavailable.
 *
 * On mobile PWA this uses the rear camera by default.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import jsQR from "jsqr";
import styles from "./QRScanner.module.css";

interface QRScannerProps {
  onScan: (raw: string) => void;
  active: boolean;
}

export function QRScanner({ onScan, active }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");
  const [scanning, setScanning] = useState(false);

  // ── Camera setup ────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" }, // Rear camera on mobile
          width: { ideal: 640 },
          height: { ideal: 640 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setScanning(true);
        tick();
      }
    } catch (err) {
      setCameraError(
        "Camera unavailable. Please enter the NMID manually below."
      );
    }
  }, []);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  // ── QR decode loop ──────────────────────────────────────────────────────

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    });

    if (code?.data) {
      stopCamera();
      onScan(code.data);
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [onScan, stopCamera]);

  useEffect(() => {
    if (active) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [active, startCamera, stopCamera]);

  // ── Manual NMID entry ───────────────────────────────────────────────────

  const handleManualSubmit = () => {
    if (!manualId.trim()) return;
    // Wrap in a minimal QRIS-like payload for the parser
    // Real implementation: look up from registry directly by NMID
    const mockQRIS =
      `000201` +
      `26${String(manualId.length + 6).padStart(2, "0")}` +
      `0002ID` +
      `01${String(manualId.length).padStart(2, "0")}${manualId}` +
      `5204000053033605802ID` +
      `59${String("Community Hub".length).padStart(2, "0")}Community Hub` +
      `6013Malang6304ABCD`;
    onScan(mockQRIS);
  };

  // ── Demo QR codes ───────────────────────────────────────────────────────

  const DEMO_HUBS = [
    { name: "Malang Recycling Cooperative", nmid: "NMID202400001234" },
    { name: "Surabaya Composting Hub",      nmid: "NMID202400002891" },
    { name: "DePIN AQI Node Bandung",       nmid: "NMID202400003774" },
  ];

  return (
    <div className={styles.wrapper}>
      {/* Camera viewfinder */}
      <div className={styles.viewfinder}>
        <video ref={videoRef} className={styles.video} muted playsInline />
        <canvas ref={canvasRef} className={styles.canvas} />
        {scanning && (
          <div className={styles.scanLine} />
        )}
        {!scanning && !cameraError && (
          <div className={styles.placeholder}>
            <span className={styles.qrIcon}>⬚</span>
            <span>Loading camera...</span>
          </div>
        )}
        {cameraError && (
          <div className={styles.placeholder}>
            <span className={styles.qrIcon}>📷</span>
            <span className={styles.errorMsg}>{cameraError}</span>
          </div>
        )}
        <div className={styles.corner} data-pos="tl" />
        <div className={styles.corner} data-pos="tr" />
        <div className={styles.corner} data-pos="bl" />
        <div className={styles.corner} data-pos="br" />
      </div>

      {/* Demo hub shortcuts */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Community hub demo</p>
        <div className={styles.hubList}>
          {DEMO_HUBS.map((hub) => (
            <button
              key={hub.nmid}
              className={styles.hubBtn}
              onClick={() => {
                const mockQRIS = `000201260006${hub.nmid}5204000053033605802ID59${String(hub.name.length).padStart(2,"0")}${hub.name}6013Malang6304ABCD`;
                onScan(mockQRIS);
              }}
            >
              <span className={styles.hubName}>{hub.name}</span>
              <span className={styles.hubNmid}>{hub.nmid}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Manual NMID entry */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Or enter NMID manually</p>
        <div className={styles.manualRow}>
          <input
            className={styles.manualInput}
            type="text"
            placeholder="NMID202400001234"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
          />
          <button className={styles.manualBtn} onClick={handleManualSubmit}>
            Search
          </button>
        </div>
      </div>
    </div>
  );
}
