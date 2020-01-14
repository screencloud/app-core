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

// Our convention is that commands start with three underscores '___'
export function tryDecodePostMessageBridgeCommand(obj: any): undefined | IPostMessageBridgeCommand {
    if (typeof obj !== "string" || obj.substr(0, 3) !== "___") {
        return undefined;
    }

    return JSON.parse(obj.substr(3));
}

export function encodePostMessageBridgeCommand(type: PostMessageBridgeCommandTypes, data?: any): string {
    if (!type || typeof type !== "string") {
        throw new Error(`command must be a string`);
    }
    return `___${JSON.stringify({type, data})}`;
}

export class PostMessageBridge extends Bridge {

    get origin() {
        return this._origin;
    }

    private _origin?: string;

    private targetWindow: Window | null = null;

    private sourceWindow: Window | null = null;

    private eventListenersAdded: boolean = false;

    private resolveConnect?: () => void = undefined;

    private get target(): Window {
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

    private sendCommand(type: PostMessageBridgeCommandTypes, data?: any) {
        this.options.send(encodePostMessageBridgeCommand(type, data));
    }

    private handleConnectCommand(origin: string) {
        if (this.state === BridgeState.AwaitingConnect && this.resolveConnect) {
            this.sendCommand(PostMessageBridgeCommandTypes.ConnectSuccess);
            this._origin = origin;
            this.resolveConnect();
        }
    }

    private handleConnectSuccessCommand(origin: string) {
        if (this.state === BridgeState.Connecting && this.resolveConnect) {
            this._origin = origin;
            this.resolveConnect();
        }
    }

    private handleDisconnectCommand(origin: string) {
        this.removeListeners();
        this.targetWindow = null;
        this.sourceWindow = null;
        this.handleDisconnect();
    }

    private receiveCommand(command: IPostMessageBridgeCommand, event: MessageEvent) {

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

    private handleMessageEvent = (event: MessageEvent): void => {
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

    private handleUnloadEvent = () => {
        this.removeListeners();
        this.targetWindow = null;
        this.sourceWindow = null;
        this.handleDisconnect();
    }

    private addListeners(): void {
        if (!this.eventListenersAdded && this.sourceWindow) {
            this.eventListenersAdded = true;
            this.sourceWindow.addEventListener("message", this.handleMessageEvent);
            this.sourceWindow.addEventListener("unload", this.handleUnloadEvent);
        }
    }

    private removeListeners(): void {
        if (this.eventListenersAdded && this.sourceWindow) {
            this.sourceWindow.removeEventListener("message", this.handleMessageEvent);
            this.sourceWindow.removeEventListener("unload", this.handleUnloadEvent);
            this.eventListenersAdded = false;
        }
    }
}
