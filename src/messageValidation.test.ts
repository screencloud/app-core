import { isMessage, isValidMessageHandlerCollection } from "./messageValidation";

// isMessage() => false
[
    undefined,
    null,
    {},
    [],
    {
        type: true,
    },
    {
        bar: true,
        type: "foo",
    },
    {
        meta: 35,
        payload: 25,
    },
].forEach((obj, i) => {
    test(`isMessage() should return false #${i}`, () => {
        expect(isMessage(obj)).toBeFalsy();
    });
});

// isMessage() => true
[
    {
        type: "foo",
    },
    {
        payload: true,
        type: "foo",
    },
    {
        meta: 5,
        type: "foo",
    },
    {
        meta: 25,
        payload: 17,
        type: "bar",
    },
].forEach((obj, i) => {
    test(`isMessage() should return true #${i}`, () => {
        expect(isMessage(obj)).toBeTruthy();
    });
});

// isValidMessageHandlerCollection => true
[
    // empty is fine
    {},
    // partial is fine
    {
        foo: () => true,
    },
    {
        bar: () => false,
        foo: () => true,
    },
].forEach((obj, i) => {
    test(`testisValidMessageHandlerCollection() should return true #${i}`, () => {
        expect(isValidMessageHandlerCollection(obj)).toBeTruthy();
    });
});
// isValidMessageHandlerCollection => false
[
    undefined,
    true,
    {
        fish: false,
    },
    {
        foo: 17,
    },
    {
        bar: 12,
        foo: () => true,
    },
].forEach((obj, i) => {
    test(`testisValidMessageHandlerCollection() should return false #${i}`, () => {
        expect(isValidMessageHandlerCollection(obj)).toBeFalsy();
    });
});
