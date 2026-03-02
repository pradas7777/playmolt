"use client";

import { useEffect, useRef, useCallback } from "react";

const ASCII_CHARS = " .,:;|!ilIwWMB#@";
const CELL_WIDTH = 7;
const CELL_HEIGHT = 7;
const DEFAULT_IMAGE = "/images/molt.png";

interface Cell {
  char: string;
  brightness: number;
  r: number;
  g: number;
  b: number;
}

interface WaterParams {
  waveSpeed: number;
  damping: number;
  rippleStrength: number;
  clickStrength: number;
  refraction: number;
  surfaceTension: number;
  hoverRadius: number;
  clickRadius: number;
}

const DEFAULT_PARAMS: WaterParams = {
  waveSpeed: 0.5,
  damping: 0.94,
  rippleStrength: 0.41,
  clickStrength: 42,
  refraction: 2.2,
  surfaceTension: 0.92,
  hoverRadius: 6,
  clickRadius: 15,
};

export function AsciiWaterBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<Cell[][]>([]);
  const colsRef = useRef(0);
  const rowsRef = useRef(0);

  const waveCurrentRef = useRef<Float32Array>(new Float32Array(0));
  const velocityRef = useRef<Float32Array>(new Float32Array(0));

  const mouseRef = useRef({ x: -1, y: -1, prevX: -1, prevY: -1 });
  const mouseDownRef = useRef(false);
  const animFrameRef = useRef<number>(0);
  const imageLoadedRef = useRef(false);
  const paramsRef = useRef<WaterParams>({ ...DEFAULT_PARAMS });

  const initFromImage = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const cols = Math.floor(width / CELL_WIDTH);
    const rows = Math.floor(height / CELL_HEIGHT);

    if (cols <= 0 || rows <= 0) return;

    colsRef.current = cols;
    rowsRef.current = rows;

    const totalCells = cols * rows;
    waveCurrentRef.current = new Float32Array(totalCells);
    velocityRef.current = new Float32Array(totalCells);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const offscreen = document.createElement("canvas");
      offscreen.width = cols;
      offscreen.height = rows;
      const offCtx = offscreen.getContext("2d");
      if (!offCtx) return;

      const imgAspect = img.width / img.height;
      const gridAspect = cols / rows;

      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (imgAspect > gridAspect) {
        sw = img.height * gridAspect;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / gridAspect;
        sy = (img.height - sh) / 2;
      }

      offCtx.drawImage(img, sx, sy, sw, sh, 0, 0, cols, rows);
      const imageData = offCtx.getImageData(0, 0, cols, rows);
      const pixels = imageData.data;

      const grid: Cell[][] = [];
      for (let row = 0; row < rows; row++) {
        const rowArr: Cell[] = [];
        for (let col = 0; col < cols; col++) {
          const i = (row * cols + col) * 4;
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const a = pixels[i + 3];

          const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
          const adjustedBrightness = brightness * (a / 255);
          const charIndex = Math.floor(adjustedBrightness * (ASCII_CHARS.length - 1));

          rowArr.push({
            char: ASCII_CHARS[charIndex],
            brightness: adjustedBrightness,
            r, g, b,
          });
        }
        grid.push(rowArr);
      }

      gridRef.current = grid;
      imageLoadedRef.current = true;
    };
    img.src = DEFAULT_IMAGE;
  }, []);

  const propagateWaves = useCallback(() => {
    const cols = colsRef.current;
    const rows = rowsRef.current;
    const current = waveCurrentRef.current;
    const velocity = velocityRef.current;
    const p = paramsRef.current;

    const next = new Float32Array(current.length);
    const THRESHOLD = 0.001;

    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        const idx = row * cols + col;
        const laplacian =
          current[idx - 1] + current[idx + 1] +
          current[idx - cols] + current[idx + cols] -
          4 * current[idx];

        const acceleration = laplacian * p.waveSpeed;
        let v = (velocity[idx] + acceleration) * p.damping;
        let d = current[idx] + v;

        if (Math.abs(d) > 25) {
          d *= p.surfaceTension;
          v *= p.surfaceTension * 0.9;
        }
        if (Math.abs(v) < THRESHOLD && Math.abs(d) < THRESHOLD) {
          v = 0;
          d = 0;
        }

        velocity[idx] = v;
        next[idx] = d;
      }
    }

    const EDGE_DAMP = 0.3;
    for (let col = 0; col < cols; col++) {
      next[col] *= EDGE_DAMP;
      velocity[col] *= EDGE_DAMP;
      next[(rows - 1) * cols + col] *= EDGE_DAMP;
      velocity[(rows - 1) * cols + col] *= EDGE_DAMP;
    }
    for (let row = 0; row < rows; row++) {
      next[row * cols] *= EDGE_DAMP;
      velocity[row * cols] *= EDGE_DAMP;
      next[row * cols + cols - 1] *= EDGE_DAMP;
      velocity[row * cols + cols - 1] *= EDGE_DAMP;
    }

    waveCurrentRef.current = next;
  }, []);

  const addRipple = useCallback(
    (col: number, row: number, strength: number, radius: number, ringMode: boolean = false) => {
      const cols = colsRef.current;
      const rows = rowsRef.current;
      const current = waveCurrentRef.current;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const c = col + dx;
          const r = row + dy;
          if (c >= 0 && c < cols && r >= 0 && r < rows) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= radius) {
              const idx = r * cols + c;
              if (ringMode) {
                const normalizedDist = dist / radius;
                const ring = Math.sin(normalizedDist * Math.PI) * Math.exp(-normalizedDist * 0.5);
                current[idx] += strength * ring;
              } else {
                const sigma = radius * 0.4;
                const gaussian = Math.exp(-(dist * dist) / (2 * sigma * sigma));
                current[idx] += strength * gaussian;
              }
            }
          }
        }
      }
    },
    []
  );

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageLoadedRef.current) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cols = colsRef.current;
    const rows = rowsRef.current;
    const grid = gridRef.current;
    const current = waveCurrentRef.current;
    const p = paramsRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.font = `${10 * dpr}px "Geist Mono", "SF Mono", "Fira Code", "Consolas", monospace`;
    ctx.textBaseline = "middle";

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cell = grid[row]?.[col];
        if (!cell) continue;

        const idx = row * cols + col;
        const wave = current[idx];

        if (Math.abs(wave) < 0.01 && cell.brightness < 0.02 && cell.char === " ") continue;

        let gradX = 0;
        let gradY = 0;
        if (col > 0 && col < cols - 1) gradX = current[idx + 1] - current[idx - 1];
        if (row > 0 && row < rows - 1) gradY = current[idx + cols] - current[idx - cols];

        const srcCol = Math.round(col - gradX * p.refraction);
        const srcRow = Math.round(row - gradY * p.refraction);

        let displayCell = cell;
        if (srcCol >= 0 && srcCol < cols && srcRow >= 0 && srcRow < rows && grid[srcRow]?.[srcCol]) {
          displayCell = grid[srcRow][srcCol];
        }

        let caustic = 0;
        if (col > 0 && col < cols - 1 && row > 0 && row < rows - 1) {
          const laplacian =
            current[idx - 1] + current[idx + 1] +
            current[idx - cols] + current[idx + cols] - 4 * wave;
          caustic = Math.max(0, -laplacian * 0.06);
        }

        const waveIntensity = Math.abs(wave);
        const specular =
          Math.pow(Math.max(0, 1 - Math.abs(gradY + gradX) * 0.03), 8) * waveIntensity * 0.1;
        const brightBoost = 1 + waveIntensity * 0.03 + caustic * 2.5 + specular;

        const r = Math.min(255, displayCell.r * brightBoost + caustic * 60 + specular * 180);
        const g = Math.min(255, displayCell.g * brightBoost + caustic * 120 + specular * 220);
        const b = Math.min(255, displayCell.b * brightBoost + caustic * 80 + specular * 150);

        const alpha = Math.min(
          1,
          displayCell.brightness * 1.3 + waveIntensity * 0.015 + caustic * 1.5 + specular
        );
        if (alpha < 0.02) continue;

        const combinedBrightness = Math.min(1, displayCell.brightness + waveIntensity * 0.015 + caustic * 1.2);
        const charIdx = Math.floor(combinedBrightness * (ASCII_CHARS.length - 1));
        const displayChar = ASCII_CHARS[charIdx] || displayCell.char;

        if (displayChar === " " && alpha < 0.05) continue;

        ctx.fillStyle = `rgba(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)}, ${alpha})`;

        const drawX = col * CELL_WIDTH * dpr;
        const drawY = (row * CELL_HEIGHT + CELL_HEIGHT * 0.5) * dpr;
        const displaceX = gradX * 0.5 * dpr;
        const displaceY = gradY * 0.35 * dpr;

        ctx.fillText(displayChar, drawX + displaceX, drawY + displaceY);
      }
    }
  }, []);

  const animate = useCallback(() => {
    const mouse = mouseRef.current;
    const p = paramsRef.current;
    const isDown = mouseDownRef.current;

    if (mouse.x >= 0 && mouse.y >= 0) {
      const col = Math.floor(mouse.x / CELL_WIDTH);
      const row = Math.floor(mouse.y / CELL_HEIGHT);

      if (col >= 0 && col < colsRef.current && row >= 0 && row < rowsRef.current) {
        const dx = mouse.x - mouse.prevX;
        const dy = mouse.y - mouse.prevY;
        const speed = Math.sqrt(dx * dx + dy * dy);

        if (isDown) {
          const dragStrength = Math.min(speed * p.rippleStrength * 3, 15);
          const radius = p.clickRadius;
          if (dragStrength > 0.2) {
            addRipple(col, row, dragStrength, radius);
          } else {
            addRipple(col, row, p.clickStrength * 0.08, Math.max(2, radius - 1));
          }
        } else {
          const strength = Math.min(speed * p.rippleStrength, 6);
          if (strength > 0.3) {
            addRipple(col, row, strength, p.hoverRadius);
          }
        }
      }

      mouse.prevX = mouse.x;
      mouse.prevY = mouse.y;
    }

    propagateWaves();
    render();
    animFrameRef.current = requestAnimationFrame(animate);
  }, [propagateWaves, render, addRipple]);

  useEffect(() => {
    initFromImage();

    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    };

    const handleMouseDown = (e: MouseEvent) => {
      mouseDownRef.current = true;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      mouseRef.current.x = x;
      mouseRef.current.y = y;
      mouseRef.current.prevX = x;
      mouseRef.current.prevY = y;

      const col = Math.floor(x / CELL_WIDTH);
      const row = Math.floor(y / CELL_HEIGHT);
      const p = paramsRef.current;
      addRipple(col, row, p.clickStrength, p.clickRadius, false);

      setTimeout(() => addRipple(col, row, -p.clickStrength * 0.4, p.clickRadius + 3, true), 70);
      setTimeout(() => addRipple(col, row, p.clickStrength * 0.2, p.clickRadius + 7, true), 160);
      setTimeout(() => addRipple(col, row, -p.clickStrength * 0.1, p.clickRadius + 12, true), 280);
    };

    const handleMouseUp = () => {
      mouseDownRef.current = false;
    };

    const handleMouseLeave = () => {
      mouseRef.current.x = -1;
      mouseRef.current.y = -1;
      mouseRef.current.prevX = -1;
      mouseRef.current.prevY = -1;
      mouseDownRef.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const rect = container.getBoundingClientRect();
      mouseRef.current.x = touch.clientX - rect.left;
      mouseRef.current.y = touch.clientY - rect.top;
    };

    const handleTouchStart = (e: TouchEvent) => {
      mouseDownRef.current = true;
      const touch = e.touches[0];
      const rect = container.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      mouseRef.current.x = x;
      mouseRef.current.y = y;
      mouseRef.current.prevX = x;
      mouseRef.current.prevY = y;

      const col = Math.floor(x / CELL_WIDTH);
      const row = Math.floor(y / CELL_HEIGHT);
      const p = paramsRef.current;
      addRipple(col, row, p.clickStrength, p.clickRadius, false);

      setTimeout(() => addRipple(col, row, -p.clickStrength * 0.4, p.clickRadius + 3, true), 70);
      setTimeout(() => addRipple(col, row, p.clickStrength * 0.2, p.clickRadius + 7, true), 160);
    };

    const handleTouchEnd = () => {
      mouseRef.current.x = -1;
      mouseRef.current.y = -1;
      mouseRef.current.prevX = -1;
      mouseRef.current.prevY = -1;
      mouseDownRef.current = false;
    };

    const handleResize = () => {
      initFromImage();
    };

    // Listen on window so the effect works even though canvas has pointer-events: none
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("resize", handleResize);

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [initFromImage, animate, addRipple]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-0 pointer-events-none"
      style={{ background: "transparent" }}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}
