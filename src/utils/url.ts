/**
 * Public URL and Clipboard utilities for VOXEL3D CAD Project Sharing
 */

export function isPrivateIp(hostname: string): boolean {
  if (!hostname) return true;
  const cleanHost = hostname.split(':')[0].toLowerCase();
  if (
    cleanHost === "localhost" ||
    cleanHost === "127.0.0.1" ||
    cleanHost === "::1" ||
    cleanHost.startsWith("192.168.") ||
    cleanHost.startsWith("10.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(cleanHost)
  ) {
    return true;
  }
  return false;
}

export const isPrivateHost = isPrivateIp;

export function getPublicAppOrigin(): string {
  if (typeof window === "undefined") return "";

  // 1. Check explicit public environment variables (e.g. Render, Vercel, Railway, custom domain)
  const envUrl = 
    (import.meta as any).env?.VITE_PUBLIC_APP_URL ||
    (import.meta as any).env?.VITE_APP_URL ||
    (import.meta as any).env?.APP_URL;

  if (envUrl && typeof envUrl === "string" && envUrl.trim().startsWith("http")) {
    return envUrl.trim().replace(/\/+$/, "");
  }

  // 2. Use the live browser window origin (e.g. https://voxel3d-cad.onrender.com or http://localhost:3000)
  return window.location.origin;
}

export function getPublicShareUrl(projectId: string): string {
  if (!projectId) return "";
  const origin = getPublicAppOrigin();
  return `${origin}/?project=${encodeURIComponent(projectId)}`;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Try modern Async Clipboard API
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.warn("[Clipboard] navigator.clipboard.writeText failed, falling back to execCommand:", e);
    }
  }

  // 2. Robust fallback using temporary textarea
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "-9999px";
    textArea.style.opacity = "0";
    textArea.setAttribute("readonly", "");
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    const success = document.execCommand("copy");
    document.body.removeChild(textArea);
    return success;
  } catch (err) {
    console.error("[Clipboard] Both clipboard methods failed:", err);
    return false;
  }
}
