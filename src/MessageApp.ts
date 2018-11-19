import {isArray, isFunction, isString, uniq} from "lodash";
import {IBridge, isBridge} from "./Bridge";
import {isMessage, isValidMessageHandlerCollection} from "./messageValidation";

export interface IMessage<Payload = any, MessageType = any, Meta = any> {
    type: string;
    payload?: Payload;
    meta?: Meta;
}

export interface IMessageHandlers {
    [index: string]: undefined | ((payload: void | any) => void);
}

export interface IMessageApp<MessageTypes = any> {
    readonly isConnected: boolean;
    readonly bridge: IBridge;

    emit<Message extends IMessage = IMessage>(message: IMessage): void;

    request<Message extends IMessage = IMessage, Result = any>(message: IMessage): Promise<Result>;

    on(messageType: string, handler: ((payload: void | any) => void) | undefined): this;

    connect(): Promise<void>;

    disconnect(): Promise<void>;
}

export function isValidMessageTypeArray(obj: any): obj is string[] {
    return isArray(obj)
        && obj.length > 0
        && uniq(obj).length === obj.length
        && obj.every((v) => v && isString(v) && (/^[a-zA-Z_]+$/g).test(v));
}

export class MessageApp<MessageTypes = any, MessageHandlers extends IMessageHandlers = {}>
    implements IMessageApp<MessageTypes> {

    public get isConnected(): boolean {
        return this.bridge.isConnected;
    }

    public readonly bridge: IBridge;
    protected handlers: MessageHandlers;
    protected messageTypes: string[];

    constructor(
        messageTypes: string[],
        handlers: MessageHandlers,
        bridge: IBridge,
    ) {
        // Message Types
        if (!isValidMessageTypeArray(messageTypes)) {
            throw new Error("messageTypes must be a non-empty non-duplicate string-array");
        }
        this.messageTypes = messageTypes;

        // Handlers
        if (!isValidMessageHandlerCollection(handlers, this.messageTypes)) {
            throw new Error("handlers must be undefined or a plain object implementing IMessageAppHandlers");
        }
        this.handlers = {
            ...(handlers as any),
        };

        // Bridge
        if (!isBridge(bridge)) {
            throw new Error("invalid argument: bridge is not a valid bridge");
        }
        this.bridge = bridge;
    }

    public on(messageType: string, handler: ((payload: void | any) => void) | undefined): this {

        if (!this.messageTypes.includes(messageType)) {
            throw new Error(`unknown message type: ${messageType}`);
        }

        if (handler !== undefined && !isFunction(handler)) {
            throw new Error("handler must be callable or undefined");
        }

        this.handlers[messageType] = handler;
        return this;
    }

    public connect(): Promise<void> {
        return this.bridge
            .connect((message) => this.receive(message));
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

    public request<Message extends IMessage = any, Result = any>(message: Message): Promise<Result> {
        if (!isMessage(message)) {
            throw new Error("invalid message");
        }
        return this.bridge.request<Message, Result>(message);
    }

    protected receive(message: IMessage): undefined | Promise<any> {
        // ensure we actually got a message.
        if (!isMessage(message)) {
            throw new Error("invalid message");
        }

        const {type, payload} = message;

        // typecast to any due to typescript inference error
        // TS2349: Cannot invoke an expression whose type lacks a request signature.
        const handler: any = this.handlers[type];

        if (isFunction(handler)) {
            try {
                return handler(payload);
            } catch (e) {
                // todo do something with caught exceptions

                // rethrow
                throw e;
            }
        }
    }
}
