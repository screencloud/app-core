import {
    Bridge,
    BridgeState,
    IBridge,
    IBridgeMessage,
    IBridgeOptions,
    isBridge,
    isBridgeMessage,
    isBridgeOptions,
} from "./Bridge";

test(`isBridgeMessage()`, () => {
    ([
        {
            data: "foo",
        },
        {
            data: "foo",
            requestId: 123,
        },
        {
            data: "foo",
            referenceId: 123,
        },
        {
            data: "foo",
            isError: true,
            referenceId: 123,
            requestId: 345,
        },
    ] as IBridgeMessage[]).forEach((obj) => {
        expect(isBridgeMessage(obj)).toBeTruthy();
    });

    [
        undefined,
        "foo",
        true,
        null,
        {},
        {
            requestId: 123,
        },
        {
            referenceId: 123,
        },
        {
            referenceId: 123,
            requestId: 345,
        },
    ].forEach((obj) => {
        expect(isBridgeMessage(obj)).toBeFalsy();
    });
});

test(`isBridge()`, () => {
    // noinspection JSUnusedLocalSymbols
    const validBridge: IBridge = {
        connect: (handler) => Promise.resolve(),
        disconnect: () => Promise.resolve(),
        isConnected: true,
        isConnecting: false,
        request: (message) => Promise.reject(false),
        send: (message) => undefined,
    };
    expect(isBridge(validBridge)).toBeTruthy();
    // noinspection JSUnusedGlobalSymbols
    expect(isBridge({
        ...validBridge,
        otherMethod: () => "bar",
        someExtraProp: 15,
    })).toBeTruthy();

    // simple false checks
    expect(isBridge(undefined)).toBeFalsy();
    expect(isBridge(null)).toBeFalsy();
    expect(isBridge(true)).toBeFalsy();
    expect(isBridge({})).toBeFalsy();
    expect(isBridge({...validBridge, connect: 15})).toBeFalsy();
    expect(isBridge({...validBridge, isConnecting: () => false})).toBeFalsy();
});

test("isBridgeOptions()", () => {
    const validOptions = {
        connect: () => undefined as any,
        disconnect: () => undefined as any,
        send: () => undefined,
        timeout: 12,
    };

    // valid options
    // noinspection JSUnusedGlobalSymbols
    [
        {
            ...validOptions,
        },
        {
            ...validOptions,
            decode: () => undefined as any,
            encode: () => undefined as any,
        },
        {
            ...validOptions,
            extraMethodsAreOk: () => undefined as any,
            extraPropsToo: 1337,
        },
    ].forEach((options) => expect(isBridgeOptions(options)).toBeTruthy());

    // invalid options
    [
        undefined,
        true,
        {},
        {
            ...validOptions,
            connect: "not a function",
        },
        {
            ...validOptions,
            timeout: 0, // should be bigger than 0
        },
        {
            ...validOptions,
            timeout: "not a number",
        },
        {
            ...validOptions,
            encode: 17, // not a function
        },
    ].forEach((options) => expect(isBridgeOptions(options)).toBeFalsy());
});

describe("Bridge", () => {

    test("Bridge.constructor()", () => {
        expect(() => new Bridge(undefined as any)).toThrow();

        expect(new Bridge({
            connect: () => Promise.reject(""),
            disconnect: () => Promise.reject(""),
            send: () => undefined,
            timeout: 10,
        })).toBeInstanceOf(Bridge);
    });

    test("Bridge.encode()/decode()", () => {
        const baseOptions: IBridgeOptions = {
            connect: () => Promise.resolve(undefined),
            disconnect: () => Promise.resolve(undefined),
            send: () => undefined,
            timeout: 10,
        };

        let bridge = new Bridge({
            ...baseOptions,
        });

        const message: IBridgeMessage = {
            data: "my little pony",
            referenceId: 15,
        };

        // default encode/decode
        expect((bridge as any).encode(message)).toBe(JSON.stringify(message));
        expect((bridge as any).decode(JSON.stringify(message))).toEqual(message);

        // custom encode/decode
        bridge = new Bridge({
            ...baseOptions,
            decode: (str) => {
                expect(str).toBe("bartastic!");
                return message;
            },
            encode: (obj) => {
                expect(obj).toEqual(message);
                return "footastic!";
            },
        });

        expect((bridge as any).encode(message)).toBe("footastic!");
        expect((bridge as any).decode("bartastic!")).toBe(message);
    });

    test("Bridge.connect()/disconnect()", async (done) => {
        const bridge = new Bridge({
            connect: () => new Promise((resolve) => {
                // connect after 5ms
                setTimeout(() => resolve(), 5);
            }),
            disconnect: () => new Promise((resolve) => {
                // disconnect after 5ms
                setTimeout(() => resolve(), 5);
            }),
            send: () => undefined,
            timeout: 10,
        });

        // step 1
        expect(bridge.getState()).toBe(BridgeState.Disconnected);
        expect(() => bridge.disconnect()).toThrow();

        bridge
            .connect(() => undefined)
            .then(() => {
                // step 3
                expect(bridge.getState()).toBe(BridgeState.Connected);
                expect(() => bridge.connect(() => undefined)).toThrow();

                bridge.disconnect().then(() => {
                    // step 4
                    expect(bridge.getState()).toBe(BridgeState.Disconnected);
                    done();
                });

                expect(bridge.getState()).toBe(BridgeState.Disconnecting);
            });

        // step
        expect(bridge.getState()).toBe(BridgeState.Connecting);
    });

    test("Bridge.send()", (done) => {
        const baseOptions: IBridgeOptions = {
            connect: () => Promise.resolve(undefined),
            disconnect: () => Promise.resolve(undefined),
            send: () => {
                throw new Error();
            },
            timeout: 10,
        };

        // not connected
        expect(() => (new Bridge({...baseOptions}))
            .send({data: "anyData"}),
        ).toThrow();

        // send data
        const bridge = new Bridge({
            ...baseOptions,
            send: (str: string) => {
                expect(str).toBe(JSON.stringify({data: "foo", referenceId: 17}));
                done();
            },
        });

        bridge
            .connect(() => undefined)
            .then(() => bridge
                .send({
                    data: "foo",
                    referenceId: 17,
                }),
            );
    });

    test("Bridge.request() timeout", (done) => {
        const baseOptions: IBridgeOptions = {
            connect: () => Promise.resolve(undefined),
            disconnect: () => Promise.resolve(undefined),
            send: () => new Promise(() => undefined),
            timeout: 5,
        };

        const bridge = new Bridge({...baseOptions});
        return bridge
            .connect(() => undefined)
            .then(() => bridge.request({}))
            .catch((reason) => {
                expect(reason).toBe("timeout");
                done();
            });
    });
    //
// test("Bridge.request()", (t) => {
//
// });
//
    test("Bridge.receive() throws", () => {
        const baseOptions: IBridgeOptions = {
            connect: () => Promise.resolve(undefined),
            disconnect: () => Promise.resolve(undefined),
            send: () => undefined,
            timeout: 10,
        };

        const bridge = new Bridge({...baseOptions});
        // invalid bridge message
        expect(() => (bridge as any).receive("foo")).toThrow();

        // not connected
        expect(() =>
            (bridge as any).receive(
                (bridge as any).encode({data: "foo"}),
            ),
        ).toThrow();
    });

    // test("Bridge.receive()", (t) => {
//
// });
});
