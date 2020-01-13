import isString from "lodash/isString";
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
    return `___${JSON.stringify({type, data})}`;
}

export class PostMessageBridge extends Bridge {

    protected targetWindow: Window | null = null;

    protected sourceWindow: Window | null = null;

    protected eventListenersAdded: boolean = false;

    protected resolveConnect?: () => void = undefined;

    private _origin?: string;

    public get origin() {
        return this._origin;
    }

    protected get target(): Window {
        const target: Window = this.targetWindow || window.opener || window.parent;
        if (target === this.sourceWindow) {
            throw new Error("Target window can't be same as source");
        }
        return target;
    }

    constructor(
        targetWindow: Window | null = null,
        sourceWindow: Window = window,
        timeout: number = 1000,
    ) {
        super({
            connect: (awaitConnect?: boolean) => new Promise((resolve, reject) => {
                this.addListeners();
                this.resolveConnect = resolve;
                setTimeout(() => reject(new Error("Connection timeout.")), this.options.timeout);
                if (!awaitConnect) {
                    this.sendCommand(PostMessageBridgeCommandTypes.Connect);
                }
            }),
            disconnect: () => new Promise((resolve) => {
                this.removeListeners();
                this.sendCommand(PostMessageBridgeCommandTypes.Disconnect);
                this.targetWindow = null;
                this.sourceWindow = null;
                resolve();
            }),
            send: (request: string) => {
                this.target.postMessage(request, "*");
            },
            timeout,
        });

        this.targetWindow = targetWindow;
        this.sourceWindow = sourceWindow;

        if (!this.target || !this.target.postMessage) {
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

    protected handleDisconnectCommand(origin: string) {
        this.removeListeners();
        this.targetWindow = null;
        this.sourceWindow = null;
        this.handleDisconnect();
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
            this.handleDisconnectCommand(event.origin);
        }
    }

    protected handleMessageEvent = (event: MessageEvent): void => {
        // source is unexpected?
        if (event.source !== this.target) {
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

    protected handleUnloadEvent = () => {
        this.removeListeners();
        this.targetWindow = null;
        this.sourceWindow = null;
        this.handleDisconnect();
    }

    protected addListeners(): void {
        if (!this.eventListenersAdded && this.sourceWindow) {
            this.eventListenersAdded = true;
            this.sourceWindow.addEventListener("message", this.handleMessageEvent);
            this.sourceWindow.addEventListener("unload", this.handleUnloadEvent);
        }
    }

    protected removeListeners(): void {
        if (this.eventListenersAdded && this.sourceWindow) {
            this.sourceWindow.removeEventListener("message", this.handleMessageEvent);
            this.sourceWindow.removeEventListener("unload", this.handleUnloadEvent);
            this.eventListenersAdded = false;
        }
    }
}
