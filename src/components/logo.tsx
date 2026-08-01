import { useEffect, useRef, useState } from "react";

import logoAsset from "@/assets/q-salon-logo.png.asset.json";

type LogoProps = {
  className?: string;
  size?: number;
  alt?: string;
};

/**
 * Brand mark, with a fallback that can't break.
 *
 * The real logo lives behind Lovable's asset pipeline at a `/__l5e/assets-v1/…`
 * URL, which only resolves when the app is served by that platform — it 404s in
 * local dev and on any other host, rendering a broken-image icon on every public
 * page (the first thing a client sees). Rather than depend on that resolving, we
 * fall back to an inline monogram whenever the image fails, so the header always
 * looks intentional.
 *
 * The real asset is still preferred when it loads, so nothing regresses where
 * the pipeline is available.
 */
export function Logo({ className, size = 32, alt = "Q-Salon Suite" }: LogoProps) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // The markup is server-rendered, so the browser often finishes (and fails)
  // the image request before React hydrates and attaches onError — in which
  // case that handler never fires and the broken icon sticks. Re-check the
  // element's own state on mount to catch that case.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return <LogoFallback className={className} size={size} title={alt} />;

  return (
    <img
      ref={imgRef}
      src={logoAsset.url}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

/** Inline monogram — no network dependency, inherits the page's theme colours. */
export function LogoFallback({
  className,
  size = 32,
  title = "Q-Salon Suite",
}: {
  className?: string;
  size?: number;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={title}
      className={className}
      style={{ width: size, height: size }}
    >
      <circle cx="20" cy="20" r="20" className="fill-primary/10" />
      <circle cx="20" cy="20" r="19" fill="none" strokeWidth="1" className="stroke-primary/30" />
      <text
        x="20"
        y="21"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="19"
        fontFamily="Georgia, 'Times New Roman', serif"
        className="fill-primary"
      >
        Q
      </text>
    </svg>
  );
}
