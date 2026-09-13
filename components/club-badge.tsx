'use client';

import { useEffect, useState } from 'react';

type ClubBadgeProps = {
  code?: number;
  shortName: string;
  name?: string;
  className?: string;
};

export function ClubBadge({ code, shortName, name, className = 'size-7' }: ClubBadgeProps) {
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => setImageLoaded(false), [code]);

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-card font-mono text-[9px] font-black text-muted-foreground ${className}`}
      title={name ?? shortName}
      aria-label={`${name ?? shortName} badge`}
    >
      <span className={imageLoaded ? 'opacity-0' : undefined}>{shortName.slice(0, 2)}</span>
      {code ? <img src={`/api/club-badge?code=${code}`} alt="" className="absolute inset-0 size-full bg-card object-contain p-0.5" loading="lazy" onLoad={() => setImageLoaded(true)} onError={(event) => { setImageLoaded(false); event.currentTarget.style.display = 'none'; }} /> : null}
    </span>
  );
}
