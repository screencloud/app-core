import {isArray, isFunction, isString, uniq} from "lodash";
import {IBridge, isBridge} from "./Bridge";
import {isMessage, isValidMessageHandlerCollection} from "./messageValidation";

export interface IMessage<Payload = any, Type = any, Meta = any> {
    type: Type;
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
    protected incMessageTypes: string[];
    protected outMessageTypes: string[];

    constructor(
        incMessageTypes: string[],
        outMessageTypes: string[],
        handlers: MessageHandlers,
        bridge: IBridge,
    ) {
        // Incoming Message Types
        if (!isValidMessageTypeArray(incMessageTypes)) {
            throw new Error("incMessageTypes must be a unique string-array");
        }
        this.incMessageTypes = incMessageTypes;

        // Outgoing Message Types
        if (!isValidMessageTypeArray(outMessageTypes)) {
            throw new Error("outMessageTypes must be a unique string-array");
        }
        this.outMessageTypes = outMessageTypes;

        // Handlers (Incoming only)
        if (!isValidMessageHandlerCollection(handlers, this.incMessageTypes)) {
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

        if (!this.incMessageTypes.includes(messageType)) {
            throw new Error(`unknown message type: ${messageType}`);
        }

        if (handler !== undefined && !isFunction(handler)) {
            throw new Error("handler must be callable or undefined");
        }

        this.handlers[messageType] = handler;
        return this;
    }

    public connect(awaitConnection: boolean = false): Promise<void> {
        return this.bridge
            .connect((message) => this.receive(message), awaitConnection);
    }

    public disconnect(): Promise<void> {
        return this.bridge.disconnect();
    }

    public emit<Message extends IMessage>(message: Message): void {
        if (!isMessage(message)) {
            throw new Error("invalid message");
        }

        if (!this.outMessageTypes.includes(message.type)) {
            throw new Error(`unknown message type: ${message.type}`);
        }

        return this.bridge.send<Message>({
            data: message,
        });
    }

    public request<Message extends IMessage = any, Result = any>(message: Message): Promise<Result> {
        if (!isMessage(message)) {
            throw new Error("invalid message");
        }

        if (!this.outMessageTypes.includes(message.type)) {
            throw new Error(`unknown message type: ${message.type}`);
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
