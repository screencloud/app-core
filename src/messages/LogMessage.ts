import {IMessage} from "../MessageApp";
import {MessageTypes} from "./";

export enum LogLevel {
    Trace = 0,
    Debug = 1,
    Info = 2,
    Warn = 3,
    Error = 4,
}

export interface ILogMessagePayload {
    level?: LogLevel;
    message?: string;
}

export type LogMessage = IMessage<ILogMessagePayload, MessageTypes.log>;
