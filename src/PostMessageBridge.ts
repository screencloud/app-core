import {Bridge, BridgeState} from "./Bridge";
import * as config from './config'

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
export function tryDecodePostMessageBridgeCommand(obj: unknown): undefined | IPostMessageBridgeCommand {
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

export interface IVerifyDomain {
    origin: string;
    validDomains: string[];
}

// Verify if origin URL is in the allowed validDomains list to send/receive messages
export function defaultVerifyDomain({origin, validDomains = config.validMessageDomains}: IVerifyDomain) {
    const escapedAndConcattedDomains = validDomains
        .map((domain) => domain.replace(/\./gi, "\\."))
        .join("|");

    const re = RegExp(`^(${escapedAndConcattedDomains})$`, "i");

    return re.test(origin);
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
        verifyDomain: (options: IVerifyDomain) => boolean = defaultVerifyDomain,
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
                // Send one message to every domain in whitelist, because we're not
                // sure what's on the other end. Messages not intended for recipient
                // PostMessageBridge will just be lost in the ether.
                config.validMessageDomains.forEach((domain) => this.target.postMessage(request, domain));
            },
            timeout,
        });

        this.verifyDomain = verifyDomain;
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
        if (!this.isGoodOrigin(event.origin)) {
            return;
        }

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
