export {};

declare global {
  interface Window {
    paypal?: {
      FUNDING: { VENMO: string };
      Buttons: (config: {
        fundingSource?: string;
        style?: Record<string, unknown>;
        createOrder: () => Promise<string>;
        onApprove: (data: { orderID: string }) => void | Promise<void>;
        onError?: (err: unknown) => void;
      }) => {
        render: (container: HTMLElement) => void;
        isEligible: () => boolean;
      };
    };
  }
}
