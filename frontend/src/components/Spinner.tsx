import { SpinnerLoader } from '@toddle-edu/ds-web';

export function Spinner() {
  return <SpinnerLoader size="small" variant="default" aria-label="Loading" />;
}

// Full-area centered spinner for route/query loading states.
export function PageSpinner() {
  return (
    <div className="tc-center">
      <Spinner />
    </div>
  );
}
