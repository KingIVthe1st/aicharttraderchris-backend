import { BaseTransportOptions, Transport, TransportMakeRequestResponse } from '@sentry/core';
export interface CloudflareTransportOptions extends BaseTransportOptions {
    /** Custom fetch function to use. This allows usage of things like Workers VPC */
    fetch?: typeof fetch;
    /** Fetch API init parameters. */
    fetchOptions?: RequestInit;
}
/**
 * This is a modified promise buffer that collects tasks until drain is called.
 * We need this in the edge runtime because edge function invocations may not share I/O objects, like fetch requests
 * and responses, and the normal PromiseBuffer inherently buffers stuff inbetween incoming requests.
 *
 * A limitation we need to be aware of is that DEFAULT_TRANSPORT_BUFFER_SIZE is the maximum amount of payloads the
 * SDK can send for a given edge function invocation.
 */
export declare class IsolatedPromiseBuffer {
    $: Array<PromiseLike<TransportMakeRequestResponse>>;
    private _taskProducers;
    private readonly _bufferSize;
    constructor(_bufferSize?: number);
    /**
     * @inheritdoc
     */
    add(taskProducer: () => PromiseLike<TransportMakeRequestResponse>): PromiseLike<TransportMakeRequestResponse>;
    /**
     * @inheritdoc
     */
    drain(timeout?: number): PromiseLike<boolean>;
}
/**
 * Creates a Transport that uses the native fetch API to send events to Sentry.
 */
export declare function makeCloudflareTransport(options: CloudflareTransportOptions): Transport;
//# sourceMappingURL=transport.d.ts.map
