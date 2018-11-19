import {isString} from "lodash";
import {Bridge, BridgeState} from "./Bridge";

export enum PostMessageBridgeCommands {
    Connect = "CONNECT",
    ConnectSuccess = "CONNECT_SUCCESS",
    Disconnect = "DISCONNECT",
}

export function isPostMessageBridgeCommand(obj: any): obj is PostMessageBridgeCommands {
    return isString(obj) && Object.values(PostMessageBridgeCommands).includes(obj);
}

export class PostMessageBridge extends Bridge {

    protected eventListener?: EventListenerOrEventListenerObject = undefined;

    protected resolveConnect?: () => void = undefined;

    constructor(
        protected targetWindow: Window = window.opener || window.parent || window.top,
        protected sourceWindow: Window = window,
    ) {
        super({
            connect: (awaitConnect?: boolean) => new Promise((resolve, reject) => {
                this.addListener();
                this.resolveConnect = resolve;
                if (!awaitConnect) {
                    setTimeout(() => reject("timeout"), this.options.timeout);
                    this.options.send(PostMessageBridgeCommands.Connect);
                }
            }),
            disconnect: () => new Promise((resolve) => {
                this.removeListener();
                this.options.send(PostMessageBridgeCommands.Disconnect);
                resolve();
            }),
            send: (request: string) => {
                this.targetWindow.postMessage(request, "*");
            },
            timeout: 1000,
        });

        if (!this.targetWindow || !this.targetWindow.postMessage) {
            throw new Error("invalid argument targetWindow");
        }
    }

    protected handleMessageEvent(event: MessageEvent): void {
        // source is unexpected?
        if (event.source !== this.targetWindow) {
            return;
        }

        const {data} = event;

        if (isPostMessageBridgeCommand(data)) {
            if (
                data === PostMessageBridgeCommands.Connect
                && this.state === BridgeState.AwaitingConnect
                && this.resolveConnect
            ) {
                this.options.send(PostMessageBridgeCommands.ConnectSuccess);
                this.resolveConnect();
            }
            if (
                data === PostMessageBridgeCommands.ConnectSuccess
                && this.state === BridgeState.Connecting
                && this.resolveConnect
            ) {
                this.resolveConnect();
            }
            if (data === PostMessageBridgeCommands.Disconnect) {
                this.handleDisconnect();
            }
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
