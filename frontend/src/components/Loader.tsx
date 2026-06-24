type LoaderProps = {
  size?: number;
  label?: string;
};

export function Loader({ size = 32, label = 'Loading' }: LoaderProps) {
  return (
    <svg
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid"
      className="lds-google"
      role="img"
      aria-label={label}
    >
      <g transform="translate(50 50)">
        <g transform="rotate(90)">
          <animateTransform
            attributeName="transform"
            type="rotate"
            calcMode="discrete"
            values="0;90;180;270;360"
            keyTimes="0;0.25;0.5;0.75;1"
            repeatCount="indefinite"
            dur="1.5s"
          ></animateTransform>
          <path fill="#189eae" d="M-48 0A48 48 0 1 0 48 0">
            <animate
              attributeName="fill"
              calcMode="discrete"
              values="#189eae;#f75961;#189eae;#f75961;#189eae"
              keyTimes="0;0.24;0.49;0.74;0.99"
              repeatCount="indefinite"
              dur="1.5s"
            ></animate>
          </path>
          <path fill="#f75961" d="M-48 0A48 48 0 0 1 48 0">
            <animate
              attributeName="fill"
              calcMode="discrete"
              values="#f75961;#189eae;#f75961;#189eae;#f75961"
              keyTimes="0;0.25;0.5;0.75;1"
              repeatCount="indefinite"
              dur="1.5s"
            ></animate>
          </path>
          <path stroke="rgb(17, 111, 122)" strokeWidth="2" d="M-47 0L47 0">
            <animate
              attributeName="stroke"
              values="#189eae;rgb(17, 111, 122);rgb(173, 62, 68);#f75961;rgb(173, 62, 68);rgb(17, 111, 122);#189eae;rgb(17, 111, 122);rgb(173, 62, 68);#f75961;rgb(173, 62, 68);rgb(17, 111, 122);#189eae"
              keyTimes="0;0.124;0.125;0.25;0.374;0.375;0.5;0.624;0.625;0.75;0.874;0.875;1"
              repeatCount="indefinite"
              dur="1.5s"
            ></animate>
          </path>
          <g transform="scale(1 -0.556669)">
            <path fill="rgb(17, 111, 122)" d="M-48 0A48 48 0 0 1 48 0Z">
              <animate
                attributeName="fill"
                values="#189eae;rgb(17, 111, 122);rgb(173, 62, 68);#f75961;rgb(173, 62, 68);rgb(17, 111, 122);#189eae;rgb(17, 111, 122);rgb(173, 62, 68);#f75961;rgb(173, 62, 68);rgb(17, 111, 122);#189eae"
                keyTimes="0;0.124;0.125;0.25;0.374;0.375;0.5;0.624;0.625;0.75;0.874;0.875;1"
                repeatCount="indefinite"
                dur="1.5s"
              ></animate>
            </path>
            <animateTransform
              attributeName="transform"
              type="scale"
              values="1 1;1 0;1 -1;1 1"
              keyTimes="0;0.5;0.999;1"
              repeatCount="indefinite"
              dur="0.375s"
            ></animateTransform>
          </g>
        </g>
      </g>
    </svg>
  );
}

// Full-area centered loading state for route guards, Suspense fallbacks and panels.
export function PageLoader({ label }: { label?: string }) {
  return (
    <div className="tc-center">
      <Loader label={label} />
    </div>
  );
}
