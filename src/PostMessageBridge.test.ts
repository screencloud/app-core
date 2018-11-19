import {IBridgeMessage} from "./Bridge";
import {isPostMessageBridgeCommand, PostMessageBridge, PostMessageBridgeCommands} from "./PostMessageBridge";

import {EventEmitter} from "events";

class FakeWindow extends EventEmitter {

    public defaultSource?: FakeWindow;

    public addEventListener(event: string, handler: (...args: any[]) => void): void {
        this.addListener(event, handler);
    }

    // noinspection JSUnusedGlobalSymbols
    public removeEventListener(event: string, handler: any): void {
        this.removeListener(event, handler);
    }

    public postMessage(data: string, origin: string, source?: Window): void {
        this.emit("message", {
            data,
            origin,
            source: source || this.defaultSource,
        });
    }
}

const makeWindow = (): Window => (new FakeWindow() as any);

test("isPostMessageBridgeCommand()", () => {
    // false
    expect(isPostMessageBridgeCommand(null)).toBeFalsy();
    expect(isPostMessageBridgeCommand({})).toBeFalsy();
    expect(isPostMessageBridgeCommand("foo")).toBeFalsy();
    expect(isPostMessageBridgeCommand(JSON.stringify(PostMessageBridgeCommands.Connect)))
        .toBeFalsy();

    // true
    expect(isPostMessageBridgeCommand(PostMessageBridgeCommands.Connect)).toBeTruthy();
});

describe("PostMessageBridge", () => {
    test("constructor()", () => {
        expect(() => new PostMessageBridge(makeWindow(), makeWindow()))
            .not.toThrow();
    });

    test("addListener()/removeListener()/handleMessageEvent()", (done) => {
        const targetWindow = new FakeWindow();
        const sourceWindow = new FakeWindow();
        const pmb = new PostMessageBridge(targetWindow as any, sourceWindow as any);

        let stage: "connect" | "send" | "disconnect" | "done" = "connect";

        targetWindow.addEventListener("message", (event: MessageEvent) => {
            const {data} = event;

            if (data === PostMessageBridgeCommands.Connect) {
                expect(stage).toBe("connect");

                // step 2: receive Connect command and return success after delay
                // event should then be picked up by PMBs handler.
                setTimeout(() => {
                    stage = "send";
                    sourceWindow.postMessage(
                        PostMessageBridgeCommands.ConnectSuccess, "*", targetWindow as any,
                    );
                }, 50);
            } else if (data === PostMessageBridgeCommands.Disconnect) {
                // step 6: receive disconnect
                expect(stage).toBe("disconnect");
                stage = "done";
            } else {
                // step 4: receive test message on other side
                expect(stage).toBe("send");
                const message: IBridgeMessage = JSON.parse(data);
                expect(message.data).toBe("myLittlePony");
                stage = "disconnect";
            }
        });

        // step 1: connect should add listener
        pmb.connect(() => {
            throw new Error("should not have been called");
        })
            .then(() => {

                // step 3: send a test message to the other window
                pmb.send({data: "myLittlePony"});

                setTimeout(() => {
                    // step 5: disconnect after a short time
                    pmb.disconnect().then(() => {
                        expect(stage).toBe("done");
                        done();
                    });

                    // should not listen anymore immediately after call
                    expect(sourceWindow.listeners("message").length).toBe(0);
                }, 50);
            });

        expect(sourceWindow.listeners("message").length)
            .toBe(1);
    });

    test("PostMessageBridge to PostMessageBridge", (done) => {
        const window = new FakeWindow();
        const targetWindow = new FakeWindow();
        window.defaultSource = targetWindow;
        targetWindow.defaultSource = window;
        const bridge = new PostMessageBridge(targetWindow as any, window as any);
        const targetBridge = new PostMessageBridge(window as any, targetWindow as any);

        let emitReceived = false;
        let requestReceived = false;
        let failRequestReceived = false;
        let incomingReceived = false;

        Promise
        // establish connection between bridged
            .all([
                // targetBridge acts as host
                targetBridge
                    .connect((message) => {
                        const {payload} = message;
                        if (payload === "emit") {
                            expect(emitReceived).toBeFalsy();
                            emitReceived = true;
                            // (console).log("emit received");
                            return undefined;
                        } else if (payload === "request") {
                            expect(requestReceived).toBeFalsy();
                            requestReceived = true;
                            return Promise.resolve("requestSuccess");
                        } else if (payload === "request2") {
                            expect(failRequestReceived).toBeFalsy();
                            failRequestReceived = true;
                            return Promise.reject("requestFail");
                        }

                        throw new Error("should not happen! :)");
                    }, true),

                // bridge will connect to host
                bridge
                    .connect((message) => {
                        // later: expect once to receive a message, for which we will return a promise
                        expect(incomingReceived).toBeFalsy();
                        expect(message.payload).toBe("incoming");
                        incomingReceived = true;
                        return Promise.resolve("incomingSuccess");
                    }),
            ])
            // .then(() => {
            //     (console).log("connection established");
            // })
            // bridges send messages across
            .then(() => Promise.all([
                // emit "emit" once.
                // since this is fire-and-forget, we return a promise with a delayed resolve
                // the other bridge will ensure the values arrived correctly and only once.
                Promise.resolve(
                    bridge.emit({payload: "emit"}),
                ),
                // request with success
                bridge
                    .request({payload: "request"})
                    .then((result) => {
                        expect(result).toBe("requestSuccess");
                        // (console).log("requestSuccess received");
                    }),
                // request with error
                bridge
                    .request({payload: "request2"})
                    .then(() => {
                        throw new Error("should have received an error");
                    })
                    .catch((reason) => {
                        expect(reason).toBe("requestFail");
                        // (console).log("requestFail received");
                    }),
                // incoming request to be answered with response
                targetBridge
                    .request({payload: "incoming"})
                    .then((result) => {
                        expect(result).toBe("incomingSuccess");
                        // (console).log("incomingSuccess received");
                    }),
            ])).then(() => done());
    }, 100000);
});
