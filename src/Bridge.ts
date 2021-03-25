import has from "lodash/has";
import hasIn from "lodash/hasIn";
import isFunction from "lodash/isFunction";
import isNumber from "lodash/isNumber";
import isObjectLike from "lodash/isObjectLike";
import isPlainObject from "lodash/isPlainObject";
import { IMessage } from "./MessageApp";

export interface IBridge {
    readonly isConnected: boolean;
    readonly isConnecting: boolean;

    /*
     * initializes connection to the app container. Requires a handler to be passed in
     */
    connect(
        handler: (message: IMessage) => undefined | Promise<any>,
        awaitConnection?: boolean,
        attemptsNumber?: number,
    ): Promise<void>;

    /*
     * disconnects from the app container. Removes the handler
     */
    disconnect(): Promise<void>;

    /*
     * sends a message to the AppContainer
     */
    send<Data = any>(bridgeMessage: IBridgeMessage<Data>): void;

    /*
     * calls for a response of the AppContainer
     */
    request<Message extends IMessage = any, Result = any>(
        message: Message,
        overrideOptions?: Partial<IBridgeOptions>,
    ): Promise<Result>;
}

export interface IBridgeMessage<Data = any> {
    requestId?: number; // if null, then we don't expect a response
    referenceId?: number;
    isError?: undefined | boolean;
    data: Data;
}

export interface IBridgeOptions {
    timeout: number;
    connect: (awaitConnect?: boolean) => Promise<void>;
    disconnect: () => Promise<void>;
    send: (request: string) => void;
    encode?: (obj: IBridgeMessage) => string;
    decode?: (str: string) => IBridgeMessage;
}

export function isBridgeOptions(obj: any): obj is IBridgeOptions {
    return (
        isObjectLike(obj) &&
        // required functions
        ["connect", "disconnect", "send"].every((methodName) => isFunction(obj[methodName])) &&
        // optional functions
        ["encode", "decode"].every((methodName) => obj[methodName] === undefined || isFunction(obj[methodName])) &&
        isNumber(obj.timeout) &&
        obj.timeout > 0
    );
}

export function isBridgeMessage(obj: any): obj is IBridgeMessage {
    return (
        isPlainObject(obj) &&
        Object.keys(obj).every((key) => ["requestId", "referenceId", "data", "isError"].includes(key)) &&
        has(obj, "data") &&
        (obj.requestId === undefined || isNumber(obj.requestId)) &&
        (obj.referenceId === undefined || isNumber(obj.referenceId)) &&
        (obj.isError === undefined || obj.isError === false || obj.isError === true)
    );
}

export function isBridge(obj: any): obj is IBridge {
    if (!isObjectLike(obj)) {
        return false;
    }

    const requiredProps = ["isConnected", "isConnecting"];

    const requiredFuncs = ["connect", "disconnect", "send"];

    return (
        requiredProps.every((propName) => hasIn(obj, propName) && !isFunction(obj[propName])) &&
        requiredFuncs.every((funcName) => isFunction(obj[funcName]))
    );
}

export enum BridgeState {
    AwaitingConnect = "AWAITING_CONNECT",
    Connected = "CONNECTED",
    Connecting = "CONNECTING",
    Disconnected = "DISCONNECTED",
    Disconnecting = "DISCONNECTING",
}

export class Bridge implements IBridge {
    protected state: BridgeState = BridgeState.Disconnected;

    public get isConnected(): boolean {
        return this.state === BridgeState.Connected;
    }

    public get isConnecting(): boolean {
        return this.state === BridgeState.Connecting;
    }

    protected messageHandler: undefined | ((message: any) => undefined | Promise<any>);

    protected lastRequestId = -1;

    protected promiseResolvers: {
        [referenceId: number]: {
            resolve: (result: any) => void | undefined;
            reject: (reason: any) => void | undefined;
        };
    } = {};

    protected options: IBridgeOptions;

    constructor(options: IBridgeOptions) {
        if (!isBridgeOptions(options)) {
            throw new Error("invalid argument options");
        }
        this.options = options;
    }

    public getState(): BridgeState {
        return this.state;
    }

