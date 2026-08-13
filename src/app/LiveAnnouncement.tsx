interface LiveAnnouncementProps {
  message: string;
  testId?: string;
}

export function LiveAnnouncement({ message, testId }: LiveAnnouncementProps) {
  return (
    <p
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid={testId}
    >
      {message}
    </p>
  );
}
