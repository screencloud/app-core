import {isString} from "lodash";
import {Bridge, BridgeState} from "./Bridge";

export enum PostMessageBridgeCommandTypes {
    Connect = "CONNECT",
    ConnectSuccess = "CONNECT_SUCCESS",
    Disconnect = "DISCONNECT",
}

export interface IPostMessageBridgeCommand<T = never> {
    type: PostMessageBridgeCommandTypes;
    data: T;
}

export function tryDecodePostMessageBridgeCommand(obj: any): undefined | IPostMessageBridgeCommand {
    if (!isString(obj) || !obj.startsWith("___")) {
        return undefined;
    }

    return JSON.parse(obj.substr(3));
}

export function encodePostMessageBridgeCommand(type: PostMessageBridgeCommandTypes, data?: any): string {
    if (!type || !isString(type)) {
        throw new Error(`command must be a string`);
    }
    return `___${JSON.stringify({type, data})}`;
}

export class PostMessageBridge extends Bridge {

    protected eventListener?: EventListenerOrEventListenerObject = undefined;

    protected resolveConnect?: () => void = undefined;
    private _origin?: string;

    public get origin() {
        return this._origin;
    }

    constructor(
        protected targetWindow: Window = window.opener || window.parent || window.top,
        protected sourceWindow: Window = window,
        timeout: number = 1000,
    ) {
        super({
            connect: (awaitConnect?: boolean) => new Promise((resolve, reject) => {
                this.addListener();
                this.resolveConnect = resolve;
                setTimeout(() => reject("timeout"), this.options.timeout);
                if (!awaitConnect) {
                    this.sendCommand(PostMessageBridgeCommandTypes.Connect);
                }
            }),
            disconnect: () => new Promise((resolve) => {
                this.removeListener();
                this.sendCommand(PostMessageBridgeCommandTypes.Disconnect);
                resolve();
            }),
            send: (request: string) => {
                this.targetWindow.postMessage(request, "*");
            },
            timeout,
        });

        if (!this.targetWindow || !this.targetWindow.postMessage) {
            throw new Error("invalid argument targetWindow");
        }
    }

    protected sendCommand(type: PostMessageBridgeCommandTypes, data?: any) {
        this.options.send(encodePostMessageBridgeCommand(type, data));
    }

    protected handleConnectCommand(origin: string) {
        if (this.state === BridgeState.AwaitingConnect && this.resolveConnect) {
            this.sendCommand(PostMessageBridgeCommandTypes.ConnectSuccess);
            this._origin = origin;
            this.resolveConnect();
        }
    }

    protected handleConnectSuccessCommand(origin: string) {
        if (this.state === BridgeState.Connecting && this.resolveConnect) {
            this._origin = origin;
            this.resolveConnect();
        }
    }

    protected receiveCommand(command: IPostMessageBridgeCommand, event: MessageEvent) {

        const {type} = command;

        if (!type || !Object.values(PostMessageBridgeCommandTypes).includes(type)) {
            throw new Error(`Unrecognized command received: "${type}"`);
        }

        if (type === PostMessageBridgeCommandTypes.Connect) {
            this.handleConnectCommand(event.origin);
        } else if (type === PostMessageBridgeCommandTypes.ConnectSuccess) {
            this.handleConnectSuccessCommand(event.origin);
        } else if (type === PostMessageBridgeCommandTypes.Disconnect) {
            this.handleDisconnect();
        }
    }

    protected handleMessageEvent(event: MessageEvent): void {
        // source is unexpected?
        if (event.source !== this.targetWindow) {
            return;
        }

        const {data} = event;

        const command = tryDecodePostMessageBridgeCommand(data);

        if (command) {
            this.receiveCommand(command, event);
        } else {
            this.receive(data);
        }
    }

    protected addListener(): void {
        if (!this.eventListener) {
            this.sourceWindow.addEventListener(
                "message",
                this.eventListener = (event: any) => this.handleMessageEvent(event),
            );
        }
    }

    protected removeListener(): void {
        if (this.eventListener) {
            this.sourceWindow.removeEventListener("message", this.eventListener);
            this.eventListener = undefined;
        }
    }
}
