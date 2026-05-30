// A teardown function returned by subscriptions, background loops, and scoped
// resources. Calling it releases whatever the producer set up.
export type Disposer = () => void;
