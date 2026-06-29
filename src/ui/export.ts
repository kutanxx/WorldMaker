import type { World } from "../types/world";

export function worldToJSON(world: World): string {
  return JSON.stringify(world);
}

export function svgToString(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function svgToPngBlob(svg: SVGSVGElement, width: number, height: number): Promise<Blob> {
  const data = svgToString(svg);
  const svgBlob = new Blob([data], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svgBlob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.scale(dpr, dpr);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    };
    img.onerror = () => reject(new Error("svg image load failed"));
    img.src = url;
  });
}
