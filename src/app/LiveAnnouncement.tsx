interface LiveAnnouncementProps {
  message: string;
  testId?: string;
  className?: string;
}

export function LiveAnnouncement({ message, testId, className = 'sr-only' }: LiveAnnouncementProps) {
  return (
    <p
      className={className}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid={testId}
    >
      {message}
    </p>
  );
}