    public connect(
        handler: (message: IMessage<any, any>) => undefined | Promise<any>,
        awaitConnection: boolean = false,
        attemptsNumber: number = 1,
    ): Promise<void> {
        if (!isFunction(handler)) {
            throw new Error("invalid argument: handler is not callable");
        }
        if (this.state !== BridgeState.Disconnected) {
            throw new Error("invalid state");
        }

        this.state = awaitConnection ? BridgeState.AwaitingConnect : BridgeState.Connecting;

        return new Promise((resolve, reject) => {
            const makeAttempt = (currentAttempt: number): void => {
                if (this.state !== BridgeState.AwaitingConnect && this.state !== BridgeState.Connecting) {
                    return resolve();
                }

                this.options
                    .connect(awaitConnection)
                    .then(() => resolve())
                    .catch((err) => {
                        if (currentAttempt >= attemptsNumber) {
                            return reject(err);
                        }
                        currentAttempt++;
                        makeAttempt(currentAttempt);
                    });
            };
            makeAttempt(1);
        })
            .then(() => {
                if (this.state !== BridgeState.AwaitingConnect && this.state !== BridgeState.Connecting) {
                    // disconnected was called before connection succeeded, avoid setting connected state
                    return;
                }
                this.messageHandler = handler;
                this.state = BridgeState.Connected;
            })
            .catch((error) => {
                this.messageHandler = undefined;
                this.state = BridgeState.Disconnected;

                throw error;
            });
    }

    public disconnect(): Promise<void> {
        this.state = BridgeState.Disconnecting;

        return this.options.disconnect().then(() => {
            this.handleDisconnect();
        });
    }

    public emit<Data = any>(data: Data): void {
        this.send({
            data,
        });
    }

    public request<Data = any, Result = any>(data: Data, overrideOptions?: Partial<IBridgeOptions>): Promise<Result> {
        const requestId = ++this.lastRequestId;
        const options = {
            ...this.options,
            ...overrideOptions,
        };

        // fire and return promise
        return new Promise((resolve, reject) => {
            this.promiseResolvers[requestId] = {
                reject: (reason) => {
                    delete this.promiseResolvers[requestId];
                    reject(reason);
                },
                resolve: (result) => {
                    delete this.promiseResolvers[requestId];
                    resolve(result);
                },
            };

            if (options.timeout !== -1) {
                setTimeout(() => {
                    if (this.promiseResolvers[requestId]) {
                        this.promiseResolvers[requestId].reject(new Error("Request timeout."));
                    }
                }, options.timeout);
            }

            this.options.send(
                this.encode({
                    data,
                    requestId,
                }),
            );
        });
    }

    public send<Data = any>(bridgeMessage: IBridgeMessage<Data>): void {
        if (this.state !== BridgeState.Connected) {
            throw new Error("bridge is not connected");
        }

        this.options.send(this.encode(bridgeMessage));
    }

    protected handleDisconnect(): void {
        // cancel all hanging requests
        Object.keys(this.promiseResolvers).forEach((key: any) => {
            this.promiseResolvers[key].reject(new Error("disconnect"));
        });

        // reset handler and state
        this.messageHandler = undefined;
        this.state = BridgeState.Disconnected;
    }

    protected encode(obj: IBridgeMessage): string {
        return this.options.encode ? this.options.encode(obj) : JSON.stringify(obj);
    }

    protected decode(str: string): IBridgeMessage {
        return this.options.decode ? this.options.decode(str) : JSON.parse(str);
    }

    protected receive(str: string): void {
        const obj: IBridgeMessage = this.decode(str);

        if (!isBridgeMessage(obj)) {
            throw new Error("incoming request could not be resolved into a valid bridge message");
        }

        if (!this.isConnected || !this.messageHandler) {
            throw new Error("disconnected");
        }

        if (obj.referenceId !== undefined) {
            this.handleReceivedResponse(obj);
            return;
        }

        const promiseOrUndefined = this.messageHandler(obj.data) || undefined;
        if (obj.requestId || obj.requestId === 0) {
            this.respondAsync(obj.requestId, promiseOrUndefined);
        }
    }

    protected handleReceivedResponse(message: IBridgeMessage): void {
        const { referenceId } = message;
        if (!referenceId && referenceId !== 0) {
            throw new Error("response is missing referenceId");
        }

        // resolve a pending promise (if it didn't timeout yet)
        const promise = this.promiseResolvers[referenceId];
        if (promise) {
            if (message.isError === true) {
                promise.reject(new Error(`Error response received: \n${message.data}`));
            } else {
                promise.resolve(message.data);
            }
        }
    }

    protected respondAsync(requestId: number, promise: undefined | Promise<any>): void {
        // PromiseLike
        if (!promise || !promise.then || !promise.catch) {
            this.send({
                data: "unknown error occurred",
                isError: true,
                referenceId: requestId,
            });
            throw new Error("promise expected. Is your handler implemented correctly?");
        }

        promise
            .then((data) => {
                this.send({
                    data,
                    referenceId: requestId,
                });
            })
            .catch(() => null);

        promise.catch((data) => {
            this.send({
                data: data.message ? data.message : data,
                isError: true,
                referenceId: requestId,
            });
        });
    }
}
