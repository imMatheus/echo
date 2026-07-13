export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}

/** Centered spinner for a whole page / panel while it loads. */
export function PageLoading() {
  return (
    <div className="page-loading">
      <Spinner size={26} />
    </div>
  );
}
