import {isFunction, isPlainObject, isString} from "lodash";
import {IMessage, IMessageHandlers} from "./MessageApp";

/**
 * Returns true if obj is a plain object implementing IMessageAppHandlers
 */
export function isValidMessageHandlerCollection(obj: any, validKeys: string[]): obj is IMessageHandlers {
    return isPlainObject(obj)
        && Object.keys(obj).every((key) => {
            return validKeys.includes(key)
                && (obj[key] === undefined || isFunction(obj[key]));
        });
}

function isValidKey(key: string): boolean {
    return ["type", "payload", "meta"].indexOf(key) > -1;
}

export function isMessage(message: any): message is IMessage<any> {
    return (
        isPlainObject(message) &&
        isString(message.type) &&
        Object.keys(message).every(isValidKey)
    );
}
