export type UUID = string;

export interface IAppConfig {
  [key: string]: any;
}

export interface IAppState {
  context: any; // todo: proper type
}
