import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * A QR code for `text`, drawn as one SVG path. Always dark on white with a quiet border,
 * because phone cameras read that most reliably whatever the app's theme is.
 */
export function QrCode({ text, className }: { text: string; className?: string }) {
  const { size, path } = useMemo(() => {
    // Type 0 picks the smallest code that fits; "M" tolerates a slightly blurry TV.
    const code = qrcode(0, 'M');
    code.addData(text);
    code.make();

    const count = code.getModuleCount();
    let squares = '';
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        if (code.isDark(row, column)) squares += `M${column} ${row}h1v1h-1z`;
      }
    }
    return { size: count, path: squares };
  }, [text]);

  const border = 3;
  return (
    <svg
      className={className}
      viewBox={`${-border} ${-border} ${size + border * 2} ${size + border * 2}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code"
    >
      <rect
        x={-border}
        y={-border}
        width={size + border * 2}
        height={size + border * 2}
        fill="#fff"
      />
      <path d={path} fill="#000" />
    </svg>
  );
}
