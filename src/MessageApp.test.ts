import isFunction from "lodash/isFunction";
import { IBridge } from "./Bridge";
import { IMessage, IMessageHandlers, isValidMessageTypeArray, MessageApp } from "./MessageApp";

const fakeBridge: IBridge = {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    isConnected: true,
    isConnecting: false,
    request: (): Promise<any> => Promise.reject("fake") as any,
    send: () => undefined,
};

test("isValidMessageTypeArray()", () => {
    // false non-array cases
    expect(isValidMessageTypeArray(null)).toBeFalsy();
    expect(isValidMessageTypeArray(true)).toBeFalsy();
    expect(isValidMessageTypeArray("foo")).toBeFalsy();
    expect(isValidMessageTypeArray(15)).toBeFalsy();
    expect(isValidMessageTypeArray(undefined)).toBeFalsy();

    // duplicates
    expect(isValidMessageTypeArray(["foo", "foo"])).toBeFalsy();

    // non string values
    expect(isValidMessageTypeArray([true])).toBeFalsy();
    expect(isValidMessageTypeArray([5, "foo"])).toBeFalsy();

    // wrong naming pattern
    expect(isValidMessageTypeArray(["   "])).toBeFalsy();
    expect(isValidMessageTypeArray(["..."])).toBeFalsy();
    expect(isValidMessageTypeArray(["ßüäö"])).toBeFalsy();

    // valid!
    expect(isValidMessageTypeArray(["camelCase", "PascalCase", "disconnect", "UPPER_CASE"])).toBeTruthy();
});

test(`new MessageApp() constructor`, () => {
    // prep
    const anyMessageApp: any = MessageApp;
    const fakeHandlers: IMessageHandlers = {};

    // no empty constructor
    expect(() => new anyMessageApp()).toThrow();

    // broken bridge
    expect(() => new anyMessageApp([], [], fakeHandlers, {})).toThrow();

    // invalid handlers
    expect(() =>
        anyMessageApp(
            ["bar"],
            [],
            {
                bar: () => undefined,
                foo: () => undefined, // <= invalid handler
            },
            fakeBridge,
        ),
    ).toThrow();

    // should work!
    expect(
        () =>
            new MessageApp(
                {
                    bar: () => undefined,
                },
                fakeBridge,
            ),
    ).not.toThrow();
});

test("MessageApp.connect() relays bridge.connect and injects a handler", (done) => {
    const app = new MessageApp(
        {},
        {
            ...fakeBridge,
            connect: (handler: any) => {
                expect(isFunction(handler)).toBeTruthy();
                return Promise.resolve();
            },
        },
    );

    app.connect().then(done);
});

test("MessageApp.on()", (done) => {
    const app = new MessageApp({}, fakeBridge);

    // invalid handler
    expect(() => {
        app.on("foo", "notAFunction" as any);
    }).toThrow();

    app.on("foo", (payload) => {
        expect(payload).toBe(17);
        done();
    });

    (app as any).receive({
        payload: 17,
        type: "foo",
    });
});

test("MessageApp.receive()", (done) => {
    const app = new MessageApp({}, fakeBridge);

    // invalid message
    expect(() => {
        (app as any).receive({});
    }).toThrow();

    // valid message without handler
    expect(() => {
        (app as any).receive({
            payload: true,
            type: "bar",
        });
    }).not.toThrow();

    // set a handler and remove it again
    const throwingHandler = () => {
        throw new Error("should not be called");
    };
    app.on("foo", throwingHandler);
    app.off(throwingHandler);

    // add a good handler
    app.on("foo", (payload) => {
        expect(payload).toBe("bar");
        return Promise.resolve("baz");
    });
    (app as any)
        .receive({
            payload: "bar",
            type: "foo",
        })
        .then((value: any) => {
            expect(value).toEqual("baz");
            done();
        });
});

test("MessageApp.isConnected()", () => {
    const app = new MessageApp(
        {},
        {
            ...fakeBridge,
            isConnected: 17 as any,
        },
    );

    expect(app.isConnected).toEqual(app.bridge.isConnected);
});

test("MessageApp.emit()", () => {
    const fakeMessage = {
        payload: 666,
        type: "foo" as any,
    };
    const app = new MessageApp(
        {},
        {
            ...fakeBridge,
            send: (message: any) => {
                expect(message).toEqual({ data: fakeMessage });
            },
        },
    );

    app.emit(fakeMessage);
});

test("MessageApp.request()", async (done) => {
    const fakeMessage: IMessage = {
        payload: 666,
        type: "foo" as any,
    };
    const app = new MessageApp(
        {},
        {
            ...fakeBridge,
            request: (message) => {
                expect(message).toEqual(fakeMessage);
                return Promise.resolve(() => done()) as any;
            },
        },
    );

    // valid message
    (app.request(fakeMessage) as Promise<any>).then((doneFn: any) => doneFn());
});

test("MessageApp.request() throws", () => {
    const app = new MessageApp({}, fakeBridge);

    // invalid messages
    expect(() => app.request("notAMessage" as any)).toThrow();
});

test("MessageApp.emit() throws", () => {
    const app = new MessageApp({}, fakeBridge);

    // invalid messages
    expect(() => app.emit("notAMessage" as any)).toThrow();
});
