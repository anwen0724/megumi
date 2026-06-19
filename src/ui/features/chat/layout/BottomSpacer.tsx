interface BottomSpacerProps {
  height: number;
}

export function BottomSpacer({ height }: BottomSpacerProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="message-bottom-spacer"
      style={{ height }}
    />
  );
}
