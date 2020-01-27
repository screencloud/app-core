import isArray from "lodash/isArray";
import isFunction from "lodash/isFunction";
import isString from "lodash/isString";
import uniq from "lodash/uniq";
import {IBridge, IBridgeOptions, isBridge} from "./Bridge";
import {isMessage} from "./messageValidation";
import {Arrayfied} from "./utils";

export interface IMessage<Payload = any, Type = any, Meta = any> {
    type: Type;
    payload?: Payload;
    meta?: Meta;
}

export type IPayload = (payload: void | any) => void;

export interface IMessageHandlers {
    [index: string]: IPayload;
}

export interface IMessageApp<MessageTypes = any> {
    readonly isConnected: boolean;
    readonly bridge: IBridge;

    emit<Message extends IMessage = IMessage>(message: IMessage): void;

    request<Message extends IMessage = IMessage, Result = any>(
        message: IMessage,
        overrideOptions?: Partial<IBridgeOptions>,
    ): Promise<Result>;

    on<K extends keyof IMessageHandlers>(messageType: K, handler: IPayload): this;

    off(handler: (payload: void | any) => void): this;

    connect(awaitConnection?: boolean, attemptsNumber?: number): Promise<void>;

    disconnect(): Promise<void>;
}

export function isValidMessageTypeArray(obj: any): obj is string[] {
    return isArray(obj)
        && uniq(obj).length === obj.length
        && obj.every((v) => v && isString(v) && (/^[a-zA-Z_]+$/g).test(v));
}

export class MessageApp<MessageTypes = any, MessageHandlers extends IMessageHandlers = {}>
    implements IMessageApp<MessageTypes> {

    public get isConnected(): boolean {
        return this.bridge.isConnected;
    }

    public readonly bridge: IBridge;
    protected handlers: Partial<Arrayfied<MessageHandlers>> = {};

    constructor(
        handlers: Partial<MessageHandlers>,
        bridge: IBridge,
    ) {
        // Handlers (Incoming only)
        Object
            .keys(handlers)
            .filter((k) => handlers[k])
            .forEach((k) => handlers[k] && this.on(k, handlers[k]!));

        // Bridge
        if (!isBridge(bridge)) {
            throw new Error("invalid argument: bridge is not a valid bridge");
        }
        this.bridge = bridge;
    }

    public on<K extends keyof MessageHandlers>(messageType: K, handler: IPayload): this {
        if (!isFunction(handler)) {
            throw new Error("handler must be callable or undefined");
        }
        if (!this.handlers[messageType]) {
            this.handlers[messageType] = [handler as any];
        } else {
            this.handlers[messageType]!.push(handler as any);
        }

        return this;
    }

    public off(handler: (payload: void | any) => void) {
        Object
            .keys(this.handlers)
            .forEach(<K extends keyof IMessageHandlers>(k: K) => {
                this.handlers[k] = this.handlers[k]!
                    .filter((x: any) => x !== handler);
            });

        return this;
    }

    public connect(awaitConnection: boolean = false, attemptsNumber: number = 1): Promise<void> {
        return this.bridge
            .connect((message) => this.receive(message), awaitConnection, attemptsNumber);
    }

    public disconnect(): Promise<void> {
        return this.bridge.disconnect();
    }

    public emit<Message extends IMessage>(message: Message): void {
        if (!isMessage(message)) {
            throw new Error("invalid message");
        }

        return this.bridge.send<Message>({
            data: message,
        });
    }

    public request<Message extends IMessage = any, Result = any>(
        message: Message,
        overrideOptions?: Partial<IBridgeOptions>,
    ): Promise<Result> {
        if (!isMessage(message)) {
            throw new Error("invalid message");
        }

        return this.bridge.request<Message, Result>(message, overrideOptions);
    }

    protected receive(message: IMessage): undefined | Promise<any> {
        // ensure we actually got a message.
        if (!isMessage(message)) {
            throw new Error("invalid message");
        }

        const {type, payload} = message;

        // typecast to any due to typescript inference error
        // TS2349: Cannot invoke an expression whose type lacks a request signature.
        const handlers: any = this.handlers[type];

        try {
            if (Array.isArray(handlers)) {
                for (const k in handlers) {
                    if (isFunction(handlers[k])) {
                        const p = handlers[k](payload);
                        // first handler to return a promise gets to talk
                        if (p instanceof Promise) {
                            return p;
                        }
                    }
                }
            }
        } catch (e) {
            // todo do something with caught exceptions

            // rethrow
            throw e;
        }
    }
}
