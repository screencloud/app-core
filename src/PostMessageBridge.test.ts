import {BridgeState, IBridgeMessage} from "./Bridge";
import {
    encodePostMessageBridgeCommand,
    PostMessageBridge,
    PostMessageBridgeCommandTypes,
    tryDecodePostMessageBridgeCommand
} from "./PostMessageBridge";

import {EventEmitter} from "events";

class FakeWindow extends EventEmitter {
    public defaultSource?: FakeWindow;

    public addEventListener(
        event: string,
        handler: (...args: any[]) => void
    ): void {
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

test("encodePostMessageBridgeCommand()", () => {
    expect(encodePostMessageBridgeCommand("foo" as any)).toEqual(`___{"type":"foo"}`);
    expect(encodePostMessageBridgeCommand("foo" as any, 17)).toEqual(`___{"type":"foo","data":17}`);

    expect(() => encodePostMessageBridgeCommand(17 as any)).toThrow();
    expect(() => encodePostMessageBridgeCommand(undefined as any)).toThrow();
    expect(() => encodePostMessageBridgeCommand({} as any)).toThrow();
});

test("tryDecodePostMessageBridgeCommand()", () => {
    // false
    expect(tryDecodePostMessageBridgeCommand(null)).toBeFalsy();
    expect(tryDecodePostMessageBridgeCommand({})).toBeFalsy();
    expect(tryDecodePostMessageBridgeCommand("foo")).toBeFalsy();
    expect(
        tryDecodePostMessageBridgeCommand(JSON.stringify(PostMessageBridgeCommandTypes.Connect)),
    ).toBeFalsy();
    expect(
        tryDecodePostMessageBridgeCommand(JSON.stringify({type: PostMessageBridgeCommandTypes.Connect})),
    ).toBeFalsy();

    // true
    const validCommand = `___${JSON.stringify({
        type: PostMessageBridgeCommandTypes.Connect,
    })}`;
    expect(tryDecodePostMessageBridgeCommand(validCommand)).toEqual({
        type: PostMessageBridgeCommandTypes.Connect,
    });

    const validCommand2 = `___${JSON.stringify({
        data: {foo: true, bar: 42},
        type: PostMessageBridgeCommandTypes.ConnectSuccess,
    })}`;
    expect(tryDecodePostMessageBridgeCommand(validCommand2)).toEqual({
        data: {foo: true, bar: 42},
        type: PostMessageBridgeCommandTypes.ConnectSuccess,
    });

});

describe("PostMessageBridge", () => {
    test("constructor()", () => {
        expect(() => new PostMessageBridge(makeWindow(), makeWindow()))
            .not.toThrow();
    });

    // tslint:disable:no-console
    it("request()", async () => {
        const targetWindow = new FakeWindow();
        const sourceWindow = new FakeWindow();

        const postMessageBridge = new PostMessageBridge(
            targetWindow as any,
            sourceWindow as any
        );

        // postMessageBridge.connect() will timeout unless you add the targetWindow event listener first
        targetWindow.addEventListener("message", (event: MessageEvent) => {
            const {data} = event;
            console.log("event received: ", event);

            const command = tryDecodePostMessageBridgeCommand(data);

            switch (command && command.type) {
                case PostMessageBridgeCommandTypes.Connect: {
                    sourceWindow.postMessage(
                        encodePostMessageBridgeCommand(
                            PostMessageBridgeCommandTypes.ConnectSuccess
                        ),
                        "screencloudapps.com",
                        targetWindow as any
                    );
                    break;
                }
                case PostMessageBridgeCommandTypes.Disconnect: {
                    break;
                }
                default: {
                    // Receive any generic data
                    console.log("inide the NON command block");
                    const message: IBridgeMessage = JSON.parse(data);
                    // expect(message.data).toBe("myLittlePony");
                    console.log('message was: ', message)
                    console.log(message.data)
                    sourceWindow.postMessage(
                        message.data,
                        "screencloudapps.com",
                        targetWindow as any
                    );
                    //send it back
                    break;
                }
            }
        });

        await postMessageBridge.connect(() => Promise.resolve());
        expect(postMessageBridge.getState()).toBe(BridgeState.Connected);
        expect(postMessageBridge.isConnected).toBe(true);
        expect(postMessageBridge.origin).toBe('screencloudapps.com');

        // TODO: Untyped, need to type request param to IBridgeMessage
        // TODO: decode() should also probably use JSON.parse(JSON.stringify(string)) except
        // that breaks some things within PostMessageBridge to PostMessageBridge test
        // const huh = await postMessageBridge.request({ data: 'whoa there hoss', mustafar: 'woooo'})

        // Otherwise you have to wrap requests as strings as such:
        // const huh = await postMessageBridge.request('{ "data": "hello!"}')
        // console.log('huh', huh)

        // postMessageBridge.send({data: "myLittlePony"});

        await postMessageBridge.disconnect();
        expect(postMessageBridge.getState()).toBe(BridgeState.Disconnected);
    });

    test("addListener()/removeListener()/handleMessageEvent()", done => {
        const targetWindow = new FakeWindow();
        const sourceWindow = new FakeWindow();

        // PostMessageBridge expects actual windows, so must cast FakeWindow to any
        const pmb = new PostMessageBridge(targetWindow as any, sourceWindow as any);

        let stage: "connect" | "send" | "disconnect" | "done" = "connect";

        targetWindow.addEventListener("message", (event: MessageEvent) => {
            const {data} = event;
            const command = tryDecodePostMessageBridgeCommand(data);

            if (command && command.type === PostMessageBridgeCommandTypes.Connect) {
                // step 2: receive Connect command and return success after delay
                // event should then be picked up by PMBs handler.
                setTimeout(() => {
                    expect(stage).toBe("connect");
                    stage = "send";
                    sourceWindow.postMessage(
                        encodePostMessageBridgeCommand(PostMessageBridgeCommandTypes.ConnectSuccess),
                        "*",
                        targetWindow as any,
                    );
                }, 50);
            } else if (command && command.type === PostMessageBridgeCommandTypes.Disconnect) {
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
                        expect(reason.message).toContain("requestFail");
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
